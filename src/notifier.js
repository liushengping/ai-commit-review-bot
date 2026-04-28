/**
 * Webhook notifier - send review summaries to external services
 * Supports: DingTalk, WeCom (企业微信), Slack, Feishu (飞书), generic webhook
 */

const https = require('https');
const http = require('http');

/**
 * Send notification to configured webhooks
 * @param {object} options
 * @param {object} options.review - The review result
 * @param {string} options.prUrl - PR URL
 * @param {string} options.prTitle - PR title
 * @param {Array} options.webhooks - Array of webhook configs
 */
async function sendNotifications({ review, prUrl, prTitle, webhooks }) {
  if (!webhooks || webhooks.length === 0) return;

  const message = buildMessage(review, prUrl, prTitle);

  const results = await Promise.allSettled(
    webhooks.map(wh => sendWebhook(wh, message))
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      console.warn(`Webhook notification failed (${webhooks[i].type || 'generic'}): ${r.reason?.message || r.reason}`);
    }
  }
}

/**
 * Build a universal message object for different platforms
 */
function buildMessage(review, prUrl, prTitle) {
  const riskEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };
  const emoji = riskEmoji[review.risk_level] || '🟡';
  const issueCount = review.issues.length;

  const issueSummary = {};
  for (const issue of review.issues) {
    issueSummary[issue.severity] = (issueSummary[issue.severity] || 0) + 1;
  }

  const severityLine = [];
  if (issueSummary.critical) severityLine.push(`🚨 ${issueSummary.critical} critical`);
  if (issueSummary.error) severityLine.push(`❌ ${issueSummary.error} error`);
  if (issueSummary.warning) severityLine.push(`⚠️ ${issueSummary.warning} warning`);
  if (issueSummary.info) severityLine.push(`ℹ️ ${issueSummary.info} info`);

  const topIssues = review.issues.slice(0, 3).map(i => {
    const cat = { bug: '🐛', security: '🔒', performance: '⚡', quality: '📝', missing: '📋' };
    return `${cat[i.category] || '•'} ${i.description.substring(0, 80)}`;
  });

  return {
    title: `${emoji} AI Code Review: ${prTitle}`,
    text: [
      `**${review.summary}**`,
      `Risk: **${review.risk_level.toUpperCase()}** | Issues: **${issueCount}**`,
      severityLine.length > 0 ? severityLine.join(' · ') : '✅ No issues',
      '',
      ...topIssues,
      '',
      `🔗 [View PR](${prUrl})`,
    ].join('\n'),
    // Structured data for programmatic consumers
    data: {
      risk_level: review.risk_level,
      issue_count: issueCount,
      severity: issueSummary,
      summary: review.summary,
      pr_url: prUrl,
      pr_title: prTitle,
    },
  };
}

/**
 * Send to a single webhook
 */
async function sendWebhook(config, message) {
  const { type = 'generic', url, secret } = config;
  let body;

  switch (type) {
    case 'dingtalk':
      body = JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: message.title,
          text: message.text,
        },
      });
      break;

    case 'wecom': // 企业微信
    case 'wechat_work':
      body = JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: message.text,
        },
      });
      break;

    case 'slack':
      body = JSON.stringify({
        text: message.title,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: message.text },
          },
        ],
      });
      break;

    case 'feishu': // 飞书
      body = JSON.stringify({
        msg_type: 'text',
        content: {
          text: `${message.title}\n\n${message.text.replace(/\*\*/g, '')}`,
        },
      });
      break;

    default: // generic webhook
      body = JSON.stringify({
        title: message.title,
        text: message.text,
        data: message.data,
      });
  }

  return httpPost(url, body, secret);
}

/**
 * HTTP POST helper
 */
function httpPost(urlStr, body, secret) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };

    // Some webhooks use HMAC signature verification
    if (secret) {
      const crypto = require('crypto');
      const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Signature'] = signature;
      headers['X-Hub-Signature-256'] = `sha256=${signature}`;
    }

    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Webhook returned ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Webhook request timeout (10s)'));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { sendNotifications, buildMessage };
