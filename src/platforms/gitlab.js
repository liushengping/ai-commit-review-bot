/**
 * GitLab Platform Adapter
 *
 * Supports GitLab.com and self-hosted GitLab instances.
 * Uses GitLab REST API v4.
 *
 * Required environment variables (or config):
 *   GITLAB_TOKEN        - Personal access token or project access token
 *   GITLAB_URL          - GitLab instance URL (default: https://gitlab.com)
 *   CI_MERGE_REQUEST_IID - MR IID (auto-set in GitLab CI)
 *   CI_PROJECT_ID        - Project ID (auto-set in GitLab CI)
 *   CI_MERGE_REQUEST_DIFF_BASE_SHA - Base SHA for incremental (auto-set)
 */
const https = require('https');
const http = require('http');
const PlatformAdapter = require('./adapter');

class GitLabAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super(config);
    this.token = null;
    this.baseUrl = null;
    this.projectId = null;
    this.mrIid = null;
  }

  get platformName() { return 'gitlab'; }

  async authenticate(credentials) {
    this.token = credentials.token || process.env.GITLAB_TOKEN;
    if (!this.token) throw new Error('GitLab token required. Set GITLAB_TOKEN or pass credentials.token.');

    this.baseUrl = (credentials.url || process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/+$/, '');
    this.projectId = credentials.projectId || process.env.CI_PROJECT_ID;
    this.mrIid = credentials.mrIid || process.env.CI_MERGE_REQUEST_IID;

    if (!this.projectId) {
      // Try to derive from CI_PROJECT_PATH
      const projectPath = process.env.CI_PROJECT_PATH;
      if (projectPath) {
        this.projectId = encodeURIComponent(projectPath);
      }
    }
  }

  async getMergeRequestInfo() {
    if (!this.mrIid) throw new Error('MR IID not found. Set CI_MERGE_REQUEST_IID or pass credentials.mrIid.');
    if (!this.projectId) throw new Error('Project ID not found. Set CI_PROJECT_ID or pass credentials.projectId.');

    const mr = await this._api('GET', `/projects/${this.projectId}/merge_requests/${this.mrIid}`);

    return {
      number: mr.iid,
      title: mr.title,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      headSha: mr.sha,
      baseSha: mr.diff_refs?.base_sha || null,
      isDraft: !!mr.work_in_progress,
      owner: mr.author?.username || '',
      repo: mr.references?.full || '',
    };
  }

  async getDiff(mrNumber, options = {}) {
    if (options.sinceSha) {
      // GitLab doesn't have a direct compare API for MRs like GitHub.
      // We get the MR changes and rely on the MR's own diff.
      // For true incremental, we'd need to use the compare API.
      const compare = await this._api('GET',
        `/projects/${this.projectId}/repository/compare`,
        { from: options.sinceSha, to: options.headSha }
      );
      return this._convertDiffsToUnified(compare.diffs || []);
    }

    // Get MR changes
    const changes = await this._api('GET',
      `/projects/${this.projectId}/merge_requests/${mrNumber}/changes`
    );
    return this._convertDiffsToUnified(changes.changes || []);
  }

  /**
   * Convert GitLab diff format to unified diff format
   * GitLab returns { old_path, new_path, diff, new_file, renamed_file, deleted_file }
   */
  _convertDiffsToUnified(changes) {
    return changes.map(change => {
      const oldPath = change.old_path;
      const newPath = change.new_path;
      let header = `diff --git a/${oldPath} b/${newPath}\n`;

      if (change.new_file) header += 'new file mode 100644\n';
      else if (change.deleted_file) header += 'deleted file mode 100644\n';
      else if (change.renamed_file) header += `rename from ${oldPath}\nrename to ${newPath}\n`;

      header += `--- ${change.new_file ? '/dev/null' : 'a/' + oldPath}\n`;
      header += `+++ ${change.deleted_file ? '/dev/null' : 'b/' + newPath}\n`;

      // GitLab's diff field is already in unified diff format (hunks)
      return header + (change.diff || '');
    }).join('\n');
  }

  async postOrUpdateSummaryComment(mrNumber, body, botMarker) {
    // Search for existing bot comment
    const notes = await this._api('GET',
      `/projects/${this.projectId}/merge_requests/${mrNumber}/notes`,
      { sort: 'desc', per_page: '100' }
    );

    const existingNote = notes.find(n => n.body && n.body.includes(botMarker));

    if (existingNote) {
      await this._api('PUT',
        `/projects/${this.projectId}/merge_requests/${mrNumber}/notes/${existingNote.id}`,
        { body }
      );
      return 'updated';
    }

    await this._api('POST',
      `/projects/${this.projectId}/merge_requests/${mrNumber}/notes`,
      { body }
    );
    return 'created';
  }

  async postInlineComments(mrNumber, comments) {
    // GitLab MR Notes with position for inline comments
    const mr = await this._api('GET', `/projects/${this.projectId}/merge_requests/${mrNumber}`);

    for (const comment of comments) {
      try {
        await this._api('POST',
          `/projects/${this.projectId}/merge_requests/${mrNumber}/notes`,
          {
            body: comment.body,
            position: JSON.stringify({
              position_type: 'text',
              base_sha: mr.diff_refs?.base_sha,
              start_sha: mr.diff_refs?.start_sha,
              head_sha: mr.diff_refs?.head_sha,
              new_path: comment.file,
              old_path: comment.file,
              new_line: comment.line,
            }),
          }
        );
      } catch (e) {
        // Fallback: post as regular note if inline fails
        console.warn(`Inline comment failed on ${comment.file}:${comment.line}: ${e.message}. Posting as note.`);
        try {
          await this._api('POST',
            `/projects/${this.projectId}/merge_requests/${mrNumber}/notes`,
            { body: `**${comment.file}:${comment.line}**\n\n${comment.body}` }
          );
        } catch (e2) {
          console.warn(`Note fallback also failed: ${e2.message}`);
        }
      }
    }
  }

  async approve(mrNumber, body) {
    try {
      await this._api('POST',
        `/projects/${this.projectId}/merge_requests/${mrNumber}/approve`
      );
    } catch (e) {
      // Approval might require premium, or the user already approved
      console.warn(`Could not approve MR: ${e.message}`);
      // Post approval note instead
      await this._api('POST',
        `/projects/${this.projectId}/merge_requests/${mrNumber}/notes`,
        { body: body || '✅ AI Code Review passed. Auto-approved by AI Commit Review Bot.' }
      );
    }
  }

  async addLabels(mrNumber, labels) {
    // GitLab MR labels are set via update
    const mr = await this._api('GET', `/projects/${this.projectId}/merge_requests/${mrNumber}`);
    const existingLabels = mr.labels || [];
    const newLabels = [...new Set([...existingLabels, ...labels])];

    await this._api('PUT', `/projects/${this.projectId}/merge_requests/${mrNumber}`, {
      labels: newLabels.join(','),
    });
  }

  async findLastReviewCommit(mrNumber, botMarker) {
    try {
      const notes = await this._api('GET',
        `/projects/${this.projectId}/merge_requests/${mrNumber}/notes`,
        { sort: 'desc', per_page: '100' }
      );

      const botNotes = notes
        .filter(n => n.body && n.body.includes(botMarker) && n.system === false)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (botNotes.length === 0) return null;

      const lastBotReviewTime = new Date(botNotes[0].created_at);

      // Get commits
      const commits = await this._api('GET',
        `/projects/${this.projectId}/merge_requests/${mrNumber}/commits`,
        { per_page: '100' }
      );

      let lastSha = null;
      for (const commit of commits) {
        const commitDate = new Date(commit.committed_date || commit.created_at);
        if (commitDate <= lastBotReviewTime) {
          lastSha = commit.id;
          break; // commits are sorted newest-first, so first match is the latest
        }
      }

      return lastSha;
    } catch (e) {
      console.warn(`Could not determine incremental base: ${e.message}`);
      return null;
    }
  }

  getMergeRequestUrl(mrNumber) {
    return `${this.baseUrl}/${this.projectId}/-/merge_requests/${mrNumber}`;
  }

  /**
   * Make a GitLab API request
   */
  async _api(method, path, params = {}) {
    const url = new URL(`/api/v4${path}`, this.baseUrl);

    if (method === 'GET') {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const body = method !== 'GET' ? JSON.stringify(params) : null;

    return new Promise((resolve, reject) => {
      const headers = {
        'PRIVATE-TOKEN': this.token,
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
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              const err = new Error(`GitLab API ${res.statusCode}: ${json.message || data.substring(0, 200)}`);
              err.statusCode = res.statusCode;
              reject(err);
              return;
            }
            resolve(json);
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
            else reject(new Error(`GitLab API ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('GitLab API timeout (30s)')); });
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = GitLabAdapter;
