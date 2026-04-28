/**
 * Review Cache — dedup repeated issues across pushes
 *
 * Strategy: fingerprint each issue by (file, code_context, category).
 * If the same fingerprint was reported in a previous review and the code
 * hasn't changed, skip it to reduce noise.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILE = '.review-cache.json';

/**
 * Generate a fingerprint for an issue.
 * Uses file + surrounding code context + category to identify "same issue".
 */
function fingerprint(issue, filePatch) {
  // Extract code context around the issue line
  const lines = (filePatch || '').split('\n');
  const lineIdx = Math.max(0, (issue.line || 1) - 1);
  const contextStart = Math.max(0, lineIdx - 2);
  const contextEnd = Math.min(lines.length, lineIdx + 3);
  const contextLines = lines.slice(contextStart, contextEnd)
    .map(l => l.replace(/^\s*[+-]?\s*/, '').trim())
    .filter(Boolean)
    .join('|');

  const raw = `${issue.file}::${issue.category}::${contextLines}`;
  return crypto.createHash('md5').update(raw).digest('hex').substring(0, 12);
}

/**
 * Load the review cache from disk.
 */
function loadCache(repoRoot) {
  const cachePath = path.join(repoRoot, CACHE_FILE);
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch (e) {}
  return { version: 1, entries: {} };
}

/**
 * Save the review cache to disk.
 */
function saveCache(repoRoot, cache) {
  const cachePath = path.join(repoRoot, CACHE_FILE);
  try {
    // Prune entries older than 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [fp, entry] of Object.entries(cache.entries)) {
      if (entry.lastSeen < cutoff) delete cache.entries[fp];
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {}
}

/**
 * Filter issues, removing those that were already reported and haven't changed.
 *
 * @param {Array} issues - New issues from review
 * @param {Map<string, string>} filePatches - Map of filename → patch text
 * @param {string} repoRoot - Repo root for cache file
 * @returns {{ newIssues: Array, cachedCount: number }}
 */
function filterCachedIssues(issues, filePatches, repoRoot) {
  const cache = loadCache(repoRoot);
  const newIssues = [];
  let cachedCount = 0;

  for (const issue of issues) {
    const patch = filePatches.get(issue.file) || '';
    const fp = fingerprint(issue, patch);

    const cached = cache.entries[fp];
    if (cached && cached.severity === issue.severity && cached.description === issue.description) {
      // Same issue, same severity, same description → skip
      cachedCount++;
      continue;
    }

    newIssues.push(issue);

    // Update cache
    cache.entries[fp] = {
      severity: issue.severity,
      category: issue.category,
      description: issue.description,
      file: issue.file,
      lastSeen: Date.now(),
    };
  }

  saveCache(repoRoot, cache);
  return { newIssues, cachedCount };
}

/**
 * Clear the cache (e.g., when user requests /re-review).
 */
function clearCache(repoRoot) {
  const cachePath = path.join(repoRoot, CACHE_FILE);
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch (e) {}
}

module.exports = { fingerprint, loadCache, saveCache, filterCachedIssues, clearCache, CACHE_FILE };
