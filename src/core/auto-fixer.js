/**
 * Auto-Fix — generate fix suggestions with code patches
 *
 * Extends the AI review prompt to request a `fix` field in each issue,
 * containing a unified-diff-style code snippet that shows the fix.
 *
 * The fix is formatted in review comments as a clickable suggestion
 * that developers can copy-paste or (in future) apply automatically.
 */

/**
 * Format an issue's fix suggestion as a code block for display.
 *
 * @param {Object} issue - Review issue with optional fix field
 * @returns {string} - Formatted fix suggestion, or empty string
 */
function formatFixSuggestion(issue) {
  if (!issue.fix && !issue.suggestion) return '';

  const parts = [];

  if (issue.fix) {
    // issue.fix is expected to be a code snippet (unified diff or plain code)
    const fixText = issue.fix.trim();

    // Detect if it looks like a diff
    const isDiff = fixText.includes('---') || fixText.includes('+++') ||
                   fixText.split('\n').some(l => l.startsWith('-') || l.startsWith('+'));

    if (isDiff) {
      parts.push('<details>');
      parts.push('<summary>🔧 <b>Suggested Fix</b> (click to expand)</summary>');
      parts.push('');
      parts.push('```diff');
      parts.push(fixText);
      parts.push('```');
      parts.push('');
      parts.push('</details>');
    } else {
      parts.push('🔧 **Suggested Fix:**');
      parts.push('');
      parts.push('```');
      parts.push(fixText);
      parts.push('```');
    }
  } else if (issue.suggestion) {
    parts.push(`💡 **Suggestion:** ${issue.suggestion}`);
  }

  return parts.join('\n');
}

/**
 * Augment the review prompt to request fix suggestions.
 * Returns a modified prompt string.
 */
function augmentPromptWithFixRequest(prompt) {
  return prompt.replace(
    '"suggestion": "修复建议"',
    '"suggestion": "修复建议",\n      "fix": "修复代码片段（unified diff 格式或代码块），如果能直接修复的话"'
  ).replace(
    '"suggestion": "Fix suggestion"',
    '"suggestion": "Fix suggestion",\n      "fix": "Fix code snippet (unified diff or code block), if directly fixable"'
  );
}

/**
 * Process review issues and ensure fix field is properly formatted.
 *
 * @param {Array} issues - Review issues from AI
 * @returns {Array} - Issues with normalized fix fields
 */
function normalizeIssues(issues) {
  return issues.map(issue => {
    const normalized = { ...issue };

    // Clean up fix field
    if (normalized.fix) {
      // Remove markdown code block markers if present
      normalized.fix = normalized.fix
        .replace(/^```(?:diff|javascript|js|python|go|java|typescript|ts)?\n?/m, '')
        .replace(/\n?```\s*$/m, '')
        .trim();
    }

    return normalized;
  });
}

module.exports = { formatFixSuggestion, augmentPromptWithFixRequest, normalizeIssues };
