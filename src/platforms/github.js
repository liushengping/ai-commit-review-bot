/**
 * GitHub Platform Adapter
 *
 * Uses @actions/core and @actions/github when running as a GitHub Action.
 * Falls back to direct Octokit REST API calls when running standalone.
 */
const PlatformAdapter = require('./adapter');

class GitHubAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super(config);
    this.octokit = null;
    this.context = null;
    this._isAction = !!process.env.GITHUB_ACTIONS;
  }

  get platformName() { return 'github'; }

  async authenticate(credentials) {
    const { token } = credentials;

    if (this._isAction) {
      // Running inside GitHub Actions — use @actions/github
      const github = require('@actions/github');
      this.context = github.context;
      this.octokit = github.getOctokit(token);
    } else {
      // Standalone mode — use Octokit directly
      let Octokit;
      try {
        ({ Octokit } = require('@octokit/rest'));
      } catch (e) {
        throw new Error(
          '@octokit/rest not found. Install it: npm install @octokit/rest\n' +
          'Or run inside GitHub Actions where @actions/github is available.'
        );
      }
      this.octokit = new Octokit({ auth: token });
      this.context = this._detectContext();
    }
  }

  _detectContext() {
    // Support GITHUB_REPOSITORY env var (owner/repo format)
    const repo = process.env.GITHUB_REPOSITORY || '';
    const [owner, repoName] = repo.split('/');
    return {
      repo: { owner: owner || '', repo: repoName || '' },
      payload: this._loadPayload(),
    };
  }

  _loadPayload() {
    // Try to load from GITHUB_EVENT_PATH
    const fs = require('fs');
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath && fs.existsSync(eventPath)) {
      try { return JSON.parse(fs.readFileSync(eventPath, 'utf8')); } catch (e) {}
    }
    return {};
  }

  async getMergeRequestInfo() {
    if (this._isAction) {
      const pr = this.context.payload.pull_request;
      if (!pr) throw new Error('No pull_request in GitHub event payload');
      return {
        number: pr.number,
        title: pr.title,
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        isDraft: !!pr.draft,
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
      };
    }

    // Standalone: fetch PR info from API
    const { owner, repo } = this.context.repo;
    const prNumber = this.context.payload.pull_request?.number || this.config.prNumber;
    if (!prNumber) throw new Error('PR number not found. Set GITHUB_EVENT_PATH or pass prNumber.');

    const { data: pr } = await this.octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    return {
      number: pr.number, title: pr.title,
      sourceBranch: pr.head.ref, targetBranch: pr.base.ref,
      headSha: pr.head.sha, baseSha: pr.base.sha,
      isDraft: !!pr.draft, owner, repo,
    };
  }

  async getDiff(mrNumber, options = {}) {
    const { owner, repo } = this.context.repo;

    if (options.sinceSha) {
      const { data: comparisonData } = await this.octokit.rest.repos.compareCommits({
        owner, repo, base: options.sinceSha, head: options.headSha,
        mediaType: { format: 'diff' },
      });
      return typeof comparisonData === 'string' ? comparisonData : '';
    }

    const { data: diffData } = await this.octokit.rest.pulls.get({
      owner, repo, pull_number: mrNumber, mediaType: { format: 'diff' },
    });
    return typeof diffData === 'string' ? diffData : '';
  }

  async postOrUpdateSummaryComment(mrNumber, body, botMarker) {
    const { owner, repo } = this.context.repo;

    const { data: existingComments } = await this.octokit.rest.issues.listComments({
      owner, repo, issue_number: mrNumber, per_page: 100,
    });

    const existingBotComment = existingComments.find(
      c => c.body && c.body.includes(botMarker)
    );

    if (existingBotComment) {
      await this.octokit.rest.issues.updateComment({
        owner, repo, comment_id: existingBotComment.id, body,
      });
      return 'updated';
    }

    await this.octokit.rest.issues.createComment({
      owner, repo, issue_number: mrNumber, body,
    });
    return 'created';
  }

  async postInlineComments(mrNumber, comments) {
    const { owner, repo } = this.context.repo;

    // Try batch review first
    const reviewComments = comments.map(c => ({
      path: c.file, line: c.line, body: c.body,
    }));

    try {
      await this.octokit.rest.pulls.createReview({
        owner, repo, pull_number: mrNumber,
        event: 'COMMENT',
        body: `AI Review found ${reviewComments.length} issue(s) with inline comments below.`,
        comments: reviewComments.slice(0, 50),
      });
    } catch (e) {
      // Fallback to individual comments
      for (const comment of reviewComments) {
        try {
          await this.octokit.rest.pulls.createReviewComment({
            owner, repo, pull_number: mrNumber,
            body: comment.body, path: comment.path, line: comment.line,
          });
        } catch (e2) {
          console.warn(`Could not comment on ${comment.path}:${comment.line}: ${e2.message}`);
        }
      }
    }
  }

  async approve(mrNumber, body) {
    const { owner, repo } = this.context.repo;
    await this.octokit.rest.pulls.createReview({
      owner, repo, pull_number: mrNumber, event: 'APPROVE', body,
    });
  }

  async addLabels(mrNumber, labels) {
    const { owner, repo } = this.context.repo;

    for (const label of labels) {
      try {
        await this.octokit.rest.issues.getLabel({ owner, repo, name: label });
      } catch {
        // Label doesn't exist, create it
        const colors = { low: '0e8a16', medium: 'fbca04', high: 'e11d48', critical: 'b60205' };
        const prefix = label.split(':')[1] || '';
        try {
          await this.octokit.rest.issues.createLabel({
            owner, repo, name: label, color: colors[prefix] || 'ededed',
          });
        } catch {}
      }
    }

    await this.octokit.rest.issues.addLabels({
      owner, repo, issue_number: mrNumber, labels,
    });
  }

  async findLastReviewCommit(mrNumber, botMarker) {
    try {
      const { owner, repo } = this.context.repo;

      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner, repo, issue_number: mrNumber, per_page: 100,
      });

      const botComments = comments
        .filter(c => c.body && c.body.includes(botMarker))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (botComments.length === 0) return null;

      const { data: commits } = await this.octokit.rest.pulls.listCommits({
        owner, repo, pull_number: mrNumber, per_page: 100,
      });

      const lastBotReviewTime = new Date(botComments[0].created_at);
      let lastSha = null;
      for (const commit of commits) {
        const commitTime = new Date(commit.commit.committer.date);
        if (commitTime <= lastBotReviewTime) lastSha = commit.sha;
      }

      return lastSha;
    } catch (e) {
      console.warn(`Could not determine incremental base: ${e.message}`);
      return null;
    }
  }

  getMergeRequestUrl(mrNumber) {
    const { owner, repo } = this.context.repo;
    return `https://github.com/${owner}/${repo}/pull/${mrNumber}`;
  }
}

module.exports = GitHubAdapter;
