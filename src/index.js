const core = require('@actions/core');
const github = require('@actions/github');
const path = require('path');
const { parseDiff, truncateDiff, formatDiffForReview } = require('./diff-parser');
const { reviewDiff, formatReviewComment, meetsSeverityThreshold } = require('./reviewer');
const { filterFiles } = require('./file-filter');
const { loadConfig } = require('./config');

async function run() {
  try {
    // 1. Get inputs
    const githubToken = core.getInput('github-token', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const apiBaseUrl = core.getInput('api-base-url') || 'https://api.xiaomimimo.com/v1';
    const model = core.getInput('model') || 'MiMo-V2.5-Pro';
    const provider = core.getInput('provider') || 'openai-compatible';
    const maxDiffLines = parseInt(core.getInput('max-diff-lines') || '500', 10);
    const reviewLanguage = core.getInput('review-language') || 'zh';
    const skipIfNoDiff = core.getInput('skip-if-no-diff') !== 'false';
    const autoApprove = core.getInput('auto-approve') === 'true';
    const inlineComments = core.getInput('inline-comments') !== 'false';
    const blockThreshold = core.getInput('block-threshold') || 'critical';

    // 2. Get PR context
    const context = github.context;
    const pr = context.payload.pull_request;
    if (!pr) {
      core.warning('This action only works on pull_request events. Skipping.');
      return;
    }

    const octokit = github.getOctokit(githubToken);
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const pullNumber = pr.number;

    core.info(`📝 Reviewing PR #${pullNumber}: ${pr.title}`);

    // 3. Load config from repo (.review.yml)
    const config = loadConfig(process.env.GITHUB_WORKSPACE || '.');
    core.info(`⚙️ Config loaded: language=${config.review.language}, auto_approve=${config.review.auto_approve}`);

    // Merge config with inputs (inputs take precedence)
    const effectiveLanguage = reviewLanguage !== 'zh' ? reviewLanguage : config.review.language;
    const effectiveAutoApprove = autoApprove || config.review.auto_approve;
    const effectiveBlockThreshold = blockThreshold !== 'critical' ? blockThreshold : config.severity.block_threshold;
    const effectiveInlineThreshold = config.severity.inline_threshold;

    // 4. Fetch diff
    const { data: diffData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: 'diff' },
    });

    const rawDiff = typeof diffData === 'string' ? diffData : '';

    if (!rawDiff || rawDiff.trim().length === 0) {
      if (skipIfNoDiff) {
        core.info('No code changes detected. Skipping review.');
        return;
      }
    }

    // 5. Parse diff
    const files = parseDiff(rawDiff);
    core.info(`📂 Found ${files.length} changed file(s)`);

    // 6. Smart filtering
    const { reviewable, skipped } = filterFiles(files);
    core.info(`✅ ${reviewable.length} files to review, ${skipped.length} skipped`);

    if (skipped.length > 0) {
      for (const s of skipped) {
        core.info(`  ⏭️ Skipped: ${s.filename} (${s.reason})`);
      }
    }

    if (reviewable.length === 0) {
      core.info('No reviewable files after filtering. Skipping review.');
      return;
    }

    // 7. Truncate and format diff
    const truncatedFiles = truncateDiff(reviewable, maxDiffLines);
    const diffText = formatDiffForReview(truncatedFiles);

    // 8. Run AI review
    core.info(`🤖 Running AI review with ${model} via ${provider}...`);

    const review = await reviewDiff({
      diffText,
      language: effectiveLanguage,
      provider,
      apiKey,
      apiBaseUrl,
      model,
      customPrompt: config.custom_prompt,
    });

    core.info(`✅ Review complete. Risk: ${review.risk_level}, Issues: ${review.issues.length}`);

    // 9. Post summary comment to PR
    const comment = formatReviewComment(review, effectiveLanguage, {
      skippedFiles: skipped,
      model,
    });

    const BOT_MARKER = '🤖 Powered by [AI Commit Review Bot]';
    const { data: existingComments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    });

    const existingBotComment = existingComments.find(
      c => c.body && c.body.includes(BOT_MARKER)
    );

    if (existingBotComment) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingBotComment.id,
        body: comment,
      });
      core.info('📌 Updated existing review comment.');
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: comment,
      });
      core.info('📌 Posted new review comment.');
    }

    // 10. Post inline comments on specific lines
    if (inlineComments && review.issues.length > 0) {
      await postInlineComments(octokit, owner, repo, pullNumber, review, diffData, effectiveInlineThreshold);
    }

    // 11. Set outputs
    core.setOutput('risk-level', review.risk_level);
    core.setOutput('issues-count', review.issues.length.toString());
    core.setOutput('summary', review.summary);

    // 12. Block PR if severity threshold met
    const shouldBlock = review.issues.some(i => meetsSeverityThreshold(i.severity, effectiveBlockThreshold));
    if (shouldBlock) {
      const criticalCount = review.issues.filter(i => meetsSeverityThreshold(i.severity, effectiveBlockThreshold)).length;
      core.setFailed(`🚨 Found ${criticalCount} issue(s) at or above ${effectiveBlockThreshold} level. Please fix before merging.`);
    }

    // 13. Auto-approve if no issues and enabled
    if (effectiveAutoApprove && review.issues.length === 0) {
      try {
        await octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: pullNumber,
          event: 'APPROVE',
          body: '✅ AI Code Review passed with no issues. Auto-approved by AI Commit Review Bot.',
        });
        core.info('✅ Auto-approved PR (no issues found).');
      } catch (e) {
        core.warning(`Could not auto-approve PR: ${e.message}`);
      }
    }

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
    core.error(error.stack || '');
  }
}

/**
 * Post inline review comments on specific code lines
 */
async function postInlineComments(octokit, owner, repo, pullNumber, review, diffData, threshold) {
  const issuesForInline = review.issues.filter(i =>
    i.line > 0 && meetsSeverityThreshold(i.severity, threshold)
  );

  if (issuesForInline.length === 0) {
    core.info('No issues meet inline comment threshold.');
    return;
  }

  // Build inline comments as a pull request review
  const comments = [];

  for (const issue of issuesForInline) {
    // Find the matching file in the diff to get the right side (new file) line number
    const lineNum = issue.line;

    comments.push({
      path: issue.file,
      line: lineNum,
      body: formatInlineComment(issue),
    });
  }

  if (comments.length === 0) return;

  // GitHub API limits: max 50 comments per review
  const batched = comments.slice(0, 50);

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      event: 'COMMENT',
      body: `AI Review found ${batched.length} issue(s) with inline comments below.`,
      comments: batched,
    });
    core.info(`📌 Posted ${batched.length} inline comment(s).`);
  } catch (e) {
    // If inline comments fail (e.g., line not in diff), fall back to individual comments
    core.warning(`Inline review failed (${e.message}), trying individual comments...`);

    for (const comment of batched) {
      try {
        await octokit.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number: pullNumber,
          body: comment.body,
          path: comment.path,
          line: comment.line,
        });
      } catch (e2) {
        core.warning(`Could not comment on ${comment.path}:${comment.line}: ${e2.message}`);
      }
    }
  }
}

/**
 * Format a single inline comment
 */
function formatInlineComment(issue) {
  const severityEmoji = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
    critical: '🚨',
  };

  const emoji = severityEmoji[issue.severity] || '⚠️';
  let body = `${emoji} **${issue.category.toUpperCase()}**: ${issue.description}`;
  if (issue.suggestion) {
    body += `\n\n💡 **Suggestion:** ${issue.suggestion}`;
  }
  return body;
}

run();
