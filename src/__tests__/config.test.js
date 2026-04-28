/**
 * Tests for config.js
 * Run: node --test src/__tests__/config.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig, DEFAULT_CONFIG } = require('../core/config');

describe('loadConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return defaults when no .review.yml exists', () => {
    const config = loadConfig(tmpDir);
    assert.equal(config.review.language, 'zh');
    assert.equal(config.review.auto_approve, false);
    assert.equal(config.severity.block_threshold, 'critical');
    assert.equal(config.severity.inline_threshold, 'warning');
    assert.ok(Array.isArray(config.webhooks));
    assert.ok(Array.isArray(config.language_rules));
  });

  it('should merge user config with defaults', () => {
    const yml = `
review:
  language: en
  auto_approve: true
severity:
  block_threshold: error
custom_prompt: "Focus on security"
`;
    fs.writeFileSync(path.join(tmpDir, '.review.yml'), yml, 'utf8');

    const config = loadConfig(tmpDir);
    assert.equal(config.review.language, 'en');
    assert.equal(config.review.auto_approve, true);
    assert.equal(config.severity.block_threshold, 'error');
    assert.equal(config.custom_prompt, 'Focus on security');
    // Defaults should still be present
    assert.equal(config.review.max_diff_lines, 500);
  });

  it('should handle empty .review.yml', () => {
    fs.writeFileSync(path.join(tmpDir, '.review.yml'), '', 'utf8');
    const config = loadConfig(tmpDir);
    assert.equal(config.review.language, 'zh'); // default
  });
});
