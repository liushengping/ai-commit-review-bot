/**
 * Tests for parallel-review.js
 * Run: node --test src/__tests__/parallel-review.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { splitIntoBatches, mergeReviews } = require('../core/parallel-review');

describe('splitIntoBatches', () => {
  it('should put small files in one batch', () => {
    const files = [
      { filename: 'a.js', patch: 'small', additions: 1, deletions: 0 },
      { filename: 'b.js', patch: 'small', additions: 1, deletions: 0 },
    ];
    const batches = splitIntoBatches(files, 100000);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 2);
  });

  it('should split large files into separate batches', () => {
    const bigPatch = 'x'.repeat(400000); // ~100k tokens
    const files = [
      { filename: 'big1.js', patch: bigPatch, additions: 100, deletions: 0 },
      { filename: 'big2.js', patch: bigPatch, additions: 100, deletions: 0 },
    ];
    const batches = splitIntoBatches(files, 80000);
    assert.ok(batches.length >= 2);
  });

  it('should handle empty files array', () => {
    const batches = splitIntoBatches([], 80000);
    assert.equal(batches.length, 0);
  });
});

describe('mergeReviews', () => {
  it('should merge issues from multiple batches', () => {
    const results = [
      { batchIdx: 0, review: { summary: 'ok', risk_level: 'medium', issues: [{ file: 'a.js', severity: 'warning' }], highlights: [] } },
      { batchIdx: 1, review: { summary: 'ok', risk_level: 'high', issues: [{ file: 'b.js', severity: 'critical' }], highlights: ['nice'] } },
    ];
    const { review } = mergeReviews(results, 2);
    assert.equal(review.issues.length, 2);
    assert.equal(review.risk_level, 'high'); // takes highest
    assert.ok(review.summary.includes('2'));
  });

  it('should handle batch errors', () => {
    const results = [
      { batchIdx: 0, review: { summary: 'ok', risk_level: 'low', issues: [], highlights: [] } },
      { batchIdx: 1, review: null, error: 'API timeout' },
    ];
    const { review } = mergeReviews(results, 2);
    assert.ok(review.summary.includes('error'));
    assert.ok(review.highlights.some(h => h.includes('API timeout')));
  });

  it('should take highest risk level', () => {
    const results = [
      { batchIdx: 0, review: { summary: '', risk_level: 'low', issues: [], highlights: [] } },
      { batchIdx: 1, review: { summary: '', risk_level: 'critical', issues: [], highlights: [] } },
    ];
    const { review } = mergeReviews(results, 2);
    assert.equal(review.risk_level, 'critical');
  });
});
