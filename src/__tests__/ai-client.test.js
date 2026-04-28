/**
 * Tests for ai-client.js (sanitization only - no actual API calls)
 * Run: node --test src/__tests__/ai-client.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeError } = require('../ai-client');

describe('sanitizeError', () => {
  it('should redact Bearer tokens', () => {
    const error = new Error('Request failed with Bearer sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234');
    const sanitized = sanitizeError(error);
    assert.ok(!sanitized.includes('sk-abc123'));
    assert.ok(sanitized.includes('[REDACTED]'));
  });

  it('should redact x-api-key headers', () => {
    const error = new Error('Header x-api-key: supersecretapikey123456789abcdef');
    const sanitized = sanitizeError(error);
    assert.ok(!sanitized.includes('supersecretapikey'));
  });

  it('should keep normal error messages intact', () => {
    const error = new Error('API request timeout (120s)');
    const sanitized = sanitizeError(error);
    assert.ok(sanitized.includes('timeout'));
  });

  it('should redact long token-like strings', () => {
    const error = new Error('Failed with token abcdefghijklmnopqrstuvwxyz01234567890abcdef');
    const sanitized = sanitizeError(error);
    // The 40-char string should be redacted
    assert.ok(sanitized.includes('[REDACTED]'));
  });
});
