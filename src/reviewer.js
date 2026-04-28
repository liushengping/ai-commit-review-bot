const { callAI } = require('./ai-client');

const REVIEW_PROMPT_ZH = `你是一位资深代码审查专家。请对以下 Pull Request 的代码变更进行审查。

## 审查要求

请从以下维度进行审查：
1. **🐛 潜在 Bug** - 逻辑错误、空指针、类型错误、边界条件
2. **🔒 安全风险** - SQL 注入、XSS、敏感信息泄露、权限问题
3. **⚡ 性能问题** - 不必要的循环、内存泄漏、N+1 查询
4. **📝 代码质量** - 命名规范、代码重复、复杂度过高
5. **📋 缺失处理** - 缺少错误处理、缺少输入校验、缺少边界情况考虑

## 输出格式

请严格按以下 JSON 格式输出，不要包含任何其他文字：

{
  "summary": "一句话总结本次审查的整体质量",
  "risk_level": "low | medium | high | critical",
  "issues": [
    {
      "file": "文件路径",
      "line": "大致行号（可选）",
      "severity": "info | warning | error | critical",
      "category": "bug | security | performance | quality | missing",
      "description": "问题描述",
      "suggestion": "修复建议"
    }
  ],
  "highlights": ["值得肯定的设计或写法（如有）"]
}

## PR 代码变更

`;

const REVIEW_PROMPT_EN = `You are a senior code reviewer. Review the following Pull Request diff.

## Review Dimensions
1. **🐛 Potential Bugs** - Logic errors, null pointers, type errors, boundary conditions
2. **🔒 Security Risks** - SQL injection, XSS, sensitive data leaks, permission issues
3. **⚡ Performance** - Unnecessary loops, memory leaks, N+1 queries
4. **📝 Code Quality** - Naming conventions, code duplication, complexity
5. **📋 Missing Handling** - Missing error handling, input validation, edge cases

## Output Format

Output ONLY valid JSON (no markdown, no explanation):

{
  "summary": "One-line summary of review quality",
  "risk_level": "low | medium | high | critical",
  "issues": [
    {
      "file": "filename",
      "line": "approx line number (optional)",
      "severity": "info | warning | error | critical",
      "category": "bug | security | performance | quality | missing",
      "description": "Issue description",
      "suggestion": "Fix suggestion"
    }
  ],
  "highlights": ["Good patterns worth noting (if any)"]
}

## PR Diff

`;

/**
 * Build the review prompt based on language
 */
function getReviewPrompt(language) {
  return language === 'en' ? REVIEW_PROMPT_EN : REVIEW_PROMPT_ZH;
}

/**
 * Call AI to review the diff
 */
async function reviewDiff({ diffText, language, provider, apiKey, apiBaseUrl, model }) {
  const systemPrompt = language === 'en'
    ? 'You are an expert code reviewer. Output only valid JSON.'
    : '你是一位资深代码审查专家。只输出合法的 JSON，不要包含 markdown 代码块标记。';

  const userPrompt = getReviewPrompt(language) + diffText;

  const response = await callAI({
    provider,
    apiKey,
    apiBaseUrl,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 4096,
  });

  return parseReviewResponse(response);
}

/**
 * Parse AI response into structured review
 */
function parseReviewResponse(response) {
  // Try to extract JSON from response (handle markdown code blocks)
  let jsonStr = response.trim();

  // Remove markdown code block if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const review = JSON.parse(jsonStr);

    // Validate and normalize
    return {
      summary: review.summary || 'Review completed.',
      risk_level: ['low', 'medium', 'high', 'critical'].includes(review.risk_level)
        ? review.risk_level : 'medium',
      issues: Array.isArray(review.issues) ? review.issues.map(issue => ({
        file: issue.file || 'unknown',
        line: issue.line || '',
        severity: ['info', 'warning', 'error', 'critical'].includes(issue.severity)
          ? issue.severity : 'warning',
        category: issue.category || 'quality',
        description: issue.description || '',
        suggestion: issue.suggestion || '',
      })) : [],
      highlights: Array.isArray(review.highlights) ? review.highlights : [],
    };
  } catch (e) {
    // If JSON parsing fails, return a basic review with the raw text
    return {
      summary: 'Review completed but output format was non-standard.',
      risk_level: 'medium',
      issues: [],
      highlights: [response.substring(0, 500)],
    };
  }
}

/**
 * Format review into a GitHub-friendly markdown comment
 */
function formatReviewComment(review, language) {
  const riskEmoji = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  };

  const severityEmoji = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
    critical: '🚨',
  };

  const categoryLabel = {
    bug: '🐛 Bug',
    security: '🔒 安全',
    performance: '⚡ 性能',
    quality: '📝 代码质量',
    missing: '📋 缺失处理',
  };

  const parts = [];

  // Header
  parts.push(`## ${riskEmoji[review.risk_level] || '🟡'} AI Code Review`);
  parts.push('');
  parts.push(`**${review.summary}**`);
  parts.push(`> Risk Level: **${review.risk_level.toUpperCase()}**`);
  parts.push('');

  // Issues
  if (review.issues.length > 0) {
    parts.push(`### Issues Found (${review.issues.length})`);
    parts.push('');

    for (const issue of review.issues) {
      const emoji = severityEmoji[issue.severity] || '⚠️';
      const category = categoryLabel[issue.category] || issue.category;
      const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;

      parts.push(`${emoji} **${category}** — \`${location}\``);
      parts.push(`> ${issue.description}`);
      if (issue.suggestion) {
        parts.push(`> 💡 **Suggestion:** ${issue.suggestion}`);
      }
      parts.push('');
    }
  } else {
    parts.push('### ✅ No Issues Found');
    parts.push('');
    parts.push('Great job! No significant issues detected.');
    parts.push('');
  }

  // Highlights
  if (review.highlights.length > 0) {
    parts.push('### 🌟 Highlights');
    parts.push('');
    for (const h of review.highlights) {
      parts.push(`- ${h}`);
    }
    parts.push('');
  }

  // Footer
  parts.push('---');
  parts.push('<sub>🤖 Powered by [AI Commit Review Bot](https://github.com) | Model: MiMo-V2.5-Pro</sub>');

  return parts.join('\n');
}

module.exports = { reviewDiff, formatReviewComment, parseReviewResponse };
