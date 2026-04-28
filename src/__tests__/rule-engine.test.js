/**
 * Tests for rule-engine.js
 * Run: node --test src/__tests__/rule-engine.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runRules, matchesPattern, globToRegex, hasNearbyMatch } = require('../core/rule-engine');

describe('matchesPattern', () => {
  it('should match wildcard *', () => {
    assert.ok(matchesPattern('src/index.js', '*.js'));
    assert.ok(!matchesPattern('src/index.py', '*.js'));
  });

  it('should match ** for nested paths', () => {
    assert.ok(matchesPattern('deep/nested/file.js', '**/*.js'));
  });

  it('should match * as catch-all', () => {
    assert.ok(matchesPattern('anything.txt', '*'));
  });

  it('should match specific extensions', () => {
    assert.ok(matchesPattern('test.py', '*.py'));
    assert.ok(!matchesPattern('test.js', '*.py'));
  });
});

describe('hasNearbyMatch', () => {
  it('should find nearby pattern match', () => {
    const patch = 'line1\nconst x = 1;\ntry {\n  await fetch(url)\n} catch (e) {}\nline6';
    // "await fetch" at line 3, "try" at line 2 — within range
    assert.ok(hasNearbyMatch(patch, 3, 'try|catch', 5));
  });

  it('should return false when no nearby match', () => {
    const patch = 'line1\nconst x = 1;\nawait fetch(url)\nline4\nline5';
    // "await fetch" at line 3, no try/catch within range
    assert.ok(!hasNearbyMatch(patch, 3, 'try|catch', 2));
  });
});

describe('runRules', () => {
  const makeFile = (filename, patch) => ({
    filename, status: 'modified', additions: 1, deletions: 0,
    patch, lineMapping: [], isBinary: false,
  });

  it('should return empty array for no rules', () => {
    const files = [makeFile('test.js', '+const a = 1;\n')];
    assert.deepStrictEqual(runRules(files, []), []);
    assert.deepStrictEqual(runRules(files, null), []);
  });

  it('should detect regex match violations', () => {
    const files = [makeFile('index.js', '+console.log("debug")\n')];
    const rules = [{
      name: 'no-console',
      pattern: '*.js',
      match: 'console\\.log\\(',
      severity: 'warning',
      message: 'No console.log',
    }];
    const issues = runRules(files, rules);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'warning');
    assert.equal(issues[0].file, 'index.js');
    assert.equal(issues[0].source, 'rule:no-console');
  });

  it('should respect pattern matching', () => {
    const files = [makeFile('test.py', '+print("hello")\n')];
    const rules = [{
      name: 'no-console',
      pattern: '*.js',
      match: 'console\\.log\\(',
      severity: 'warning',
      message: 'No console.log',
    }];
    const issues = runRules(files, rules);
    assert.equal(issues.length, 0); // .py file, rule is for *.js
  });

  it('should check require_nearby constraint', () => {
    const files = [makeFile('index.js', '+const data = await fetch(url)\n')];
    const rules = [{
      name: 'require-try-catch',
      pattern: '*.js',
      match: 'await\\s+\\w+',
      require_nearby: 'try|catch',
      severity: 'error',
      message: 'Need error handling',
    }];

    // Without try/catch nearby → issue
    const issues1 = runRules(files, rules);
    assert.equal(issues1.length, 1);

    // With try/catch nearby → no issue
    const files2 = [makeFile('index.js', '+try {\n+const data = await fetch(url)\n+} catch(e) {}\n')];
    const issues2 = runRules(files2, rules);
    assert.equal(issues2.length, 0);
  });

  it('should limit issues per file per rule', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `+console.log(${i})`).join('\n');
    const files = [makeFile('index.js', lines + '\n')];
    const rules = [{
      name: 'no-console',
      pattern: '*.js',
      match: 'console\\.log\\(',
      severity: 'warning',
      message: 'No console.log',
      max_per_file: 3,
    }];
    const issues = runRules(files, rules);
    assert.equal(issues.length, 3); // capped at max_per_file
  });

  it('should handle multiple rules', () => {
    const files = [makeFile('index.js', '+console.log("test")\n+const key = "sk-1234567890abcdef"\n')];
    const rules = [
      {
        name: 'no-console',
        pattern: '*.js',
        match: 'console\\.log\\(',
        severity: 'warning',
        message: 'No console.log',
      },
      {
        name: 'no-secrets',
        pattern: '*',
        match: 'key.*=.*["\'][^\'"]{8,}',
        severity: 'critical',
        message: 'Possible secret',
      },
    ];
    const issues = runRules(files, rules);
    assert.ok(issues.length >= 2);
  });
});
