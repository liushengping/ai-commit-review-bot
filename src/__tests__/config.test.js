/**
 * Tests for config.js
 * Run: node --test src/__tests__/config.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig, parseSimpleYamlFallback, deepMerge, DEFAULT_CONFIG } = require('../core/config');

describe('parseSimpleYamlFallback', () => {
  it('should parse simple key-value pairs', () => {
    const result = parseSimpleYamlFallback('language: zh\nauto_approve: true\n');
    assert.equal(result.language, 'zh');
    assert.equal(result.auto_approve, true);
  });

  it('should parse nested objects', () => {
    const result = parseSimpleYamlFallback('review:\n  language: en\n  max_diff_lines: 300\n');
    assert.equal(result.review.language, 'en');
    assert.equal(result.review.max_diff_lines, 300);
  });

  it('should parse arrays', () => {
    const result = parseSimpleYamlFallback('ignore:\n  - docs/\n  - "*.md"\n');
    assert.ok(Array.isArray(result.ignore));
    assert.equal(result.ignore.length, 2);
  });

  it('should handle comments and blank lines', () => {
    const result = parseSimpleYamlFallback('# comment\nlanguage: zh\n\n# another comment\nauto_approve: false\n');
    assert.equal(result.language, 'zh');
    assert.equal(result.auto_approve, false);
  });

  it('should parse boolean values', () => {
    const result = parseSimpleYamlFallback('a: true\nb: false\nc: null\n');
    assert.equal(result.a, true);
    assert.equal(result.b, false);
    assert.equal(result.c, null);
  });

  it('should parse numeric values', () => {
    const result = parseSimpleYamlFallback('count: 42\nratio: 3.14\n');
    assert.equal(result.count, 42);
    assert.equal(result.ratio, 3.14);
  });

  it('should handle multi-line strings with |', () => {
    const result = parseSimpleYamlFallback('custom_prompt: |\n  line one\n  line two\n');
    assert.ok(result.custom_prompt.includes('line one'));
    assert.ok(result.custom_prompt.includes('line two'));
  });
});

describe('deepMerge', () => {
  it('should merge flat objects', () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
    assert.equal(result.a, 1);
    assert.equal(result.b, 3);
    assert.equal(result.c, 4);
  });

  it('should merge nested objects', () => {
    const result = deepMerge(
      { review: { language: 'zh', auto_approve: false } },
      { review: { language: 'en' } }
    );
    assert.equal(result.review.language, 'en');
    assert.equal(result.review.auto_approve, false);
  });

  it('should replace arrays (not merge)', () => {
    const result = deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] });
    assert.deepStrictEqual(result.tags, ['c']);
  });
});

describe('loadConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return defaults when no config file exists', () => {
    const config = loadConfig(tmpDir);
    assert.equal(config.review.language, 'zh');
    assert.equal(config.review.auto_approve, false);
    assert.equal(config.severity.block_threshold, 'critical');
  });

  it('should merge user config with defaults', () => {
    fs.writeFileSync(path.join(tmpDir, '.review.yml'), 'review:\n  language: en\n  auto_approve: true\n');
    const config = loadConfig(tmpDir);
    assert.equal(config.review.language, 'en');
    assert.equal(config.review.auto_approve, true);
    // Defaults preserved
    assert.equal(config.review.incremental, true);
    assert.equal(config.severity.block_threshold, 'critical');
  });

  it('should handle invalid YAML gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, '.review.yml'), '{{invalid yaml}}');
    const config = loadConfig(tmpDir);
    // Should still return defaults
    assert.equal(config.review.language, 'zh');
  });

  it('should load ignore patterns', () => {
    fs.writeFileSync(path.join(tmpDir, '.review.yml'), 'ignore:\n  - docs/\n  - "*.md"\n');
    const config = loadConfig(tmpDir);
    assert.ok(Array.isArray(config.ignore));
    assert.equal(config.ignore.length, 2);
  });

  it('should load webhooks', () => {
    fs.writeFileSync(path.join(tmpDir, '.review.yml'), 'webhooks:\n  - type: dingtalk\n    url: https://example.com\n');
    const config = loadConfig(tmpDir);
    assert.ok(Array.isArray(config.webhooks));
    assert.equal(config.webhooks.length, 1);
    assert.equal(config.webhooks[0].type, 'dingtalk');
  });
});
