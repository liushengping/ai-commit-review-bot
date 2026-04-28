/**
 * Tests for diff-parser.js
 * Run: node --test src/__tests__/diff-parser.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDiff, truncateDiff, formatDiffForReview, mapDiffLineToNewFile, estimateTokens } = require('../core/diff-parser');

describe('parseDiff', () => {
  it('should return empty array for null/empty input', () => {
    assert.deepStrictEqual(parseDiff(null), []);
    assert.deepStrictEqual(parseDiff(''), []);
    assert.deepStrictEqual(parseDiff(undefined), []);
  });

  it('should parse a single file diff', () => {
    const diff = `diff --git a/src/index.js b/src/index.js
index abc123..def456 100644
--- a/src/index.js
+++ b/src/index.js
@@ -10,6 +10,8 @@ function foo() {
   const a = 1;
+  const b = 2;
+  const c = 3;
   return a;
 }`;

    const files = parseDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0].filename, 'src/index.js');
    assert.equal(files[0].status, 'modified');
    assert.equal(files[0].additions, 2);
    assert.ok(files[0].lineMapping.length > 0);
  });

  it('should parse multiple files', () => {
    const diff = `diff --git a/a.js b/a.js
new file mode 100644
--- /dev/null
+++ b/a.js
@@ -0,0 +1,3 @@
+const a = 1;
+const b = 2;
+export default a;
diff --git a/b.js b/b.js
--- a/b.js
+++ b/b.js
@@ -5,3 +5,4 @@ function bar() {
   const x = 1;
+  const y = 2;
   return x;
 }`;

    const files = parseDiff(diff);
    assert.equal(files.length, 2);
    assert.equal(files[0].filename, 'a.js');
    assert.equal(files[0].status, 'added');
    assert.equal(files[1].filename, 'b.js');
  });

  it('should detect deleted file status', () => {
    const diff = `diff --git a/old.js b/old.js
deleted file mode 100644
--- a/old.js
+++ /dev/null
@@ -1,3 +0,0 @@
-const a = 1;
-const b = 2;
-export default a;`;

    const files = parseDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0].status, 'deleted');
    assert.equal(files[0].additions, 0);
    assert.equal(files[0].deletions, 3);
  });
});

describe('mapDiffLineToNewFile', () => {
  it('should map addition lines to new file lines', () => {
    const diff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -10,4 +10,6 @@ function foo() {
   const a = 1;
+  const b = 2;
+  const c = 3;
   return a;
 }`;

    const files = parseDiff(diff);
    const mapping = files[0].lineMapping;

    // The + lines should map to new file lines
    const bLine = mapDiffLineToNewFile(mapping, 2); // 2nd line in patch = first +
    assert.ok(bLine !== null);
    assert.equal(typeof bLine, 'number');
  });

  it('should return null for deletion lines', () => {
    const diff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -10,5 +10,4 @@ function foo() {
   const a = 1;
-  const old = 'removed';
   const b = 2;
   return a;
 }`;

    const files = parseDiff(diff);
    const mapping = files[0].lineMapping;

    // Find the deletion entry
    const deletionEntry = mapping.find(m => m.type === '-');
    assert.ok(deletionEntry, 'Should have a deletion entry');
    // Deletion lines have null newFileLine - mapDiffLineToNewFile should return null
    const result = mapDiffLineToNewFile(mapping, deletionEntry.diffLineIndex + 1);
    assert.equal(result, null);
  });
});

describe('estimateTokens', () => {
  it('should estimate English text tokens', () => {
    const text = 'a'.repeat(400); // ~100 tokens
    const tokens = estimateTokens(text);
    assert.ok(tokens >= 90 && tokens <= 110, `Expected ~100, got ${tokens}`);
  });

  it('should estimate CJK text tokens (higher density)', () => {
    const text = '你'.repeat(100); // CJK: ~2 chars per token → ~50 tokens
    const tokens = estimateTokens(text);
    assert.ok(tokens >= 40 && tokens <= 60, `Expected ~50, got ${tokens}`);
  });
});

describe('truncateDiff', () => {
  it('should not truncate files within limits', () => {
    const files = [{
      filename: 'small.js',
      status: 'modified',
      additions: 5,
      deletions: 0,
      patch: 'line1\nline2\nline3',
      lineMapping: [],
    }];

    const { files: result, truncated } = truncateDiff(files, 500, 100000);
    assert.equal(result.length, 1);
    assert.equal(truncated, false);
  });

  it('should truncate when global token budget exceeded', () => {
    const bigPatch = 'x'.repeat(200000); // ~50k tokens
    const files = [
      {
        filename: 'big1.js',
        status: 'modified',
        additions: 100,
        deletions: 0,
        patch: bigPatch,
        lineMapping: [],
      },
      {
        filename: 'big2.js',
        status: 'modified',
        additions: 100,
        deletions: 0,
        patch: bigPatch,
        lineMapping: [],
      },
    ];

    const { files: result, truncated } = truncateDiff(files, 500, 50000);
    assert.ok(truncated);
    assert.ok(result.length < 2 || result.some(f => f.patch.includes('truncated')));
  });
});

describe('formatDiffForReview', () => {
  it('should format files into readable diff', () => {
    const files = [{
      filename: 'test.js',
      status: 'modified',
      additions: 2,
      deletions: 1,
      patch: '+added\n-removed\n context',
      lineMapping: [],
    }];

    const result = formatDiffForReview(files);
    assert.ok(result.includes('Total files changed: 1'));
    assert.ok(result.includes('test.js'));
    assert.ok(result.includes('+2'));
  });

  it('should handle empty files array', () => {
    const result = formatDiffForReview([]);
    assert.equal(result, 'No code changes detected.');
  });
});
