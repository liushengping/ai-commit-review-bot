/**
 * Review statistics tracker.
 * Stores review history as JSON for trending and reporting.
 */

const fs = require('fs');
const path = require('path');

const STATS_FILE = 'review-stats.json';

/**
 * Load existing stats or create empty structure
 */
function loadStats(repoRoot) {
  const statsPath = path.join(repoRoot, STATS_FILE);
  try {
    if (fs.existsSync(statsPath)) {
      return JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    }
  } catch (e) {
    // Corrupted stats, start fresh
  }
  return {
    version: 1,
    totalReviews: 0,
    totalIssues: 0,
    issuesBySeverity: { info: 0, warning: 0, error: 0, critical: 0 },
    issuesByCategory: { bug: 0, security: 0, performance: 0, quality: 0, missing: 0 },
    riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
    reviews: [], // recent reviews (keep last 100)
  };
}

/**
 * Record a review result into stats
 */
function recordReview(repoRoot, review, meta = {}) {
  const stats = loadStats(repoRoot);

  stats.totalReviews++;
  stats.totalIssues += review.issues.length;

  // Aggregate severity
  for (const issue of review.issues) {
    if (issue.severity in stats.issuesBySeverity) {
      stats.issuesBySeverity[issue.severity]++;
    }
    if (issue.category in stats.issuesByCategory) {
      stats.issuesByCategory[issue.category]++;
    }
  }

  // Risk distribution
  if (review.risk_level in stats.riskDistribution) {
    stats.riskDistribution[review.risk_level]++;
  }

  // Store individual review (keep last 100)
  stats.reviews.push({
    timestamp: new Date().toISOString(),
    pr: meta.prNumber || null,
    pr_title: meta.prTitle || null,
    risk_level: review.risk_level,
    issue_count: review.issues.length,
    summary: review.summary,
    files_reviewed: meta.filesReviewed || 0,
    files_skipped: meta.filesSkipped || 0,
    model: meta.model || null,
    duration_seconds: meta.duration || null,
  });

  // Keep only last 100 reviews
  if (stats.reviews.length > 100) {
    stats.reviews = stats.reviews.slice(-100);
  }

  // Write stats
  const statsPath = path.join(repoRoot, STATS_FILE);
  try {
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {
    // Non-fatal: stats are best-effort
    console.warn(`Could not write stats file: ${e.message}`);
  }

  return stats;
}

/**
 * Format stats as a markdown summary for GitHub Actions Job Summary
 */
function formatStatsSummary(stats) {
  const parts = [];
  parts.push('## 📊 AI Code Review Statistics');
  parts.push('');
  parts.push(`- **Total Reviews:** ${stats.totalReviews}`);
  parts.push(`- **Total Issues Found:** ${stats.totalIssues}`);
  parts.push(`- **Avg Issues/Review:** ${stats.totalReviews > 0 ? (stats.totalIssues / stats.totalReviews).toFixed(1) : 0}`);
  parts.push('');

  parts.push('### Risk Distribution');
  parts.push('');
  parts.push(`| Risk Level | Count |`);
  parts.push(`|---|---|`);
  for (const [level, count] of Object.entries(stats.riskDistribution)) {
    const emoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }[level] || '⚪';
    parts.push(`| ${emoji} ${level} | ${count} |`);
  }
  parts.push('');

  parts.push('### Issues by Category');
  parts.push('');
  const catEmoji = { bug: '🐛', security: '🔒', performance: '⚡', quality: '📝', missing: '📋' };
  for (const [cat, count] of Object.entries(stats.issuesByCategory)) {
    if (count > 0) parts.push(`- ${catEmoji[cat] || '•'} **${cat}:** ${count}`);
  }
  parts.push('');

  parts.push('### Issues by Severity');
  parts.push('');
  const sevEmoji = { info: 'ℹ️', warning: '⚠️', error: '❌', critical: '🚨' };
  for (const [sev, count] of Object.entries(stats.issuesBySeverity)) {
    if (count > 0) parts.push(`- ${sevEmoji[sev] || '•'} **${sev}:** ${count}`);
  }

  return parts.join('\n');
}

module.exports = { loadStats, recordReview, formatStatsSummary };
