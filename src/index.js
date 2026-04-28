/**
 * AI Commit Review Bot — Multi-Platform Entry Point
 *
 * Supports: GitHub Actions, GitLab CI, Bitbucket Pipelines, Gitea Actions,
 * or standalone execution on any platform.
 *
 * The core review logic is platform-agnostic. Platform-specific operations
 * (fetching diffs, posting comments, approvals) go through the adapter layer.
 */

// Core modules (platform-agnostic)
const { parseDiff, truncateDiff, formatDiffForReview, mapDiffLineToNewFile, estimateTokens } = require('./core/diff-parser');
const { reviewDiff, formatReviewComment, meetsSeverityThreshold } = require('./core/reviewer');
const { filterFiles } = require('./core/file-filter');
const { loadConfig } = require('./core/config');
const { sendNotifications } = require('./core/notifier');
const { recordReview, formatStatsSummary } = require('./core/stats');

// Platform adapter layer
const { createAdapter, detectPlatform } = require('./platforms');

// ─── Constants ───────────────────────────────────────────────────────────────

const BOT_MARKER = '🤖 Powered by [AI Commit Review Bot]';
const BOT_FOOTER = `🤖 Powered by [AI Commit Review Bot](https://github.com/liushengping/ai-commit-review-bot)`;

// ─── Logging helpers ─────────────────────────────────────────────────────────

let _log = console.log;
let _warn = console.warn;
let _error = console.error;

function setupLogging(platform) {
  // If running in GitHub Actions, use @actions/core logging
  if (process.env.GITHUB_ACTIONS) {
    try {
      const core = require('@actions/core');
      _log = (msg) => core.info(msg);
      _warn = (msg) => core.warning(msg);
      _error = (msg) => core.error(msg);
      return core;
    } catch (e) {}
  }
  // Otherwise, plain console
  _log = (msg) => console.log(`[INFO] ${msg}`);
  _warn = (msg) => console.warn(`[WARN] ${msg}`);
  _error = (msg) => console.error(`[ERROR] ${msg}`);
  return null;
}

// ─── Input validation ────────────────────────────────────────────────────────

function validateInputs(inputs) {
  const errors = [];

  if (!inputs.apiKey) {
    errors.push('API key is required. Set AI_API_KEY or api-key input.');
  }

  if (!inputs.token) {
    errors.push('Platform token is required. Set REVIEW_TOKEN or platform-specific token.');
  }

  if (inputs.apiBaseUrl) {
    try {
      new URL(inputs.apiBaseUrl);
    } catch {
      errors.push(`Invalid API base URL: "${inputs.apiBaseUrl}". Must be a valid URL including protocol (https://).`);
    }
  }

  if (isNaN(inputs.maxDiffLines) || inputs.maxDiffLines < 1) {
    errors.push(`Invalid max-diff-lines: "${inputs.maxDiffLines}". Must be a positive integer.`);
    inputs.maxDiffLines = 500; // reset to default
  }

  if (inputs.blockThreshold && !['none', 'info', 'warning', 'error', 'critical'].includes(inputs.blockThreshold)) {
    errors.push(`Invalid block-threshold: "${inputs.blockThreshold}". Must be one of: none, info, warning, error, critical.`);
  }

  return errors;
}

// ─── Input loading ───────────────────────────────────────────────────────────

