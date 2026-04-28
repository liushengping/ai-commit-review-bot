/**
 * AI reviewer - platform-agnostic review logic
 */
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
      "line": "具体行号（必须是变更行，即 + 或 - 开头的行）",
      "end_line": "结束行号（可选，用于标注范围）",
      "severity": "info | warning | error | critical",
      "category": "bug | security | performance | quality | missing",
      "description": "问题描述",
      "suggestion": "修复建议",
      "fix": "修复代码片段（unified diff 格式或代码块），如果能直接修复的话"
    }
  ],
  "highlights": ["值得肯定的设计或写法（如有）"]
}

## 重要提示

- line 字段必须填写，且必须是 diff 中出现的实际变更行号
- 每个 issue 必须对应一个具体的代码位置
- 不要对未变更的代码提出问题

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
      "line": "exact changed line number from diff (the + or - line)",
      "end_line": "end line number (optional, for range)",
      "severity": "info | warning | error | critical",
      "category": "bug | security | performance | quality | missing",
      "description": "Issue description",
      "suggestion": "Fix suggestion",
      "fix": "Fix code snippet (unified diff or code block), if directly fixable"
    }
  ],
  "highlights": ["Good patterns worth noting (if any)"]
}

## Important

- line field is REQUIRED and must be an actual changed line from the diff
- Each issue must correspond to a specific code location
- Do not raise issues on unchanged code

## PR Diff

`;

function getReviewPrompt(language) {
  return language === 'en' ? REVIEW_PROMPT_EN : REVIEW_PROMPT_ZH;
}

function buildLanguageRulesPrompt(languageRules, diffText) {
  if (!languageRules || !Array.isArray(languageRules) || languageRules.length === 0) return '';

  // Extract filenames from diff text
  const fileMatches = diffText.match(/--- File: (.+?) /g) || [];
  const filenames = fileMatches.map(m => m.replace('--- File: ', '').replace(' ', ''));

  let section = '\n\n## Language/Framework Specific Rules\n\n';
  let hasRules = false;

  for (const rule of languageRules) {
    if (rule.pattern && rule.prompt) {
      // Convert glob pattern to regex for matching
      const regexStr = rule.pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/{{GLOBSTAR}}/g, '.*');
      const regex = new RegExp(regexStr);

      // Only include rules that match at least one file in the diff
      const matchingFiles = filenames.filter(f => regex.test(f));
      if (matchingFiles.length > 0) {
        section += `### Files matching \`${rule.pattern}\` (${matchingFiles.join(', ')})\n${rule.prompt}\n\n`;
        hasRules = true;
      }
    }
  }

  return hasRules ? section : '';
}

async function reviewDiff({ diffText, language, provider, apiKey, apiBaseUrl, model, fallbackModel, customPrompt, languageRules }) {
  const systemPrompt = language === 'en'
    ? 'You are an expert code reviewer. Output only valid JSON. Every issue MUST have a line number.'
    : '你是一位资深代码审查专家。只输出合法的 JSON，不要包含 markdown 代码块标记。每个 issue 必须有行号。';

  let userPrompt = getReviewPrompt(language) + diffText;

  const langRulesPrompt = buildLanguageRulesPrompt(languageRules, diffText);
  if (langRulesPrompt) userPrompt += langRulesPrompt;
  if (customPrompt) userPrompt += '\n\n## Additional Review Instructions\n\n' + customPrompt;

  const response = await callAI({
    provider, apiKey, apiBaseUrl, model, fallbackModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 4096,
  });

  return parseReviewResponse(response);
}

function parseReviewResponse(response) {
  let jsonStr = response.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  try {
    const review = JSON.parse(jsonStr);
    return {
      summary: review.summary || 'Review completed.',
      risk_level: ['low', 'medium', 'high', 'critical'].includes(review.risk_level) ? review.risk_level : 'medium',
      issues: Array.isArray(review.issues) ? review.issues.map(issue => ({
        file: issue.file || 'unknown',
        line: parseInt(issue.line, 10) || 0,
        end_line: parseInt(issue.end_line, 10) || undefined,
        severity: ['info', 'warning', 'error', 'critical'].includes(issue.severity) ? issue.severity : 'warning',
        category: issue.category || 'quality',
        description: issue.description || '',
        suggestion: issue.suggestion || '',
        fix: issue.fix || '',
      })) : [],
      highlights: Array.isArray(review.highlights) ? review.highlights : [],
    };
  } catch (e) {
    return {
      summary: 'Review completed but output format was non-standard.',
      risk_level: 'medium',
      issues: [],
      highlights: [response.substring(0, 500)],
    };
  }
}

