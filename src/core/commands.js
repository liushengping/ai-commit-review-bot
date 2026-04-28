/**
 * PR Comment Commands — interact with the bot via PR/MR comments
 *
 * Supported commands (posted as PR/MR comments):
 *
 *   /re-review          → Clear cache and re-run full review
 *   /skip file.js       → Skip a file in current and future reviews
 *   /severity down      → Lower severity thresholds for this PR
 *   /severity up        → Restore default severity thresholds
 *   /approve            → Manually trigger approval
 *   /explain issue-N    → Get detailed explanation of an issue
 *   /fix issue-N        → Generate fix code for a specific issue
 *   /false-positive N   → Mark issue N as false positive (learns from it)
 *   /help               → Show available commands
 */

const { clearCache } = require('./review-cache');

/**
 * Parse commands from a PR/MR comment body.
 *
 * @param {string} body - Comment body text
 * @returns {Array<{command: string, args: string}>} - Parsed commands
 */
function parseCommands(body) {
  if (!body || typeof body !== 'string') return [];

  const commands = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match /command or /command args
    const match = trimmed.match(/^\/([\w-]+)(?:\s+(.*))?$/);
    if (match) {
      commands.push({
        command: match[1].toLowerCase(),
        args: (match[2] || '').trim(),
      });
    }
  }

  return commands;
}

/**
 * Execute parsed commands.
 *
 * @param {Array} commands - Parsed commands
 * @param {Object} context - Execution context
 * @param {string} context.repoRoot - Repository root path
 * @param {Object} context.config - Current config (will be mutated)
 * @param {Array} context.lastReviewIssues - Issues from last review
 * @param {Object} context.adapter - Platform adapter
 * @param {number} context.mrNumber - MR/PR number
 * @returns {Array<string>} - Response messages to post
 */
function executeCommands(commands, context) {
  const responses = [];
  const { repoRoot, config } = context;

  for (const { command, args } of commands) {
    switch (command) {
      case 're-review': {
        clearCache(repoRoot);
        // Set a flag so the main loop knows to re-review
        context.requestReReview = true;
        responses.push('🔄 Cache cleared. Full re-review will run on next trigger.');
        break;
      }

      case 'skip': {
        if (!args) {
          responses.push('❓ Usage: `/skip <filename>` or `/skip <pattern>`');
          break;
        }
        // Add to ignore list
        if (!config.ignore) config.ignore = [];
        if (!config.ignore.includes(args)) {
          config.ignore.push(args);
          responses.push(`⏭️ Will skip \`${args}\` in current and future reviews.`);
        } else {
          responses.push(`⏭️ \`${args}\` is already being skipped.`);
        }
        break;
      }

      case 'severity': {
        if (args === 'down') {
          config.severity = config.severity || {};
          config.severity.block_threshold = 'critical'; // only block on critical
          config.severity.inline_threshold = 'error';    // only inline on error+
          responses.push('📉 Severity lowered. Will only flag critical/error issues.');
        } else if (args === 'up') {
          config.severity = config.severity || {};
          config.severity.block_threshold = 'error';
          config.severity.inline_threshold = 'info';
          responses.push('📈 Severity restored to default levels.');
        } else {
          responses.push('❓ Usage: `/severity down` or `/severity up`');
        }
        break;
      }

      case 'approve': {
        context.requestApprove = true;
        responses.push('✅ Manual approval requested.');
        break;
      }

      case 'explain': {
        const issueNum = parseInt(args.replace(/^issue-?/i, ''), 10);
        if (isNaN(issueNum) || issueNum < 1) {
          responses.push('❓ Usage: `/explain issue-N` (e.g., `/explain issue-3`)');
          break;
        }
        const issues = context.lastReviewIssues || [];
        const issue = issues[issueNum - 1];
        if (!issue) {
          responses.push(`❓ Issue #${issueNum} not found. Last review had ${issues.length} issue(s).`);
          break;
        }
        const explanation = formatIssueExplanation(issue, issueNum);
        responses.push(explanation);
        break;
      }

      case 'fix': {
        const fixNum = parseInt(args.replace(/^issue-?/i, ''), 10);
        if (isNaN(fixNum) || fixNum < 1) {
          responses.push('❓ Usage: `/fix issue-N` (e.g., `/fix issue-2`)');
          break;
        }
        const fixIssues = context.lastReviewIssues || [];
        const fixIssue = fixIssues[fixNum - 1];
        if (!fixIssue) {
          responses.push(`❓ Issue #${fixNum} not found.`);
          break;
        }
        if (fixIssue.fix) {
          const { formatFixSuggestion } = require('./auto-fixer');
          responses.push(formatFixSuggestion(fixIssue));
        } else if (fixIssue.suggestion) {
          responses.push(`💡 **Suggestion:** ${fixIssue.suggestion}`);
        } else {
          responses.push(`No specific fix available for issue #${fixNum}. Manual review needed.`);
        }
        break;
      }

      case 'false-positive': {
        const fpNum = parseInt(args.replace(/^issue-?/i, ''), 10);
        if (isNaN(fpNum) || fpNum < 1) {
          responses.push('❓ Usage: `/false-positive N`');
          break;
        }
        const fpIssues = context.lastReviewIssues || [];
        const fpIssue = fpIssues[fpNum - 1];
        if (!fpIssue) {
          responses.push(`❓ Issue #${fpNum} not found.`);
          break;
        }
        // Record as false positive in cache
        try {
          const { loadCache, saveCache, fingerprint } = require('./review-cache');
          const cache = loadCache(repoRoot);
          const fp = fingerprint(fpIssue, '');
          cache.entries[fp] = {
            severity: fpIssue.severity,
            category: fpIssue.category,
            description: fpIssue.description,
            file: fpIssue.file,
            lastSeen: Date.now(),
            falsePositive: true,
          };
          saveCache(repoRoot, cache);
          responses.push(`✅ Issue #${fpNum} marked as false positive. Won't report it again.`);
        } catch (e) {
          responses.push(`⚠️ Could not record false positive: ${e.message}`);
        }
        break;
      }

      case 'help': {
        responses.push(HELP_TEXT);
        break;
      }

      default:
        // Unknown command — ignore silently
        break;
    }
  }

  return responses;
}

