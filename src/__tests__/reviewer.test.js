/**
 * Tests for reviewer.js
 * Run: node --test src/__tests__/reviewer.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseReviewResponse, formatReviewComment, meetsSeverityThreshold, SEVERITY_LEVELS } = require('../core/reviewer');

describe('parseReviewResponse', () => {
  it('should parse valid JSON response', () => {
    const response = JSON.stringify({
      summary: 'Code looks good',
      risk_level: 'low',
      issues: [],
      highlights: ['Nice function structure'],
    });

    const result = parseReviewResponse(response);
    assert.equal(result.summary, 'Code looks good');
    assert.equal(result.risk_level, 'low');
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.highlights, ['Nice function structure']);
  });

  it('should handle JSON wrapped in markdown code block', () => {
    const response = '```json\n' + JSON.stringify({
      summary: 'Found issues',
      risk_level: 'high',
      issues: [{
        file: 'test.js',
        line: '10',
        severity: 'error',
        category: 'bug',
        description: 'Null pointer',
        suggestion: 'Add null check',
      }],
      highlights: [],
    }) + '\n```';

    const result = parseReviewResponse(response);
    assert.equal(result.risk_level, 'high');
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].file, 'test.js');
    assert.equal(result.issues[0].line, 10);
  });

  it('should handle invalid JSON gracefully', () => {
    const result = parseReviewResponse('not json at all');
    assert.equal(result.risk_level, 'medium');
    assert.equal(result.issues.length, 0);
    assert.ok(result.summary.includes('non-standard'));
  });

  it('should default invalid risk_level to medium', () => {
    const response = JSON.stringify({
      summary: 'test',
      risk_level: 'invalid',
      issues: [],
      highlights: [],
    });

    const result = parseReviewResponse(response);
    assert.equal(result.risk_level, 'medium');
  });

  it('should default invalid severity to warning', () => {
    const response = JSON.stringify({
      summary: 'test',
      risk_level: 'low',
      issues: [{
        file: 'test.js',
        line: '5',
        severity: 'invalid',
        category: 'bug',
        description: 'test',
        suggestion: '',
      }],
      highlights: [],
    });

    const result = parseReviewResponse(response);
    assert.equal(result.issues[0].severity, 'warning');
  });
});

describe('formatReviewComment', () => {
  it('should format a review with no issues', () => {
    const review = {
      summary: 'All clear',
      risk_level: 'low',
      issues: [],
      highlights: ['Good code style'],
    };

    const comment = formatReviewComment(review, 'zh');
    assert.ok(comment.includes('🟢'));
    assert.ok(comment.includes('No Issues Found'));
    assert.ok(comment.includes('Good code style'));
    assert.ok(comment.includes('AI Commit Review Bot'));
  });

  it('should format a review with issues', () => {
    const review = {
      summary: 'Found bugs',
      risk_level: 'high',
      issues: [
        {
          file: 'auth.js',
          line: 42,
          severity: 'critical',
          category: 'security',
          description: 'SQL injection risk',
          suggestion: 'Use parameterized queries',
        },
      ],
      highlights: [],
    };

    const comment = formatReviewComment(review, 'en');
    assert.ok(comment.includes('🟠'));
    assert.ok(comment.includes('🚨'));
    assert.ok(comment.includes('SQL injection'));
    assert.ok(comment.includes('parameterized queries'));
    assert.ok(comment.includes('auth.js:42'));
  });

  it('should include incremental badge when meta.incremental is true', () => {
    const review = { summary: 'test', risk_level: 'low', issues: [], highlights: [] };
    const comment = formatReviewComment(review, 'en', { incremental: true });
    assert.ok(comment.includes('Incremental review'));
  });

  it('should include token usage when provided', () => {
    const review = { summary: 'test', risk_level: 'low', issues: [], highlights: [] };
    const comment = formatReviewComment(review, 'en', { totalTokens: 50000, truncated: true });
    assert.ok(comment.includes('50,000'));
    assert.ok(comment.includes('truncated'));
  });

  it('should include stats when provided', () => {
    const review = { summary: 'test', risk_level: 'low', issues: [], highlights: [] };
    const comment = formatReviewComment(review, 'en', {
      stats: { filesReviewed: 5, filesSkipped: 2, additions: 100, deletions: 30, duration: 15 },
    });
    assert.ok(comment.includes('Files reviewed: 5'));
    assert.ok(comment.includes('15s'));
  });
});

describe('meetsSeverityThreshold', () => {
  it('should correctly compare severity levels', () => {
    assert.ok(meetsSeverityThreshold('critical', 'warning'));
    assert.ok(meetsSeverityThreshold('error', 'warning'));
    assert.ok(meetsSeverityThreshold('warning', 'warning'));
    assert.ok(!meetsSeverityThreshold('info', 'warning'));
    assert.ok(!meetsSeverityThreshold('info', 'error'));
  });

  it('should handle edge cases', () => {
    assert.ok(meetsSeverityThreshold('critical', 'critical'));
    assert.ok(meetsSeverityThreshold('info', 'info'));
    assert.ok(!meetsSeverityThreshold('warning', 'critical'));
  });
});
