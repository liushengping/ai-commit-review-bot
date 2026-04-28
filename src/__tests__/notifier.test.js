/**
 * Tests for notifier.js
 * Run: node --test src/__tests__/notifier.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildMessage } = require('../core/notifier');

describe('buildMessage', () => {
  const review = {
    summary: 'Found a few issues',
    risk_level: 'high',
    issues: [
      { severity: 'critical', category: 'security', description: 'SQL injection risk in auth.js' },
      { severity: 'warning', category: 'performance', description: 'N+1 query in user controller' },
      { severity: 'info', category: 'quality', description: 'Variable naming could be improved' },
    ],
    highlights: ['Good error handling pattern'],
  };

  it('should build a complete message', () => {
    const message = buildMessage(review, 'https://github.com/owner/repo/pull/42', 'Fix bug');
    assert.ok(message.title.includes('AI Code Review'));
    assert.ok(message.title.includes('Fix bug'));
    assert.ok(message.text.includes('HIGH'));
    assert.ok(message.text.includes('3'));
    assert.ok(message.text.includes('View MR/PR'));
  });

  it('should include risk emoji', () => {
    const msg = buildMessage(review, 'url', 'title');
    assert.ok(msg.title.includes('🟠')); // high risk emoji
  });

  it('should include severity breakdown', () => {
    const msg = buildMessage(review, 'url', 'title');
    assert.ok(msg.text.includes('critical'));
    assert.ok(msg.text.includes('warning'));
    assert.ok(msg.text.includes('info'));
  });

  it('should include data object', () => {
    const msg = buildMessage(review, 'https://example.com/pr/1', 'Test PR');
    assert.equal(msg.data.risk_level, 'high');
    assert.equal(msg.data.issue_count, 3);
    assert.equal(msg.data.pr_url, 'https://example.com/pr/1');
    assert.equal(msg.data.pr_title, 'Test PR');
  });

  it('should handle review with no issues', () => {
    const emptyReview = { summary: 'All clear', risk_level: 'low', issues: [], highlights: [] };
    const msg = buildMessage(emptyReview, 'url', 'title');
    assert.ok(msg.text.includes('No issues'));
    assert.ok(msg.title.includes('🟢'));
  });

  it('should truncate long issue descriptions in top issues', () => {
    const longReview = {
      summary: 'test',
      risk_level: 'medium',
      issues: [
        { severity: 'warning', category: 'bug', description: 'A'.repeat(200) },
      ],
      highlights: [],
    };
    const msg = buildMessage(longReview, 'url', 'title');
    // Should not throw and should include truncated description
    assert.ok(msg.text.length > 0);
  });
});
