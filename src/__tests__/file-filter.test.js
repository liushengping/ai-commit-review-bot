/**
 * Tests for file-filter.js
 * Run: node --test src/__tests__/file-filter.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldSkipFile, filterFiles, SKIP_PATTERNS } = require('../file-filter');

describe('shouldSkipFile', () => {
  it('should skip lock files', () => {
    assert.ok(shouldSkipFile('package-lock.json').skip);
    assert.ok(shouldSkipFile('yarn.lock').skip);
    assert.ok(shouldSkipFile('pnpm-lock.yaml').skip);
    assert.ok(shouldSkipFile('Cargo.lock').skip);
    assert.ok(shouldSkipFile('go.sum').skip);
  });

  it('should skip auto-generated code', () => {
    assert.ok(shouldSkipFile('src/api.generated.ts').skip);
    assert.ok(shouldSkipFile('src/types.d.ts').skip);
    assert.ok(shouldSkipFile('src/proto.pb.go').skip);
    assert.ok(shouldSkipFile('src/__generated__/query.js').skip);
  });

  it('should skip build output', () => {
    assert.ok(shouldSkipFile('dist/bundle.js').skip);
    assert.ok(shouldSkipFile('build/output.js').skip);
    assert.ok(shouldSkipFile('.next/static/chunk.js').skip);
  });

  it('should skip dependencies', () => {
    assert.ok(shouldSkipFile('node_modules/express/index.js').skip);
    assert.ok(shouldSkipFile('vendor/github.com/pkg/errors.go').skip);
  });

  it('should skip binary/media files', () => {
    assert.ok(shouldSkipFile('logo.png').skip);
    assert.ok(shouldSkipFile('demo.mp4').skip);
    assert.ok(shouldSkipFile('font.woff2').skip);
    assert.ok(shouldSkipFile('archive.zip').skip);
    assert.ok(shouldSkipFile('app.exe').skip);
  });

  it('should NOT skip regular source files', () => {
    assert.ok(!shouldSkipFile('src/index.js').skip);
    assert.ok(!shouldSkipFile('lib/utils.ts').skip);
    assert.ok(!shouldSkipFile('main.go').skip);
    assert.ok(!shouldSkipFile('app.py').skip);
    assert.ok(!shouldSkipFile('README.md').skip);
  });
});

describe('filterFiles', () => {
  it('should filter out skipped files and keep reviewable ones', () => {
    const files = [
      { filename: 'src/index.js', patch: 'some code', additions: 5, deletions: 2, status: 'modified' },
      { filename: 'package-lock.json', patch: 'lock', additions: 100, deletions: 50, status: 'modified' },
      { filename: 'src/utils.ts', patch: 'more code', additions: 3, deletions: 1, status: 'modified' },
      { filename: 'dist/bundle.js', patch: 'built', additions: 1000, deletions: 0, status: 'modified' },
    ];

    const { reviewable, skipped } = filterFiles(files);
    assert.equal(reviewable.length, 2);
    assert.equal(skipped.length, 2);
    assert.equal(reviewable[0].filename, 'src/index.js');
    assert.equal(reviewable[1].filename, 'src/utils.ts');
  });

  it('should skip deletion-only files', () => {
    const files = [
      { filename: 'src/old.js', patch: '-removed line', additions: 0, deletions: 5, status: 'modified' },
      { filename: 'src/new.js', patch: '+added line', additions: 3, deletions: 0, status: 'modified' },
    ];

    const { reviewable, skipped } = filterFiles(files);
    assert.equal(reviewable.length, 1);
    assert.equal(reviewable[0].filename, 'src/new.js');
    assert.ok(skipped.some(s => s.reason.includes('deletion')));
  });

  it('should skip rename-only files', () => {
    const files = [
      { filename: 'src/new-name.js', patch: '', additions: 0, deletions: 0, status: 'renamed' },
    ];

    const { reviewable, skipped } = filterFiles(files);
    assert.equal(reviewable.length, 0);
    assert.ok(skipped.some(s => s.reason.includes('rename')));
  });

  it('should handle empty input', () => {
    const { reviewable, skipped } = filterFiles([]);
    assert.equal(reviewable.length, 0);
    assert.equal(skipped.length, 0);
  });
});
