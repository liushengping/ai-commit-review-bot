const https = require('https');
const http = require('http');

/**
 * Call AI API (OpenAI-compatible or Anthropic)
 */
async function callAI({ provider, apiKey, apiBaseUrl, model, messages, maxTokens = 4096 }) {
  if (provider === 'anthropic') {
    return callAnthropic({ apiKey, apiBaseUrl, model, messages, maxTokens });
  }
  return callOpenAICompatible({ apiKey, apiBaseUrl, model, messages, maxTokens });
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
            reject(new Error(`API Error: ${json.error.message || JSON.stringify(json.error)}`));
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

  // Convert from OpenAI message format to Anthropic format
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
            reject(new Error(`API Error: ${json.error.message || JSON.stringify(json.error)}`));
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

module.exports = { callAI };