/**
 * Format a detailed explanation of an issue.
 */
function formatIssueExplanation(issue, num) {
  const severityEmoji = { info: 'ℹ️', warning: '⚠️', error: '❌', critical: '🚨' };
  const categoryLabel = {
    bug: '🐛 Potential Bug', security: '🔒 Security Risk', performance: '⚡ Performance',
    quality: '📝 Code Quality', missing: '📋 Missing Handling',
  };

  const parts = [];
  parts.push(`### ${severityEmoji[issue.severity] || '⚠️'} Issue #${num} — ${categoryLabel[issue.category] || issue.category}`);
  parts.push('');
  parts.push(`**File:** \`${issue.file}\`${issue.line ? `:${issue.line}` : ''}`);
  parts.push(`**Severity:** ${issue.severity}`);
  parts.push(`**Category:** ${issue.category}`);
  parts.push('');
  parts.push(`**Problem:** ${issue.description}`);
  parts.push('');

  if (issue.suggestion) {
    parts.push(`**How to fix:** ${issue.suggestion}`);
    parts.push('');
  }

  if (issue.fix) {
    const { formatFixSuggestion } = require('./auto-fixer');
    parts.push(formatFixSuggestion(issue));
  }

  return parts.join('\n');
}

const HELP_TEXT = `## 🤖 AI Commit Review Bot — Commands

| Command | Description |
|---------|-------------|
| \`/re-review\` | Clear cache and run a full re-review |
| \`/skip <file>\` | Skip a file or pattern in reviews |
| \`/severity down\` | Lower severity thresholds |
| \`/severity up\` | Restore default severity |
| \`/approve\` | Manually trigger approval |
| \`/explain issue-N\` | Detailed explanation of issue N |
| \`/fix issue-N\` | Generate fix code for issue N |
| \`/false-positive N\` | Mark issue N as false positive |
| \`/help\` | Show this help message |

Commands can be posted as PR/MR comments. Multiple commands per comment are supported.`;

module.exports = { parseCommands, executeCommands, formatIssueExplanation, HELP_TEXT };
