/**
 * Bitbucket Platform Adapter
 *
 * Supports Bitbucket Cloud (bitbucket.org) and Bitbucket Server (Data Center).
 *
 * Required environment variables (or config):
 *   BITBUCKET_TOKEN      - App password (Cloud) or personal access token (Server)
 *   BITBUCKET_USERNAME   - Username (Cloud only, for auth)
 *   BITBUCKET_URL        - Instance URL (default: https://api.bitbucket.org for Cloud)
 *   BITBUCKET_WORKSPACE  - Workspace/team (Cloud) or project key (Server)
 *   BITBUCKET_REPO_SLUG  - Repository slug
 *   BITBUCKET_PR_NUMBER  - PR number
 *
 * Auto-set in Bitbucket Pipelines:
 *   BITBUCKET_WORKSPACE, BITBUCKET_REPO_SLUG, BITBUCKET_PR_NUMBER (not auto-set)
 */
const https = require('https');
const http = require('http');
const PlatformAdapter = require('./adapter');

class BitbucketAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super(config);
    this.token = null;
    this.username = null;
    this.baseUrl = null;
    this.workspace = null;
    this.repoSlug = null;
    this._isCloud = true;
  }

  get platformName() { return 'bitbucket'; }

  async authenticate(credentials) {
    this.token = credentials.token || process.env.BITBUCKET_TOKEN;
    if (!this.token) throw new Error('Bitbucket token required. Set BITBUCKET_TOKEN or pass credentials.token.');

    this.username = credentials.username || process.env.BITBUCKET_USERNAME || '';
    this.baseUrl = (credentials.url || process.env.BITBUCKET_URL || 'https://api.bitbucket.org').replace(/\/+$/, '');
    this.workspace = credentials.workspace || process.env.BITBUCKET_WORKSPACE;
    this.repoSlug = credentials.repoSlug || process.env.BITBUCKET_REPO_SLUG;

    // Detect Cloud vs Server
    this._isCloud = this.baseUrl.includes('bitbucket.org') || this.baseUrl.includes('api.bitbucket.org');
  }

  async getMergeRequestInfo() {
    const prNumber = this.config.prNumber || process.env.BITBUCKET_PR_NUMBER;
    if (!prNumber) throw new Error('PR number not found. Set BITBUCKET_PR_NUMBER or pass config.prNumber.');

    const pr = await this._api('GET', `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${prNumber}`);

    return {
      number: pr.id,
      title: pr.title,
      sourceBranch: pr.source?.branch?.name || '',
      targetBranch: pr.destination?.branch?.name || '',
      headSha: pr.source?.commit?.hash || '',
      baseSha: pr.destination?.commit?.hash || '',
      isDraft: !!pr.draft,
      owner: this.workspace,
      repo: this.repoSlug,
    };
  }

  async getDiff(mrNumber, options = {}) {
    if (options.sinceSha) {
      // Bitbucket doesn't have a direct compare API for PRs like GitHub.
      // Use the changes endpoint with a diffstat to get changed files,
      // then fetch the full PR diff. For true incremental, we'd need to
      // compute the diff ourselves using the compare API.
      // Bitbucket Cloud does have a compare endpoint for branches:
      //   GET /2.0/repositories/{workspace}/{repo_slug}/diff/{spec}
      // But it requires branch names, not SHAs. So we fall back to full diff
      // and note it in the review comment.
      console.warn('Bitbucket: incremental review uses full PR diff (platform limitation).');
    }

    // Get PR diff — Bitbucket returns the diff as plain text
    const diff = await this._api('GET',
      `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/diff`,
      {}, 'text'
    );
    return typeof diff === 'string' ? diff : '';
  }

  async postOrUpdateSummaryComment(mrNumber, body, botMarker) {
    // List existing comments
    const comments = await this._api('GET',
      `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/comments`,
      { pagelen: '100', sort: '-created_on' }
    );

    const existingBotComment = (comments.values || []).find(
      c => c.content?.raw && c.content.raw.includes(botMarker)
    );

    if (existingBotComment) {
      await this._api('PUT',
        `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/comments/${existingBotComment.id}`,
        { content: { raw: body } }
      );
      return 'updated';
    }

    await this._api('POST',
      `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/comments`,
      { content: { raw: body } }
    );
    return 'created';
  }

  async postInlineComments(mrNumber, comments) {
    // Bitbucket inline comments use inline property
    for (const comment of comments) {
      try {
        await this._api('POST',
          `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/comments`,
          {
            content: { raw: comment.body },
            inline: {
              to: comment.line,
              path: comment.file,
            },
          }
        );
      } catch (e) {
        // Fallback to non-inline comment
        console.warn(`Inline comment failed on ${comment.file}:${comment.line}: ${e.message}`);
        try {
          await this._api('POST',
            `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/comments`,
            {
              content: { raw: `**${comment.file}:${comment.line}**\n\n${comment.body}` },
            }
          );
        } catch (e2) {
          console.warn(`Comment fallback also failed: ${e2.message}`);
        }
      }
    }
  }

  async approve(mrNumber, body) {
    try {
      await this._api('POST',
        `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/approve`
      );
    } catch (e) {
      console.warn(`Could not approve PR: ${e.message}`);
      // Post note instead
      await this._api('POST',
        `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/comments`,
        { content: { raw: body || '✅ AI Code Review passed. Auto-approved by AI Commit Review Bot.' } }
      );
    }
  }

  async addLabels(mrNumber, labels) {
    // Bitbucket Cloud supports labels on PRs
    for (const label of labels) {
      try {
        await this._api('POST',
          `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/labels`,
          { name: label }
        );
      } catch (e) {
        // Label might already exist or labels not supported on this version
        console.warn(`Could not add label ${label}: ${e.message}`);
      }
    }
  }

  async findLastReviewCommit(mrNumber, botMarker) {
    try {
      const comments = await this._api('GET',
        `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/comments`,
        { pagelen: '100', sort: '-created_on' }
      );

      const botComments = (comments.values || [])
        .filter(c => c.content?.raw && c.content.raw.includes(botMarker))
        .sort((a, b) => new Date(b.created_on) - new Date(a.created_on));

      if (botComments.length === 0) return null;

      const lastBotReviewTime = new Date(botComments[0].created_on);

      // Get commits
      const commits = await this._api('GET',
        `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/commits`,
        { pagelen: '100' }
      );

      let lastSha = null;
      for (const commit of (commits.values || [])) {
        const commitDate = new Date(commit.date);
        if (commitDate <= lastBotReviewTime) {
          lastSha = commit.hash;
          break; // commits are newest-first
        }
      }

      return lastSha;
    } catch (e) {
      console.warn(`Could not determine incremental base: ${e.message}`);
      return null;
    }
  }

  getMergeRequestUrl(mrNumber) {
    if (this._isCloud) {
      return `https://bitbucket.org/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}`;
    }
    // Bitbucket Server
    return `${this.baseUrl}/projects/${this.workspace}/repos/${this.repoSlug}/pull-requests/${mrNumber}`;
  }

  async getRecentComments(mrNumber, limit = 10) {
    try {
      const comments = await this._api('GET',
        `/repositories/${this.workspace}/${this.repoSlug}/pullrequests/${mrNumber}/comments`,
        { pagelen: String(limit), sort: '-created_on' }
      );
      return (comments.values || []).map(c => ({
        body: c.content?.raw || '',
        author: c.user?.display_name || '',
        createdAt: c.created_on,
        id: c.id,
      }));
    } catch (e) {
      return [];
    }
  }

  /**
   * Make a Bitbucket API request
   */
  async _api(method, path, params = {}, responseType = 'json') {
    const url = new URL(this._isCloud ? `/2.0${path}` : `/rest/api/1.0${path}`, this.baseUrl);

    if (method === 'GET') {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const body = method !== 'GET' && responseType === 'json' ? JSON.stringify(params) : null;

    // Auth: Cloud uses Basic (username:app_password), Server uses Bearer token
    let authHeader;
    if (this._isCloud && this.username) {
      authHeader = `Basic ${Buffer.from(`${this.username}:${this.token}`).toString('base64')}`;
    } else {
      authHeader = `Bearer ${this.token}`;
    }

    return new Promise((resolve, reject) => {
      const headers = {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
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
            else reject(new Error(`Bitbucket API ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }

          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              const errMsg = json.error?.message || json.detail || data.substring(0, 200);
              const err = new Error(`Bitbucket API ${res.statusCode}: ${errMsg}`);
              err.statusCode = res.statusCode;
              reject(err);
              return;
            }
            resolve(json);
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
            else reject(new Error(`Bitbucket API ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Bitbucket API timeout (30s)')); });
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = BitbucketAdapter;
