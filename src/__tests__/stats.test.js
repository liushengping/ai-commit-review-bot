/**
 * Tests for stats.js
 * Run: node --test src/__tests__/stats.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadStats, recordReview, formatStatsSummary } = require('../core/stats');

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-test-'));
  return dir;
}

describe('loadStats', () => {
  it('should return default stats when no file exists', () => {
    const dir = makeTmpDir();
    const stats = loadStats(dir);
    assert.equal(stats.totalReviews, 0);
    assert.equal(stats.totalIssues, 0);
    assert.deepStrictEqual(stats.reviews, []);
    fs.rmSync(dir, { recursive: true });
  });

  it('should load existing stats file', () => {
    const dir = makeTmpDir();
    const existing = { version: 1, totalReviews: 5, totalIssues: 10, reviews: [] };
    fs.writeFileSync(path.join(dir, 'review-stats.json'), JSON.stringify(existing));
    const stats = loadStats(dir);
    assert.equal(stats.totalReviews, 5);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('recordReview', () => {
  it('should record a review and update counters', () => {
    const dir = makeTmpDir();
    const review = {
      summary: 'Found issues',
      risk_level: 'medium',
      issues: [
        { severity: 'warning', category: 'bug', description: 'test' },
        { severity: 'error', category: 'security', description: 'test2' },
      ],
      highlights: [],
    };

    const stats = recordReview(dir, review, { prNumber: 42, model: 'test-model' });
    assert.equal(stats.totalReviews, 1);
    assert.equal(stats.totalIssues, 2);
    assert.equal(stats.issuesBySeverity.warning, 1);
    assert.equal(stats.issuesBySeverity.error, 1);
    assert.equal(stats.issuesByCategory.bug, 1);
    assert.equal(stats.issuesByCategory.security, 1);
    assert.equal(stats.riskDistribution.medium, 1);
    assert.equal(stats.reviews.length, 1);
    assert.equal(stats.reviews[0].pr, 42);

    // Verify file was written
    const loaded = loadStats(dir);
    assert.equal(loaded.totalReviews, 1);
    fs.rmSync(dir, { recursive: true });
  });

  it('should accumulate across multiple reviews', () => {
    const dir = makeTmpDir();
    const review1 = { summary: 'ok', risk_level: 'low', issues: [], highlights: [] };
    const review2 = {
      summary: 'issues',
      risk_level: 'high',
      issues: [{ severity: 'critical', category: 'security', description: 'xss' }],
      highlights: [],
    };

    recordReview(dir, review1);
    const stats = recordReview(dir, review2);
    assert.equal(stats.totalReviews, 2);
    assert.equal(stats.totalIssues, 1);
    assert.equal(stats.riskDistribution.low, 1);
    assert.equal(stats.riskDistribution.high, 1);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('formatStatsSummary', () => {
  it('should format stats as markdown', () => {
    const stats = {
      totalReviews: 10,
      totalIssues: 25,
      issuesBySeverity: { info: 5, warning: 10, error: 7, critical: 3 },
      issuesByCategory: { bug: 8, security: 5, performance: 4, quality: 6, missing: 2 },
      riskDistribution: { low: 3, medium: 4, high: 2, critical: 1 },
      reviews: [],
    };

    const md = formatStatsSummary(stats);
    assert.ok(md.includes('Total Reviews:** 10'));
    assert.ok(md.includes('Total Issues Found:** 25'));
    assert.ok(md.includes('2.5')); // avg issues/review
    assert.ok(md.includes('low'));
    assert.ok(md.includes('🐛'));
    assert.ok(md.includes('🔒'));
  });
});
