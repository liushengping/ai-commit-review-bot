/**
 * Tests for commands.js
 * Run: node --test src/__tests__/commands.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseCommands, executeCommands, HELP_TEXT } = require('../core/commands');

describe('parseCommands', () => {
  it('should parse single command', () => {
    const cmds = parseCommands('/re-review');
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, 're-review');
    assert.equal(cmds[0].args, '');
  });

  it('should parse command with arguments', () => {
    const cmds = parseCommands('/skip src/vendor.js');
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, 'skip');
    assert.equal(cmds[0].args, 'src/vendor.js');
  });

  it('should parse multiple commands', () => {
    const cmds = parseCommands('/re-review\n/skip docs/\n/help');
    assert.equal(cmds.length, 3);
    assert.equal(cmds[0].command, 're-review');
    assert.equal(cmds[1].command, 'skip');
    assert.equal(cmds[2].command, 'help');
  });

  it('should ignore non-command text', () => {
    const cmds = parseCommands('This is a normal comment\nSome more text');
    assert.equal(cmds.length, 0);
  });

  it('should handle mixed text and commands', () => {
    const cmds = parseCommands('Please review again\n/re-review\nThanks!');
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, 're-review');
  });

  it('should handle null/empty input', () => {
    assert.deepStrictEqual(parseCommands(null), []);
    assert.deepStrictEqual(parseCommands(''), []);
  });
});

describe('executeCommands', () => {
  it('should handle /help command', () => {
    const context = { config: {}, repoRoot: '/tmp' };
    const responses = executeCommands([{ command: 'help', args: '' }], context);
    assert.equal(responses.length, 1);
    assert.ok(responses[0].includes('Commands'));
  });

  it('should handle /skip command', () => {
    const context = { config: {}, repoRoot: '/tmp' };
    const responses = executeCommands([{ command: 'skip', args: 'docs/' }], context);
    assert.equal(responses.length, 1);
    assert.ok(responses[0].includes('docs/'));
    assert.ok(context.config.ignore.includes('docs/'));
  });

  it('should handle /severity down', () => {
    const context = { config: {}, repoRoot: '/tmp' };
    const responses = executeCommands([{ command: 'severity', args: 'down' }], context);
    assert.equal(responses.length, 1);
    assert.ok(responses[0].includes('lowered'));
    assert.equal(context.config.severity.block_threshold, 'critical');
  });

  it('should handle /false-positive with valid issue', () => {
    const context = {
      config: {},
      repoRoot: '/tmp/test-fp',
      lastReviewIssues: [
        { file: 'test.js', line: 5, severity: 'warning', category: 'bug', description: 'test' },
      ],
    };
    // Create temp dir
    const fs = require('fs');
    fs.mkdirSync(context.repoRoot, { recursive: true });
    const responses = executeCommands([{ command: 'false-positive', args: '1' }], context);
    assert.equal(responses.length, 1);
    assert.ok(responses[0].includes('false positive'));
    fs.rmSync(context.repoRoot, { recursive: true, force: true });
  });

  it('should handle /approve command', () => {
    const context = { config: {}, repoRoot: '/tmp' };
    const responses = executeCommands([{ command: 'approve', args: '' }], context);
    assert.ok(context.requestApprove === true);
  });

  it('should ignore unknown commands', () => {
    const context = { config: {}, repoRoot: '/tmp' };
    const responses = executeCommands([{ command: 'unknown', args: '' }], context);
    assert.equal(responses.length, 0);
  });
});
