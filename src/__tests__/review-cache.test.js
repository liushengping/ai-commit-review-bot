/**
 * Tests for review-cache.js
 * Run: node --test src/__tests__/review-cache.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fingerprint, loadCache, saveCache, filterCachedIssues, clearCache } = require('../core/review-cache');

describe('fingerprint', () => {
  it('should generate consistent fingerprints', () => {
    const issue = { file: 'test.js', category: 'bug', line: 5 };
    const fp1 = fingerprint(issue, 'line1\nline2\nline3\nline4\nline5\nline6');
    const fp2 = fingerprint(issue, 'line1\nline2\nline3\nline4\nline5\nline6');
    assert.equal(fp1, fp2);
  });

  it('should generate different fingerprints for different files', () => {
    const issue1 = { file: 'a.js', category: 'bug', line: 1 };
    const issue2 = { file: 'b.js', category: 'bug', line: 1 };
    assert.notEqual(fingerprint(issue1, 'code'), fingerprint(issue2, 'code'));
  });
});

describe('filterCachedIssues', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return all issues on first run', () => {
    const issues = [
      { file: 'test.js', line: 5, severity: 'warning', category: 'bug', description: 'test issue' },
    ];
    const patches = new Map([['test.js', 'some code']]);
    const { newIssues, cachedCount } = filterCachedIssues(issues, patches, tmpDir);
    assert.equal(newIssues.length, 1);
    assert.equal(cachedCount, 0);
  });

  it('should filter duplicate issues on second run', () => {
    const issues = [
      { file: 'test.js', line: 5, severity: 'warning', category: 'bug', description: 'test issue' },
    ];
    const patches = new Map([['test.js', 'some code']]);

    // First run
    filterCachedIssues(issues, patches, tmpDir);

    // Second run — same issue should be cached
    const { newIssues, cachedCount } = filterCachedIssues(issues, patches, tmpDir);
    assert.equal(newIssues.length, 0);
    assert.equal(cachedCount, 1);
  });

  it('should not filter different issues', () => {
    const issues1 = [
      { file: 'test.js', line: 5, severity: 'warning', category: 'bug', description: 'issue A' },
    ];
    const issues2 = [
      { file: 'test.js', line: 5, severity: 'warning', category: 'bug', description: 'issue B' },
    ];
    const patches = new Map([['test.js', 'some code']]);

    filterCachedIssues(issues1, patches, tmpDir);
    const { newIssues, cachedCount } = filterCachedIssues(issues2, patches, tmpDir);
    assert.equal(newIssues.length, 1);
    assert.equal(cachedCount, 0);
  });

  it('should handle empty issues array', () => {
    const patches = new Map();
    const { newIssues, cachedCount } = filterCachedIssues([], patches, tmpDir);
    assert.equal(newIssues.length, 0);
    assert.equal(cachedCount, 0);
  });
});

describe('clearCache', () => {
  it('should remove cache file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
    saveCache(tmpDir, { version: 1, entries: { test: {} } });
    assert.ok(fs.existsSync(path.join(tmpDir, '.review-cache.json')));
    clearCache(tmpDir);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.review-cache.json')));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
