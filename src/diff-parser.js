/**
 * Parse GitHub PR diff into structured chunks for AI review.
 * Handles unified diff format from GitHub API.
 * 
 * Features:
 * - Line number mapping (diff line → new file actual line)
 * - Global token estimation and truncation
 * - Per-file diff context
 */

/**
 * Parse raw diff string into file-level changes with line mapping
 * @param {string} rawDiff - Unified diff string from GitHub API
 * @returns {Array<ParsedFile>}
 */
function parseDiff(rawDiff) {
  if (!rawDiff || typeof rawDiff !== 'string') return [];

  const files = [];
  const fileChunks = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');

    // Extract filename from "a/path b/path"
    const headerLine = lines[0] || '';
    const match = headerLine.match(/a\/(.+?) b\/(.+)/);
    if (!match) continue;

    const filename = match[2];

    // Determine file status — check header line AND the next few lines
    // (new file mode / deleted file mode may appear on the line after "diff --git")
    let status = 'modified';
    const chunkHeader = lines.slice(0, 5).join(' ');
    if (chunkHeader.includes('new file')) status = 'added';
    else if (chunkHeader.includes('deleted file')) status = 'deleted';
    else if (chunkHeader.includes('rename')) status = 'renamed';

    // Count additions and deletions, build line mapping
    let additions = 0;
    let deletions = 0;
    const patchLines = [];
    const lineMapping = []; // { diffLineIndex, newFileLine, type: '+'|'-'|' ' }
    let newFileLine = 0;
    let diffLineIndex = 0;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -old,count +new,count @@
        const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          newFileLine = parseInt(hunkMatch[1], 10);
        }
        // Don't add hunk header to patchLines or lineMapping — it's metadata only
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
        patchLines.push(line);
        lineMapping.push({ diffLineIndex, newFileLine, type: '+' });
        newFileLine++;
        diffLineIndex++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
        patchLines.push(line);
        lineMapping.push({ diffLineIndex, newFileLine: null, type: '-' });
        diffLineIndex++;
      } else if (!line.startsWith('diff') && !line.startsWith('index') &&
                 !line.startsWith('---') && !line.startsWith('+++')) {
        patchLines.push(' ' + line);
        lineMapping.push({ diffLineIndex, newFileLine, type: ' ' });
        newFileLine++;
        diffLineIndex++;
      }
    }

    files.push({
      filename,
      status,
      additions,
      deletions,
      patch: patchLines.join('\n'),
      lineMapping,
    });
  }

  return files;
}

/**
 * Map a diff-line number to the actual new-file line number.
 * Returns null if the line is a deletion or cannot be mapped.
 * @param {Array} lineMapping - From parseDiff
 * @param {number} diffLineNum - 1-based line number in the diff patch
 * @returns {number|null}
 */
function mapDiffLineToNewFile(lineMapping, diffLineNum) {
  if (!lineMapping || lineMapping.length === 0) return null;
  const idx = diffLineNum - 1;
  // Find entry by diffLineIndex (array may not be sequential due to @@ headers)
  const entry = lineMapping.find(m => m.diffLineIndex === idx);
  if (!entry || entry.type === '-') return null;
  return entry.newFileLine;
}

/**
 * Estimate token count (rough: 1 token ≈ 4 chars for English, ~2 chars for CJK)
 */
function estimateTokens(text) {
  // Count CJK characters for better estimation
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  const nonCjkLength = text.length - cjkCount;
  return Math.ceil(nonCjkLength / 4 + cjkCount / 2);
}

/**
 * Global token-aware truncation across all files.
 * Prioritizes files with more changes.
 * @param {Array} files - Parsed file changes
 * @param {number} maxLines - Per-file line limit
 * @param {number} maxTotalTokens - Total token budget (default 100k)
 * @returns {{ files: Array, truncated: boolean, totalTokens: number }}
 */
function truncateDiff(files, maxLines = 500, maxTotalTokens = 100000) {
  // First: per-file line truncation
  let processedFiles = [];
  for (const file of files) {
    const lines = file.patch.split('\n');
    if (lines.length > maxLines) {
      processedFiles.push({
        ...file,
        patch: lines.slice(0, maxLines).join('\n') + '\n... (truncated)',
        lineMapping: file.lineMapping ? file.lineMapping.slice(0, maxLines) : undefined,
      });
    } else {
      processedFiles.push(file);
    }
  }

  // Sort by change count (descending) so most-changed files get priority
  const sorted = [...processedFiles].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));

  let totalTokens = 0;
  const result = [];
  let globalTruncated = false;

  for (const file of sorted) {
    const fileTokens = estimateTokens(file.patch);
    if (totalTokens + fileTokens > maxTotalTokens) {
      // Try to include a truncated version
      const remaining = maxTotalTokens - totalTokens;
      if (remaining > 2000) { // At least 2k tokens for a meaningful snippet
        const charBudget = remaining * 4; // rough back-conversion
        const truncatedPatch = file.patch.substring(0, charBudget) + '\n... (truncated - token limit)';
        result.push({ ...file, patch: truncatedPatch });
        totalTokens += estimateTokens(truncatedPatch);
      }
      globalTruncated = true;
      break;
    }
    result.push(file);
    totalTokens += fileTokens;
  }

  // Restore original file order
  const orderMap = new Map(processedFiles.map((f, i) => [f.filename, i]));
  result.sort((a, b) => (orderMap.get(a.filename) || 0) - (orderMap.get(b.filename) || 0));

  return { files: result, truncated: globalTruncated, totalTokens };
}

/**
 * Format parsed files into a readable diff summary for AI consumption
 */
function formatDiffForReview(files) {
  if (files.length === 0) return 'No code changes detected.';

  const parts = [];
  parts.push(`Total files changed: ${files.length}\n`);

  for (const file of files) {
    parts.push(`--- File: ${file.filename} (${file.status}) [+${file.additions} -${file.deletions}] ---`);
    parts.push(file.patch);
    parts.push('');
  }

  return parts.join('\n');
}

module.exports = { parseDiff, truncateDiff, formatDiffForReview, mapDiffLineToNewFile, estimateTokens };