function formatReviewComment(review, language, meta = {}) {
  const riskEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };
  const severityEmoji = { info: 'ℹ️', warning: '⚠️', error: '❌', critical: '🚨' };
  const categoryLabel = {
    bug: '🐛 Bug', security: '🔒 安全', performance: '⚡ 性能',
    quality: '📝 代码质量', missing: '📋 缺失处理',
  };

  const parts = [];
  parts.push(`## ${riskEmoji[review.risk_level] || '🟡'} AI Code Review`);
  parts.push('');

  if (meta.incremental) {
    parts.push('> 🆕 **Incremental review** — only reviewing changes since last review');
    parts.push('');
  }

  parts.push(`**${review.summary}**`);
  parts.push(`> Risk Level: **${review.risk_level.toUpperCase()}**`);
  parts.push('');

  if (meta.totalTokens) {
    parts.push(`> 📊 Estimated tokens: ~${meta.totalTokens.toLocaleString()}${meta.truncated ? ' (truncated)' : ''}`);
    if (meta.batchCount > 1) parts.push(`> 🔄 Parallel review: ${meta.batchCount} batches`);
    parts.push('');
  }

  if (review.issues.length > 0) {
    const bySeverity = {};
    for (const issue of review.issues) bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    const summaryParts = [];
    if (bySeverity.critical) summaryParts.push(`🚨 ${bySeverity.critical} critical`);
    if (bySeverity.error) summaryParts.push(`❌ ${bySeverity.error} error`);
    if (bySeverity.warning) summaryParts.push(`⚠️ ${bySeverity.warning} warning`);
    if (bySeverity.info) summaryParts.push(`ℹ️ ${bySeverity.info} info`);
    parts.push(`> ${summaryParts.join(' · ')}`);
    parts.push('');

    parts.push(`### Issues Found (${review.issues.length})`);
    parts.push('');
    for (const issue of review.issues) {
      const emoji = severityEmoji[issue.severity] || '⚠️';
      const category = categoryLabel[issue.category] || issue.category;
      const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
      const sourceTag = issue.source ? ` \`${issue.source}\`` : '';
      parts.push(`${emoji} **${category}**${sourceTag} — \`${location}\``);
      parts.push(`> ${issue.description}`);
      if (issue.suggestion) parts.push(`> 💡 **Suggestion:** ${issue.suggestion}`);
      if (issue.fix) {
        parts.push('');
        parts.push('<details>');
        parts.push('<summary>🔧 <b>Suggested Fix</b> (click to expand)</summary>');
        parts.push('');
        parts.push('```' + (issue.fix.includes('@@') ? 'diff' : ''));
        parts.push(issue.fix);
        parts.push('```');
        parts.push('');
        parts.push('</details>');
      }
      parts.push('');
    }
  } else {
    parts.push('### ✅ No Issues Found');
    parts.push('');
    parts.push('Great job! No significant issues detected.');
    parts.push('');
  }

  if (review.highlights.length > 0) {
    parts.push('### 🌟 Highlights');
    parts.push('');
    for (const h of review.highlights) parts.push(`- ${h}`);
    parts.push('');
  }

  if (meta.stats) {
    parts.push('### 📈 Review Statistics');
    parts.push('');
    parts.push(`- Files reviewed: ${meta.stats.filesReviewed || 0}`);
    parts.push(`- Files skipped: ${meta.stats.filesSkipped || 0}`);
    parts.push(`- Total changes: +${meta.stats.additions || 0} -${meta.stats.deletions || 0}`);
    if (meta.stats.duration) parts.push(`- Review duration: ${meta.stats.duration}s`);
    if (meta.stats.ruleIssues > 0) parts.push(`- 🔧 Rule engine issues: ${meta.stats.ruleIssues}`);
    if (meta.stats.deduped > 0) parts.push(`- 🗂️ Deduplicated issues: ${meta.stats.deduped}`);
    parts.push('');
  }

  if (meta.skippedFiles && meta.skippedFiles.length > 0) {
    parts.push('<details>');
    parts.push('<summary>📂 Skipped Files</summary>');
    parts.push('');
    for (const f of meta.skippedFiles) parts.push(`- \`${f.filename}\` — ${f.reason}`);
    parts.push('');
    parts.push('</details>');
    parts.push('');
  }

  const modelInfo = meta.model ? ` | Model: ${meta.model}` : '';
  parts.push('---');
  parts.push(`<sub>🤖 Powered by [AI Commit Review Bot](https://github.com/liushengping/ai-commit-review-bot)${modelInfo}</sub>`);

  return parts.join('\n');
}

const SEVERITY_LEVELS = { info: 0, warning: 1, error: 2, critical: 3 };

function meetsSeverityThreshold(severity, threshold) {
  return (SEVERITY_LEVELS[severity] || 0) >= (SEVERITY_LEVELS[threshold] || 0);
}

module.exports = { reviewDiff, formatReviewComment, parseReviewResponse, meetsSeverityThreshold, SEVERITY_LEVELS };
