const core = require('@actions/core');
const github = require('@actions/github');
const { parseDiff, truncateDiff, formatDiffForReview } = require('./diff-parser');
const { reviewDiff, formatReviewComment } = require('./reviewer');

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

    // 3. Fetch diff
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
      core.info('Empty diff but skip-if-no-diff is false. Continuing...');
    }

    // 4. Parse and truncate diff
    const files = parseDiff(rawDiff);
    core.info(`📂 Found ${files.length} changed file(s)`);

    const truncatedFiles = truncateDiff(files, maxDiffLines);
    const diffText = formatDiffForReview(truncatedFiles);

    if (truncatedFiles.length < files.length) {
      core.info(`⚠️ Diff truncated from ${files.length} to ${truncatedFiles.length} files (max ${maxDiffLines} lines)`);
    }

    // 5. Run AI review
    core.info(`🤖 Running AI review with ${model} via ${provider}...`);

    const review = await reviewDiff({
      diffText,
      language: reviewLanguage,
      provider,
      apiKey,
      apiBaseUrl,
      model,
    });

    core.info(`✅ Review complete. Risk: ${review.risk_level}, Issues: ${review.issues.length}`);

    // 6. Post comment to PR
    const comment = formatReviewComment(review, reviewLanguage);

    // Check if we already posted a review comment (update instead of duplicate)
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

    // 7. Set outputs
    core.setOutput('risk-level', review.risk_level);
    core.setOutput('issues-count', review.issues.length.toString());
    core.setOutput('summary', review.summary);

    // Fail if critical issues found
    const criticalCount = review.issues.filter(i => i.severity === 'critical').length;
    if (criticalCount > 0) {
      core.setFailed(`🚨 Found ${criticalCount} critical issue(s). Please fix before merging.`);
    }

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
    core.error(error.stack || '');
  }
}

run();
