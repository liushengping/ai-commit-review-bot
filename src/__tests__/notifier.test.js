/**
 * Tests for notifier.js
 * Run: node --test src/__tests__/notifier.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildMessage } = require('../notifier');

describe('buildMessage', () => {
  it('should build a message with issues', () => {
    const review = {
      summary: 'Found 2 issues',
      risk_level: 'high',
      issues: [
        { category: 'security', severity: 'critical', description: 'SQL injection in auth.js', suggestion: 'Use parameterized queries' },
        { category: 'bug', severity: 'warning', description: 'Null pointer in utils.js', suggestion: '' },
      ],
    };

    const msg = buildMessage(review, 'https://github.com/test/repo/pull/1', 'Fix auth');
    assert.ok(msg.title.includes('🟠'));
    assert.ok(msg.title.includes('Fix auth'));
    assert.ok(msg.text.includes('SQL injection'));
    assert.ok(msg.text.includes('View PR'));
    assert.equal(msg.data.risk_level, 'high');
    assert.equal(msg.data.issue_count, 2);
  });

  it('should handle no issues', () => {
    const review = {
      summary: 'All clear',
      risk_level: 'low',
      issues: [],
    };

    const msg = buildMessage(review, 'https://github.com/test/repo/pull/2', 'Clean PR');
    assert.ok(msg.title.includes('🟢'));
    assert.ok(msg.text.includes('No issues'));
    assert.equal(msg.data.issue_count, 0);
  });
});
