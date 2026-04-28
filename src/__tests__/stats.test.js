/**
 * Tests for stats.js
 * Run: node --test src/__tests__/stats.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadStats, recordReview, formatStatsSummary } = require('../stats');

describe('loadStats', () => {
  it('should return default structure for non-existent file', () => {
    const stats = loadStats('/tmp/nonexistent-review-bot-test-' + Date.now());
    assert.equal(stats.version, 1);
    assert.equal(stats.totalReviews, 0);
    assert.equal(stats.totalIssues, 0);
    assert.ok(stats.reviews);
  });
});

describe('recordReview', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-bot-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should record a review and create stats file', () => {
    const review = {
      summary: 'Test review',
      risk_level: 'medium',
      issues: [
        { severity: 'warning', category: 'bug', description: 'test bug' },
        { severity: 'error', category: 'security', description: 'test security' },
      ],
      highlights: [],
    };

    const stats = recordReview(tmpDir, review, {
      prNumber: 42,
      prTitle: 'Test PR',
      filesReviewed: 5,
      filesSkipped: 2,
      model: 'test-model',
      duration: 10,
    });

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
    const loaded = loadStats(tmpDir);
    assert.equal(loaded.totalReviews, 1);
  });

  it('should accumulate stats across multiple reviews', () => {
    const review1 = {
      summary: 'First', risk_level: 'low',
      issues: [{ severity: 'info', category: 'quality', description: 'style' }],
      highlights: [],
    };
    const review2 = {
      summary: 'Second', risk_level: 'high',
      issues: [
        { severity: 'critical', category: 'security', description: 'vuln' },
        { severity: 'warning', category: 'performance', description: 'slow' },
      ],
      highlights: [],
    };

    recordReview(tmpDir, review1);
    const stats = recordReview(tmpDir, review2);

    assert.equal(stats.totalReviews, 2);
    assert.equal(stats.totalIssues, 3);
    assert.equal(stats.issuesBySeverity.info, 1);
    assert.equal(stats.issuesBySeverity.critical, 1);
    assert.equal(stats.issuesBySeverity.warning, 1);
  });
});

describe('formatStatsSummary', () => {
  it('should format stats as markdown', () => {
    const stats = {
      totalReviews: 10,
      totalIssues: 25,
      riskDistribution: { low: 5, medium: 3, high: 1, critical: 1 },
      issuesByCategory: { bug: 8, security: 5, performance: 4, quality: 5, missing: 3 },
      issuesBySeverity: { info: 5, warning: 10, error: 7, critical: 3 },
      reviews: [],
    };

    const summary = formatStatsSummary(stats);
    assert.ok(summary.includes('Total Reviews:** 10'));
    assert.ok(summary.includes('Total Issues Found:** 25'));
    assert.ok(summary.includes('2.5')); // avg issues/review
    assert.ok(summary.includes('🟢'));
    assert.ok(summary.includes('🔴'));
    assert.ok(summary.includes('🐛'));
    assert.ok(summary.includes('🔒'));
  });

  it('should handle zero reviews gracefully', () => {
    const stats = {
      totalReviews: 0,
      totalIssues: 0,
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      issuesByCategory: { bug: 0, security: 0, performance: 0, quality: 0, missing: 0 },
      issuesBySeverity: { info: 0, warning: 0, error: 0, critical: 0 },
      reviews: [],
    };

    const summary = formatStatsSummary(stats);
    assert.ok(summary.includes('Total Reviews:** 0'));
    assert.ok(summary.includes('Avg Issues/Review:** 0'));
  });
});