function loadInputs() {
  // Support both GitHub Actions inputs and environment variables
  if (process.env.GITHUB_ACTIONS) {
    try {
      const core = require('@actions/core');
      return {
        platform: 'github',
        token: core.getInput('github-token', { required: true }),
        apiKey: core.getInput('api-key', { required: true }),
        apiBaseUrl: core.getInput('api-base-url') || 'https://api.xiaomimimo.com/v1',
        model: core.getInput('model') || 'MiMo-V2.5-Pro',
        provider: core.getInput('provider') || 'openai-compatible',
        maxDiffLines: parseInt(core.getInput('max-diff-lines') || '500', 10),
        reviewLanguage: core.getInput('review-language') || 'zh',
        skipIfNoDiff: core.getInput('skip-if-no-diff') !== 'false',
        autoApprove: core.getInput('auto-approve') === 'true',
        inlineComments: core.getInput('inline-comments') !== 'false',
        blockThreshold: core.getInput('block-threshold') || 'critical',
        fallbackModel: core.getInput('fallback-model') || '',
      };
    } catch (e) {
      // actions/core not available, fall through to env
    }
  }

  // Environment variable based configuration (works on any platform)
  return {
    platform: process.env.REVIEW_PLATFORM || detectPlatform(),
    token: process.env.REVIEW_TOKEN
      || process.env.GITLAB_TOKEN
      || process.env.GITEA_TOKEN
      || process.env.BITBUCKET_TOKEN
      || process.env.GITHUB_TOKEN
      || '',
    apiKey: process.env.AI_API_KEY || process.env.REVIEW_API_KEY || '',
    apiBaseUrl: process.env.AI_API_BASE_URL || process.env.REVIEW_API_BASE_URL || 'https://api.xiaomimimo.com/v1',
    model: process.env.AI_MODEL || process.env.REVIEW_MODEL || 'MiMo-V2.5-Pro',
    provider: process.env.AI_PROVIDER || 'openai-compatible',
    maxDiffLines: parseInt(process.env.REVIEW_MAX_DIFF_LINES || '500', 10),
    reviewLanguage: process.env.REVIEW_LANGUAGE || 'zh',
    skipIfNoDiff: process.env.REVIEW_SKIP_NO_DIFF !== 'false',
    autoApprove: process.env.REVIEW_AUTO_APPROVE === 'true',
    inlineComments: process.env.REVIEW_INLINE_COMMENTS !== 'false',
    blockThreshold: process.env.REVIEW_BLOCK_THRESHOLD || 'critical',
    fallbackModel: process.env.AI_FALLBACK_MODEL || '',
    // Platform-specific extras
    prNumber: process.env.REVIEW_PR_NUMBER || process.env.CI_MERGE_REQUEST_IID || process.env.BITBUCKET_PR_NUMBER || '',
    projectId: process.env.CI_PROJECT_ID || '',
    workspace: process.env.BITBUCKET_WORKSPACE || '',
    repoSlug: process.env.BITBUCKET_REPO_SLUG || '',
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const startTime = Date.now();
  const inputs = loadInputs();
  const actionsCore = setupLogging(inputs.platform);

  // Validate inputs before proceeding
  const validationErrors = validateInputs(inputs);
  if (validationErrors.length > 0) {
    const msg = `Input validation failed:\n${validationErrors.map(e => `  - ${e}`).join('\n')}`;
    if (actionsCore) actionsCore.setFailed(msg);
    else { _error(msg); process.exitCode = 1; }
    return;
  }

  try {
    // 1. Create and authenticate platform adapter
    _log(`🔌 Platform: ${inputs.platform}`);
    const adapter = createAdapter(inputs.platform, {
      prNumber: inputs.prNumber,
      projectId: inputs.projectId,
      workspace: inputs.workspace,
      repoSlug: inputs.repoSlug,
    });

    await adapter.authenticate({ token: inputs.token });
    _log('✅ Authenticated');

    // 2. Get MR/PR context
    const mrInfo = await adapter.getMergeRequestInfo();
    _log(`📝 Reviewing MR/PR #${mrInfo.number}: ${mrInfo.title}`);

    if (mrInfo.isDraft) {
      _log('📝 MR/PR is a draft. Skipping review.');
      return;
    }

    // 3. Load config
    const workspace = process.env.CI_WORKSPACE || process.env.GITHUB_WORKSPACE || process.cwd();
    const config = loadConfig(workspace);
    _log(`⚙️ Config loaded: language=${config.review.language}, auto_approve=${config.review.auto_approve}`);

    // Merge config with inputs
    const effectiveLanguage = inputs.reviewLanguage !== 'zh' ? inputs.reviewLanguage : config.review.language;
    const effectiveAutoApprove = inputs.autoApprove || config.review.auto_approve;
    const effectiveBlockThreshold = inputs.blockThreshold !== 'critical' ? inputs.blockThreshold : config.severity.block_threshold;
    const effectiveInlineThreshold = config.severity.inline_threshold;
    const effectiveFallback = inputs.fallbackModel || config.model?.fallback || '';

    // 4. Incremental review
    let incrementalMode = false;
    let lastReviewSha = null;
    if (config.review.incremental !== false) {
      const lastSha = await adapter.findLastReviewCommit(mrInfo.number, BOT_MARKER);
      if (lastSha) {
        lastReviewSha = lastSha;
        incrementalMode = true;
        _log(`🔄 Incremental mode: reviewing changes since ${lastSha.substring(0, 8)}`);
      }
    }

    // 5. Fetch diff
    const diffOptions = {};
    if (incrementalMode && lastReviewSha) {
      diffOptions.sinceSha = lastReviewSha;
      diffOptions.headSha = mrInfo.headSha;
    }

    const rawDiff = await adapter.getDiff(mrInfo.number, diffOptions);

    if (!rawDiff || rawDiff.trim().length === 0) {
      if (incrementalMode) {
        _log('No new changes since last review. Skipping.');
        return;
      }
      if (inputs.skipIfNoDiff) {
        _log('No code changes detected. Skipping review.');
        return;
      }
    }

    // 6. Parse diff
    const files = parseDiff(rawDiff);
    _log(`📂 Found ${files.length} changed file(s)`);

    // 7. Smart filtering (pass config for ignore patterns)
    const { reviewable, skipped } = filterFiles(files, config);
    _log(`✅ ${reviewable.length} files to review, ${skipped.length} skipped`);

    for (const s of skipped) _log(`  ⏭️ Skipped: ${s.filename} (${s.reason})`);

    if (reviewable.length === 0) {
      _log('No reviewable files after filtering. Skipping review.');
      return;
    }

    // 8. Token-aware truncation
    const { files: truncatedFiles, truncated, totalTokens } = truncateDiff(reviewable, inputs.maxDiffLines);
    if (truncated) _log(`⚠️ Diff truncated to ~${totalTokens} tokens to stay within budget`);
    const diffText = formatDiffForReview(truncatedFiles);

    // 9. Run AI review
    _log(`🤖 Running AI review with ${inputs.model}${effectiveFallback ? ` (fallback: ${effectiveFallback})` : ''} via ${inputs.provider}...`);

    const review = await reviewDiff({
      diffText, language: effectiveLanguage, provider: inputs.provider,
      apiKey: inputs.apiKey, apiBaseUrl: inputs.apiBaseUrl,
      model: inputs.model, fallbackModel: effectiveFallback,
      customPrompt: config.custom_prompt, languageRules: config.language_rules,
    });

    const duration = Math.round((Date.now() - startTime) / 1000);
    _log(`✅ Review complete. Risk: ${review.risk_level}, Issues: ${review.issues.length} (${duration}s)`);

    // 10. Map line numbers
    const fileLineMaps = new Map();
    for (const file of truncatedFiles) {
      if (file.lineMapping) fileLineMaps.set(file.filename, file.lineMapping);
    }

    for (const issue of review.issues) {
      const mapping = fileLineMaps.get(issue.file);
      if (mapping) {
        const actualLine = mapDiffLineToNewFile(mapping, issue.line);
        if (actualLine !== null) issue.line = actualLine;
      }
    }

    // 11. Post summary comment
    const totalAdditions = truncatedFiles.reduce((s, f) => s + f.additions, 0);
    const totalDeletions = truncatedFiles.reduce((s, f) => s + f.deletions, 0);

    const comment = formatReviewComment(review, effectiveLanguage, {
      skippedFiles: skipped, model: inputs.model,
      incremental: incrementalMode, truncated, totalTokens,
      stats: {
        filesReviewed: reviewable.length, filesSkipped: skipped.length,
        additions: totalAdditions, deletions: totalDeletions, duration,
      },
    });

    const commentAction = await adapter.postOrUpdateSummaryComment(mrInfo.number, comment, BOT_MARKER);
    _log(`📌 ${commentAction === 'updated' ? 'Updated' : 'Posted'} review comment.`);

    // 12. Post inline comments
    if (inputs.inlineComments && review.issues.length > 0) {
      const issuesForInline = review.issues.filter(i =>
        i.line > 0 && meetsSeverityThreshold(i.severity, effectiveInlineThreshold)
      );

      if (issuesForInline.length > 0) {
        const inlineComments = issuesForInline.map(issue => ({
          file: issue.file,
          line: issue.line,
          body: formatInlineComment(issue),
        }));

        await adapter.postInlineComments(mrInfo.number, inlineComments);
        _log(`📌 Posted ${inlineComments.length} inline comment(s).`);
      }
    }

    // 13. Set outputs (GitHub Actions)
    if (actionsCore) {
      actionsCore.setOutput('risk-level', review.risk_level);
      actionsCore.setOutput('issues-count', review.issues.length.toString());
      actionsCore.setOutput('summary', review.summary);
    }

    // 14. Block if threshold met
    const shouldBlock = review.issues.some(i => meetsSeverityThreshold(i.severity, effectiveBlockThreshold));
    if (shouldBlock) {
      const criticalCount = review.issues.filter(i => meetsSeverityThreshold(i.severity, effectiveBlockThreshold)).length;
      const msg = `🚨 Found ${criticalCount} issue(s) at or above ${effectiveBlockThreshold} level. Please fix before merging.`;
      if (actionsCore) actionsCore.setFailed(msg);
      else { _error(msg); process.exitCode = 1; }
    }

    // 15. Auto-approve
    if (effectiveAutoApprove && review.issues.length === 0) {
      try {
        await adapter.approve(mrInfo.number,
          '✅ AI Code Review passed with no issues. Auto-approved by AI Commit Review Bot.');
        _log('✅ Auto-approved MR/PR (no issues found).');
      } catch (e) {
        _warn(`Could not auto-approve: ${e.message}`);
      }
    }

    // 16. Auto-label
    if (config.labels?.enabled) {
      try {
        const prefix = config.labels.prefix || 'ai-review';
        const labels = [`${prefix}:${review.risk_level}`];
        const categories = new Set(review.issues.map(i => i.category));
        for (const cat of categories) labels.push(`${prefix}:${cat}`);
        await adapter.addLabels(mrInfo.number, labels);
        _log(`🏷️ Added labels: ${labels.join(', ')}`);
      } catch (e) {
        _warn(`Could not add labels: ${e.message}`);
      }
    }

    // 17. Record statistics
    if (config.stats?.enabled !== false) {
      recordReview(workspace, review, {
        prNumber: mrInfo.number, prTitle: mrInfo.title,
        filesReviewed: reviewable.length, filesSkipped: skipped.length,
        model: inputs.model, duration,
      });

      if (actionsCore) {
        try {
          const { loadStats } = require('./core/stats');
          const stats = loadStats(workspace);
          actionsCore.summary?.addRaw(formatStatsSummary(stats));
          await actionsCore.summary?.write();
        } catch (e) {}
      }
    }

    // 18. Webhook notifications
    if (config.webhooks && config.webhooks.length > 0) {
      const prUrl = adapter.getMergeRequestUrl(mrInfo.number);
      await sendNotifications({ review, prUrl, prTitle: mrInfo.title, webhooks: config.webhooks });
      _log('📢 Webhook notifications sent.');
    }

  } catch (error) {
    const msg = `Action failed: ${error.message}`;
    if (actionsCore) {
      actionsCore.setFailed(msg);
      actionsCore.error(error.stack || '');
    } else {
      _error(msg);
      if (error.stack) _error(error.stack);
      process.exitCode = 1;
    }
  }
}

/**
 * Format an issue as an inline comment
 */
function formatInlineComment(issue) {
  const severityEmoji = { info: 'ℹ️', warning: '⚠️', error: '❌', critical: '🚨' };
  const categoryLabel = {
    bug: '🐛 Bug', security: '🔒 Security', performance: '⚡ Performance',
    quality: '📝 Quality', missing: '📋 Missing',
  };

  const emoji = severityEmoji[issue.severity] || '⚠️';
  const category = categoryLabel[issue.category] || issue.category;

  let comment = `${emoji} **${category}**\n\n${issue.description}`;
  if (issue.suggestion) comment += `\n\n💡 **Suggestion:** ${issue.suggestion}`;
  return comment;
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

let _shuttingDown = false;

function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`\n[INFO] Received ${signal}, shutting down gracefully...`);
  // Give pending I/O a moment to complete
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Run ─────────────────────────────────────────────────────────────────────

run();

module.exports = { run, loadInputs, detectPlatform, BOT_MARKER, BOT_FOOTER };
