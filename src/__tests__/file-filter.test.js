/**
 * Tests for file-filter.js
 * Run: node --test src/__tests__/file-filter.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldSkipFile, filterFiles, matchesIgnorePattern, isBinaryDiff, SKIP_PATTERNS } = require('../core/file-filter');

describe('shouldSkipFile', () => {
  it('should skip lock files', () => {
    const result = shouldSkipFile('package-lock.json');
    assert.ok(result.skip);
    assert.ok(result.reason.includes('skip pattern'));
  });

  it('should skip binary files by extension', () => {
    assert.ok(shouldSkipFile('image.png').skip);
    assert.ok(shouldSkipFile('font.woff2').skip);
    assert.ok(shouldSkipFile('archive.zip').skip);
    assert.ok(shouldSkipFile('binary.exe').skip);
  });

  it('should skip files in dist/build/node_modules', () => {
    assert.ok(shouldSkipFile('dist/bundle.js').skip);
    assert.ok(shouldSkipFile('build/output.js').skip);
    assert.ok(shouldSkipFile('node_modules/pkg/index.js').skip);
  });

  it('should not skip normal source files', () => {
    assert.ok(!shouldSkipFile('src/index.js').skip);
    assert.ok(!shouldSkipFile('lib/utils.py').skip);
    assert.ok(!shouldSkipFile('main.go').skip);
  });

  it('should respect user-defined ignore patterns', () => {
    const result = shouldSkipFile('docs/README.md', ['docs/', '*.md']);
    assert.ok(result.skip);
  });

  it('should handle glob-like ignore patterns', () => {
    assert.ok(shouldSkipFile('test/fixtures/data.json', ['test/fixtures/']).skip);
    assert.ok(!shouldSkipFile('test/unit.test.js', ['test/fixtures/']).skip);
  });
});

describe('matchesIgnorePattern', () => {
  it('should match directory prefix patterns', () => {
    assert.ok(matchesIgnorePattern('docs/README.md', ['docs/']));
    assert.ok(!matchesIgnorePattern('src/docs/README.md', ['docs/']));
    assert.ok(matchesIgnorePattern('docs', ['docs/']));
  });

  it('should match wildcard patterns', () => {
    assert.ok(matchesIgnorePattern('test.js', ['*.js']));
    assert.ok(!matchesIgnorePattern('test.py', ['*.js']));
  });

  it('should match double-star patterns', () => {
    assert.ok(matchesIgnorePattern('deep/nested/path/file.js', ['**/file.js']));
  });

  it('should handle empty patterns', () => {
    assert.ok(!matchesIgnorePattern('file.js', []));
    assert.ok(!matchesIgnorePattern('file.js', null));
  });
});

describe('isBinaryDiff', () => {
  it('should detect binary file diffs', () => {
    assert.ok(isBinaryDiff('Binary files a/image.png and b/image.png differ'));
    assert.ok(isBinaryDiff('some header\nBinary files a/img and b/img differ\n'));
    assert.ok(isBinaryDiff('GIT binary patch\n'));
  });

  it('should not detect normal diffs as binary', () => {
    assert.ok(!isBinaryDiff('+added line\n-removed line\n'));
    assert.ok(!isBinaryDiff(''));
    assert.ok(!isBinaryDiff(null));
  });
});

describe('filterFiles', () => {
  const makeFile = (filename, patch, additions = 1, deletions = 0, status = 'modified') => ({
    filename, status, additions, deletions,
    patch: patch || `+line\n`,
    lineMapping: [],
  });

  it('should filter out binary files', () => {
    const files = [makeFile('image.png', 'Binary files a/image.png and b/image.png differ')];
    const { reviewable, skipped } = filterFiles(files);
    assert.equal(reviewable.length, 0);
    assert.equal(skipped.length, 1);
    assert.ok(skipped[0].reason.includes('binary'));
  });

  it('should filter out deletion-only files', () => {
    const files = [makeFile('old.js', '-line\n', 0, 1)];
    const { reviewable, skipped } = filterFiles(files);
    assert.equal(reviewable.length, 0);
    assert.equal(skipped.length, 1);
    assert.ok(skipped[0].reason.includes('deletion'));
  });

  it('should filter out rename-only files', () => {
    const files = [{ filename: 'new.js', status: 'renamed', additions: 0, deletions: 0, patch: '', lineMapping: [] }];
    const { reviewable, skipped } = filterFiles(files);
    assert.equal(reviewable.length, 0);
    assert.equal(skipped.length, 1);
    assert.ok(skipped[0].reason.includes('rename'));
  });

  it('should apply ignore config', () => {
    const files = [
      makeFile('docs/README.md', '+line\n'),
      makeFile('src/index.js', '+line\n'),
    ];
    const { reviewable, skipped } = filterFiles(files, { ignore: ['docs/'] });
    assert.equal(reviewable.length, 1);
    assert.equal(skipped.length, 1);
    assert.equal(reviewable[0].filename, 'src/index.js');
  });

  it('should pass through normal files', () => {
    const files = [makeFile('src/index.js', '+const a = 1;\n')];
    const { reviewable, skipped } = filterFiles(files);
    assert.equal(reviewable.length, 1);
    assert.equal(skipped.length, 0);
  });
});
