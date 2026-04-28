const https = require('https');
const http = require('http');

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

/**
 * Sanitize error messages to prevent API key/token leakage
 */
function sanitizeError(error) {
  let msg = error.message || String(error);
  msg = msg.replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, 'Bearer [REDACTED]');
  msg = msg.replace(/x-api-key:\s*[A-Za-z0-9\-_.~+/]+=*/gi, 'x-api-key: [REDACTED]');
  msg = msg.replace(/[A-Za-z0-9]{20,}/g, (match) => {
    if (match.length > 30) return '[REDACTED]';
    return match;
  });
  return msg;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error, statusCode) {
  if (statusCode && (statusCode === 429 || statusCode >= 500)) return true;
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('timeout')) return true;
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true;
  if (msg.includes('socket hang up')) return true;
  if (msg.includes('rate limit') || msg.includes('429')) return true;
  return false;
}

/**
 * Call AI API (OpenAI-compatible or Anthropic) with retry + fallback
 */
async function callAI({ provider, apiKey, apiBaseUrl, model, fallbackModel, messages, maxTokens = 4096 }) {
  const models = [model];
  if (fallbackModel) models.push(fallbackModel);

  let lastError;
  for (const currentModel of models) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const fn = provider === 'anthropic' ? callAnthropic : callOpenAICompatible;
        return await fn({ apiKey, apiBaseUrl, model: currentModel, messages, maxTokens });
      } catch (error) {
        lastError = error;
        const statusCode = error.statusCode || (error.message && error.message.match(/\b(4\d{2}|5\d{2})\b/)?.[0]);
        if (isRetryableError(error, statusCode) && attempt < MAX_RETRIES - 1) {
          const delay = INITIAL_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
          console.warn(`API call attempt ${attempt + 1} failed (${error.message}), retrying in ${Math.round(delay)}ms...`);
          await sleep(delay);
        } else {
          break;
        }
      }
    }
    if (currentModel !== models[models.length - 1]) {
      console.warn(`Model ${currentModel} failed, trying fallback...`);
    }
  }
  throw new Error(`All API attempts failed: ${sanitizeError(lastError)}`);
}

function callOpenAICompatible({ apiKey, apiBaseUrl, model, messages, maxTokens }) {
  const url = new URL(`${apiBaseUrl}/chat/completions`);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.1,
  });

  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            const err = new Error(`API Error: ${json.error.message || JSON.stringify(json.error)}`);
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }
          const content = json.choices?.[0]?.message?.content || '';
          resolve(content);
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${data.substring(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('API request timeout (120s)'));
    });
    req.write(body);
    req.end();
  });
}

function callAnthropic({ apiKey, apiBaseUrl, model, messages, maxTokens }) {
  const url = new URL(`${apiBaseUrl}/messages`);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const userMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system: systemMsg,
    messages: userMessages,
  });

  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            const err = new Error(`API Error: ${json.error.message || JSON.stringify(json.error)}`);
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }
          const content = json.content?.[0]?.text || '';
          resolve(content);
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${data.substring(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('API request timeout (120s)'));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { callAI, sanitizeError };
