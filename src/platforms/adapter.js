/**
 * Platform Adapter — abstract interface for SCM platforms.
 *
 * All platform-specific implementations must extend this class
 * and implement every method. The core review engine calls these
 * methods through the adapter, keeping itself platform-agnostic.
 */
class PlatformAdapter {
  constructor(config = {}) {
    this.config = config;
    this._mrInfo = null;
  }

  /**
   * Human-readable platform name (e.g. 'github', 'gitlab')
   * @returns {string}
   */
  get platformName() {
    throw new Error('platformName must be implemented by subclass');
  }

  /**
   * Authenticate with the platform.
   * Called once before any other method.
   * @param {object} credentials - Platform-specific credentials
   */
  async authenticate(credentials) {
    throw new Error('authenticate() must be implemented by subclass');
  }

  /**
   * Get the current Merge Request / Pull Request context.
   * @returns {{ number, title, sourceBranch, targetBranch, headSha, baseSha, isDraft, owner, repo }}
   */
  async getMergeRequestInfo() {
    throw new Error('getMergeRequestInfo() must be implemented by subclass');
  }

  /**
   * Fetch the unified diff for the MR/PR.
   * @param {number} mrNumber - MR/PR number
   * @param {object} options - { sinceSha } for incremental diff
   * @returns {string} Raw unified diff
   */
  async getDiff(mrNumber, options = {}) {
    throw new Error('getDiff() must be implemented by subclass');
  }

  /**
   * Post a summary comment on the MR/PR.
   * If a bot comment already exists (identified by botMarker), update it.
   * @param {number} mrNumber
   * @param {string} body - Markdown comment body
   * @param {string} botMarker - Unique marker to identify bot comments
   */
  async postOrUpdateSummaryComment(mrNumber, body, botMarker) {
    throw new Error('postOrUpdateSummaryComment() must be implemented by subclass');
  }

  /**
   * Post inline comments on specific code lines.
   * @param {number} mrNumber
   * @param {Array<{file, line, body}>} comments
   */
  async postInlineComments(mrNumber, comments) {
    throw new Error('postInlineComments() must be implemented by subclass');
  }

  /**
   * Approve the MR/PR.
   * @param {number} mrNumber
   * @param {string} body - Approval message
   */
  async approve(mrNumber, body) {
    throw new Error('approve() must be implemented by subclass');
  }

  /**
   * Add labels to the MR/PR.
   * @param {number} mrNumber
   * @param {string[]} labels
   */
  async addLabels(mrNumber, labels) {
    throw new Error('addLabels() must be implemented by subclass');
  }

  /**
   * Find the SHA of the last commit that was reviewed by the bot.
   * Used for incremental review.
   * @param {number} mrNumber
   * @param {string} botMarker
   * @returns {string|null} SHA or null if no previous review
   */
  async findLastReviewCommit(mrNumber, botMarker) {
    throw new Error('findLastReviewCommit() must be implemented by subclass');
  }

  /**
   * Get the MR/PR web URL for notifications.
   * @param {number} mrNumber
   * @returns {string}
   */
  getMergeRequestUrl(mrNumber) {
    throw new Error('getMergeRequestUrl() must be implemented by subclass');
  }

  /**
   * Get recent comments on the MR/PR.
   * Used for command parsing (e.g., /re-review, /skip).
   * @param {number} mrNumber
   * @param {number} limit - Max comments to return
   * @returns {Array<{body: string, author: string, createdAt: string}>}
   */
  async getRecentComments(mrNumber, limit = 10) {
    // Default implementation — subclasses can override
    return [];
  }
}

module.exports = PlatformAdapter;
