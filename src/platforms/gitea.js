/**
 * Gitea Platform Adapter
 *
 * Supports Gitea instances (gitea.com or self-hosted).
 * Gitea's API is very similar to GitHub's, making this adapter straightforward.
 *
 * Required environment variables (or config):
 *   GITEA_TOKEN         - Access token
 *   GITEA_URL           - Gitea instance URL (default: http://localhost:3000)
 *   GITEA_REPO_OWNER    - Repository owner
 *   GITEA_REPO_NAME     - Repository name
 *   GITEA_PR_NUMBER     - PR number (if not in webhook payload)
 */
const https = require('https');
const http = require('http');
const PlatformAdapter = require('./adapter');

class GiteaAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super(config);
    this.token = null;
    this.baseUrl = null;
    this.owner = null;
    this.repo = null;
  }

  get platformName() { return 'gitea'; }

  async authenticate(credentials) {
    this.token = credentials.token || process.env.GITEA_TOKEN;
    if (!this.token) throw new Error('Gitea token required. Set GITEA_TOKEN or pass credentials.token.');

    this.baseUrl = (credentials.url || process.env.GITEA_URL || 'http://localhost:3000').replace(/\/+$/, '');
    this.owner = credentials.owner || process.env.GITEA_REPO_OWNER;
    this.repo = credentials.repo || process.env.GITEA_REPO_NAME;

    if (!this.owner || !this.repo) {
      // Try GITEA_REPO_SLUG (owner/repo format)
      const slug = process.env.GITEA_REPO_SLUG || '';
      const [o, r] = slug.split('/');
      if (o) this.owner = this.owner || o;
      if (r) this.repo = this.repo || r;
    }
  }

  async getMergeRequestInfo() {
    const prNumber = this.config.prNumber || process.env.GITEA_PR_NUMBER;
    if (!prNumber) throw new Error('PR number not found. Set GITEA_PR_NUMBER or pass config.prNumber.');

    const pr = await this._api('GET', `/repos/${this.owner}/${this.repo}/pulls/${prNumber}`);
    return {
      number: pr.number,
      title: pr.title,
      sourceBranch: pr.head?.ref || '',
      targetBranch: pr.base?.ref || '',
      headSha: pr.head?.sha || '',
      baseSha: pr.base?.sha || '',
      isDraft: !!pr.draft || !!pr.work_in_progress,
      owner: this.owner,
      repo: this.repo,
    };
  }

  async getDiff(mrNumber, options = {}) {
    if (options.sinceSha) {
      // Gitea compare API
      const diff = await this._api('GET',
        `/repos/${this.owner}/${this.repo}/compare/${options.sinceSha}...${options.headSha}`,
        {}, 'text'
      );
      return typeof diff === 'string' ? diff : '';
    }

    // Get PR diff
    const diff = await this._api('GET',
      `/repos/${this.owner}/${this.repo}/pulls/${mrNumber}.diff`,
      {}, 'text'
    );
    return typeof diff === 'string' ? diff : '';
  }

  async postOrUpdateSummaryComment(mrNumber, body, botMarker) {
    // List existing comments
    const comments = await this._api('GET',
      `/repos/${this.owner}/${this.repo}/issues/${mrNumber}/comments`,
      { sort: 'created', direction: 'desc', limit: '100' }
    );

    const existingBotComment = comments.find(
      c => c.body && c.body.includes(botMarker)
    );

    if (existingBotComment) {
      await this._api('PATCH',
        `/repos/${this.owner}/${this.repo}/issues/comments/${existingBotComment.id}`,
        { body }
      );
      return 'updated';
    }

    await this._api('POST',
      `/repos/${this.owner}/${this.repo}/issues/${mrNumber}/comments`,
      { body }
    );
    return 'created';
  }

  async postInlineComments(mrNumber, comments) {
    // Gitea supports inline comments via the pull request review API
    // First, try batch review
    try {
      const reviewComments = comments.map(c => ({
        body: c.body,
        path: c.file,
        new_line_number: c.line,
      }));

      await this._api('POST',
        `/repos/${this.owner}/${this.repo}/pulls/${mrNumber}/reviews`,
        {
          body: `AI Review found ${comments.length} issue(s) with inline comments below.`,
          event: 'COMMENT',
          comments: reviewComments.slice(0, 50),
        }
      );
    } catch (e) {
      // Fallback to individual comments
      for (const comment of comments) {
        try {
          await this._api('POST',
            `/repos/${this.owner}/${this.repo}/pulls/${mrNumber}/reviews`,
            {
              body: `**${comment.file}:${comment.line}**\n\n${comment.body}`,
              event: 'COMMENT',
              comments: [{
                body: comment.body,
                path: comment.file,
                new_line_number: comment.line,
              }],
            }
          );
        } catch (e2) {
          // Last resort: plain issue comment
          try {
            await this._api('POST',
              `/repos/${this.owner}/${this.repo}/issues/${mrNumber}/comments`,
              { body: `**${comment.file}:${comment.line}**\n\n${comment.body}` }
            );
          } catch (e3) {
            console.warn(`Could not comment on ${comment.file}:${comment.line}: ${e3.message}`);
          }
        }
      }
    }
  }

  async approve(mrNumber, body) {
    try {
      await this._api('POST',
        `/repos/${this.owner}/${this.repo}/pulls/${mrNumber}/reviews`,
        { body: body || '✅ Auto-approved by AI Commit Review Bot.', event: 'APPROVE' }
      );
    } catch (e) {
      console.warn(`Could not approve PR: ${e.message}`);
      // Post note instead
      await this._api('POST',
        `/repos/${this.owner}/${this.repo}/issues/${mrNumber}/comments`,
        { body: body || '✅ AI Code Review passed. Auto-approved by AI Commit Review Bot.' }
      );
    }
  }

  async addLabels(mrNumber, labels) {
    // Gitea labels need to exist first — create if needed
    const existingLabels = await this._api('GET',
      `/repos/${this.owner}/${this.repo}/labels`
    );
    const existingNames = new Set(existingLabels.map(l => l.name));

    for (const label of labels) {
      if (!existingNames.has(label)) {
        const colors = { low: '0e8a16', medium: 'fbca04', high: 'e11d48', critical: 'b60205' };
        const prefix = label.split(':')[1] || '';
        try {
          await this._api('POST', `/repos/${this.owner}/${this.repo}/labels`, {
            name: label,
            color: '#' + (colors[prefix] || 'ededed'),
          });
        } catch {}
      }
    }

    // Add labels to PR
    const currentLabels = await this._api('GET',
      `/repos/${this.owner}/${this.repo}/issues/${mrNumber}/labels`
    );
    const allLabelNames = [...new Set([...currentLabels.map(l => l.name), ...labels])];

    await this._api('PUT',
      `/repos/${this.owner}/${this.repo}/issues/${mrNumber}/labels`,
      { labels: allLabelNames }
    );
  }

  async findLastReviewCommit(mrNumber, botMarker) {
    try {
      const comments = await this._api('GET',
        `/repos/${this.owner}/${this.repo}/issues/${mrNumber}/comments`,
        { sort: 'created', direction: 'desc', limit: '100' }
      );

      const botComments = comments
        .filter(c => c.body && c.body.includes(botMarker))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (botComments.length === 0) return null;

      const lastBotReviewTime = new Date(botComments[0].created_at);

      // Get commits
      const commits = await this._api('GET',
        `/repos/${this.owner}/${this.repo}/pulls/${mrNumber}/commits`
      );

      // Gitea commits are ordered oldest-first
      let lastSha = null;
      for (const commit of commits) {
        const commitDate = new Date(commit.commit?.committer?.date || commit.created);
        if (commitDate <= lastBotReviewTime) lastSha = commit.sha;
      }

      return lastSha;
    } catch (e) {
      console.warn(`Could not determine incremental base: ${e.message}`);
      return null;
    }
  }

  getMergeRequestUrl(mrNumber) {
    return `${this.baseUrl}/${this.owner}/${this.repo}/pulls/${mrNumber}`;
  }

  /**
   * Make a Gitea API request
   */
  async _api(method, path, params = {}, responseType = 'json') {
    const url = new URL(`/api/v1${path}`, this.baseUrl);

    if (method === 'GET') {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const body = method !== 'GET' && responseType === 'json' ? JSON.stringify(params) : null;

    return new Promise((resolve, reject) => {
      const headers = {
        'Authorization': `token ${this.token}`,
        'Content-Type': 'application/json',
      };
      if (body) headers['Content-Length'] = Buffer.byteLength(body);

      const req = transport.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (responseType === 'text') {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
            else reject(new Error(`Gitea API ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }

          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              const err = new Error(`Gitea API ${res.statusCode}: ${json.message || data.substring(0, 200)}`);
              err.statusCode = res.statusCode;
              reject(err);
              return;
            }
            resolve(json);
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
            else reject(new Error(`Gitea API ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Gitea API timeout (30s)')); });
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = GiteaAdapter;
