/**
 * Platform Factory — auto-detects or creates the right adapter
 */
const GitHubAdapter = require('./github');
const GitLabAdapter = require('./gitlab');
const GiteaAdapter = require('./gitea');
const BitbucketAdapter = require('./bitbucket');

const PLATFORMS = {
  github: GitHubAdapter,
  gitlab: GitLabAdapter,
  gitea: GiteaAdapter,
  bitbucket: BitbucketAdapter,
};

/**
 * Detect the current platform from environment variables.
 * @returns {string} Platform name
 */
function detectPlatform() {
  if (process.env.GITHUB_ACTIONS) return 'github';
  if (process.env.GITLAB_CI || process.env.CI_SERVER_URL || process.env.GITLAB_TOKEN) return 'gitlab';
  if (process.env.BITBUCKET_BUILD_NUMBER || process.env.BITBUCKET_TOKEN) return 'bitbucket';
  if (process.env.GITEA_TOKEN || process.env.GITEA_URL) return 'gitea';

  // Check for generic CI env vars
  if (process.env.CI) {
    console.warn('CI detected but platform could not be determined. Defaulting to github.');
    return 'github';
  }

  return 'github'; // Default fallback
}

/**
 * Create a platform adapter instance.
 * @param {string} platformName - 'github', 'gitlab', 'gitea', 'bitbucket'
 * @param {object} config - Additional configuration
 * @returns {PlatformAdapter}
 */
function createAdapter(platformName, config = {}) {
  const name = platformName || detectPlatform();
  const AdapterClass = PLATFORMS[name.toLowerCase()];

  if (!AdapterClass) {
    const supported = Object.keys(PLATFORMS).join(', ');
    throw new Error(`Unknown platform: "${name}". Supported: ${supported}`);
  }

  return new AdapterClass(config);
}

/**
 * List all supported platform names
 */
function listPlatforms() {
  return Object.keys(PLATFORMS);
}

module.exports = { createAdapter, detectPlatform, listPlatforms, PLATFORMS };
