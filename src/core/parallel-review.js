/**
 * Parallel Review — split large PRs into batches for concurrent AI review
 *
 * When a PR has many files that exceed the token budget, instead of
 * truncating aggressively, we split into batches and review them in
 * parallel, then merge results.
 */

const { estimateTokens } = require('./diff-parser');
const { reviewDiff } = require('./reviewer');

const DEFAULT_MAX_TOKENS_PER_BATCH = 80000;
const DEFAULT_MAX_CONCURRENCY = 3;

/**
 * Split files into batches that fit within the token budget.
 *
 * @param {Array} files - Parsed diff files
 * @param {number} maxTokensPerBatch - Max tokens per batch
 * @returns {Array<Array>} - Array of file batches
 */
function splitIntoBatches(files, maxTokensPerBatch = DEFAULT_MAX_TOKENS_PER_BATCH) {
  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;

  // Sort by change size descending — large files get their own batch
  const sorted = [...files].sort((a, b) => {
    const aTokens = estimateTokens(a.patch);
    const bTokens = estimateTokens(b.patch);
    return bTokens - aTokens;
  });

  for (const file of sorted) {
    const fileTokens = estimateTokens(file.patch);

    if (fileTokens > maxTokensPerBatch) {
      // Single file exceeds budget — it gets its own batch (will be truncated)
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }
      batches.push([file]);
      continue;
    }

    if (currentTokens + fileTokens > maxTokensPerBatch && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(file);
    currentTokens += fileTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Run parallel reviews on multiple file batches.
 *
 * @param {Object} options
 * @param {Array} options.files - All parsed diff files
 * @param {string} options.language - Review language
 * @param {string} options.provider - AI provider
 * @param {string} options.apiKey - API key
 * @param {string} options.apiBaseUrl - API base URL
 * @param {string} options.model - Model name
 * @param {string} options.fallbackModel - Fallback model
 * @param {string} options.customPrompt - Custom prompt
 * @param {Array} options.languageRules - Language rules
 * @param {number} options.maxTokensPerBatch - Token budget per batch
 * @param {number} options.maxConcurrency - Max parallel requests
 * @returns {Object} - Merged review result
 */
async function parallelReview({
  files, language, provider, apiKey, apiBaseUrl, model, fallbackModel,
  customPrompt, languageRules,
  maxTokensPerBatch = DEFAULT_MAX_TOKENS_PER_BATCH,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
}) {
  const { formatDiffForReview } = require('./diff-parser');
  const batches = splitIntoBatches(files, maxTokensPerBatch);

  if (batches.length <= 1) {
    // Single batch — no need for parallel
    const diffText = formatDiffForReview(files);
    return {
      review: await reviewDiff({
        diffText, language, provider, apiKey, apiBaseUrl,
        model, fallbackModel, customPrompt, languageRules,
      }),
      batchCount: 1,
    };
  }

  // Run batches with concurrency limit
  const results = [];
  let idx = 0;

  async function runNext() {
    while (idx < batches.length) {
      const batchIdx = idx++;
      const batch = batches[batchIdx];
      const diffText = formatDiffForReview(batch);

      try {
        const review = await reviewDiff({
          diffText, language, provider, apiKey, apiBaseUrl,
          model, fallbackModel, customPrompt, languageRules,
        });
        results.push({ batchIdx, review, files: batch });
      } catch (error) {
        results.push({ batchIdx, review: null, error: error.message, files: batch });
      }
    }
  }

  // Launch workers
  const workers = [];
  for (let i = 0; i < Math.min(maxConcurrency, batches.length); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);

  // Sort by batch index and merge
  results.sort((a, b) => a.batchIdx - b.batchIdx);

  return mergeReviews(results, batches.length);
}

/**
 * Merge multiple batch review results into a single review.
 */
function mergeReviews(results, totalBatches) {
  const merged = {
    summary: '',
    risk_level: 'low',
    issues: [],
    highlights: [],
  };

  const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
  const errors = [];

  for (const { review, error, batchIdx } of results) {
    if (error) {
      errors.push(`Batch ${batchIdx + 1}: ${error}`);
      continue;
    }
    if (!review) continue;

    // Merge issues
    merged.issues.push(...review.issues);

    // Merge highlights
    merged.highlights.push(...review.highlights);

    // Take highest risk level
    if (riskOrder[review.risk_level] > riskOrder[merged.risk_level]) {
      merged.risk_level = review.risk_level;
    }
  }

  // Build summary
  const parts = [];
  parts.push(`Reviewed in ${totalBatches} batch(es).`);
  parts.push(`Found ${merged.issues.length} issue(s).`);
  if (errors.length > 0) {
    parts.push(`${errors.length} batch(es) had errors.`);
  }
  merged.summary = parts.join(' ');

  // Add batch errors to highlights for visibility
  if (errors.length > 0) {
    merged.highlights.push(...errors.map(e => `⚠️ ${e}`));
  }

  return { review: merged, batchCount: totalBatches };
}

module.exports = { splitIntoBatches, parallelReview, mergeReviews };
