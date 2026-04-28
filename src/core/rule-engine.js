/**
 * Custom Rule Engine — zero-cost, zero-hallucination code checks
 *
 * Rules run BEFORE the AI review and produce deterministic results.
 * Supports: regex matching, metric thresholds, nearby-code requirements.
 *
 * Config example (.review.yml):
 *
 * rules:
 *   - name: no-console-log
 *     pattern: "*.js"
 *     match: "console\\.log\\("
 *     severity: warning
 *     message: "Remove console.log before merging"
 *
 *   - name: require-error-handling
 *     pattern: "*.js"
 *     match: "await\\s+\\w+"
 *     require_nearby: "try|catch|\\.catch"
 *     severity: error
 *     message: "Async calls must have error handling"
 *
 *   - name: no-hardcoded-secrets
 *     pattern: "*"
 *     match: "(api[_-]?key|secret|password|token)\\s*[:=]\\s*['\"][^'\"]{8,}"
 *     severity: critical
 *     message: "Possible hardcoded secret detected"
 *
 *   - name: max-function-length
 *     pattern: "*.js"
 *     metric: function_lines
 *     threshold: 50
 *     severity: warning
 *     message: "Function exceeds 50 lines, consider splitting"
 */

/**
 * Convert a glob-like pattern to a regex for filename matching.
 */
function globToRegex(pattern) {
  if (pattern === '*' || pattern === '**') return /.*/;
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '.*')                   // * matches anything including /
    .replace(/\?/g, '.')
    .replace(/{{GLOBSTAR}}/g, '.*');
  return new RegExp(`^${re}$`, 'i');
}

/**
 * Check if a filename matches a rule's pattern.
 */
function matchesPattern(filename, pattern) {
  return globToRegex(pattern).test(filename);
}

/**
 * Count lines in a function-like block (heuristic: counts lines between
 * opening `{` and matching closing `}` at the same indentation level).
 */
function countFunctionLines(patch, startLine) {
  const lines = patch.split('\n');
  let depth = 0;
  let count = 0;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    count++;
    if (depth === 0 && count > 1) break;
  }
  return count;
}

/**
 * Find all function-like blocks and return their line ranges.
 * Heuristic: looks for function/arrow/method declarations followed by `{`.
 */
function findFunctionBlocks(patch) {
  const blocks = [];
  const lines = patch.split('\n');
  // Patterns that typically start a function block
  const funcPattern = /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|\w+\s*=>)|(?:async\s+)?(?:get|set|static)?\s*\w+\s*\([^)]*\)\s*\{|(?:async\s+)?\w+\s*\([^)]*\)\s*\{)/;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/^\s*[+-]?/, ''); // remove diff prefix
    if (funcPattern.test(stripped)) {
      const lineCount = countFunctionLines(lines.slice(i).join('\n'), 0);
      blocks.push({ startLine: i, lineCount });
    }
  }
  return blocks;
}

/**
 * Check if a pattern appears "nearby" (within N lines) of a match location.
 */
function hasNearbyMatch(patch, matchLineIdx, nearbyPattern, range = 10) {
  const lines = patch.split('\n');
  const regex = new RegExp(nearbyPattern, 'i');
  const start = Math.max(0, matchLineIdx - range);
  const end = Math.min(lines.length, matchLineIdx + range + 1);
  for (let i = start; i < end; i++) {
    const stripped = lines[i].replace(/^\s*[+-]?/, '');
    if (regex.test(stripped)) return true;
  }
  return false;
}

/**
 * Run all configured rules against the parsed files.
 * Returns an array of issues in the same format as the AI review.
 *
 * @param {Array} files - Parsed diff files (from parseDiff)
 * @param {Array} rules - Rules from config.rules
 * @returns {Array} issues
 */
function runRules(files, rules) {
  if (!rules || !Array.isArray(rules) || rules.length === 0) return [];

  const issues = [];

  for (const rule of rules) {
    if (!rule.match && !rule.metric) continue;
    const severity = rule.severity || 'warning';
    const category = rule.category || 'quality';
    const message = rule.message || `Rule violation: ${rule.name || 'unnamed'}`;
    const pattern = rule.pattern || '*';

    for (const file of files) {
      if (!matchesPattern(file.filename, pattern)) continue;
      if (file.isBinary) continue;

      const patch = file.patch;
      const lines = patch.split('\n');

      // --- Regex match rules ---
      if (rule.match) {
        const regex = new RegExp(rule.match, rule.flags || 'gi');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Only check added/modified lines (+ prefix or context)
          if (!line.startsWith('+') && !line.startsWith(' ')) continue;

          const stripped = line.replace(/^\s*[+-]?/, '');
          if (!regex.test(stripped)) continue;
          regex.lastIndex = 0; // reset for global flag

          // Check require_nearby constraint
          if (rule.require_nearby) {
            if (hasNearbyMatch(patch, i, rule.require_nearby, rule.nearby_range || 10)) {
              continue; // nearby match found → rule satisfied, skip
            }
            // No nearby match → violation
          }

          // Calculate actual line number in new file
          const lineNum = i + 1; // approximate; will be corrected by line mapping

          issues.push({
            file: file.filename,
            line: lineNum,
            severity,
            category,
            description: message,
            suggestion: rule.suggestion || '',
            source: `rule:${rule.name || 'custom'}`,
          });

          // Only report first N violations per file per rule (avoid spam)
          const maxPerFile = rule.max_per_file || 5;
          const fileRuleIssues = issues.filter(
            iss => iss.file === file.filename && iss.source === `rule:${rule.name || 'custom'}`
          );
          if (fileRuleIssues.length >= maxPerFile) break;
        }
      }

      // --- Metric rules ---
      if (rule.metric === 'function_lines' && rule.threshold) {
        const blocks = findFunctionBlocks(patch);
        for (const block of blocks) {
          if (block.lineCount > rule.threshold) {
            issues.push({
              file: file.filename,
              line: block.startLine + 1,
              severity,
              category,
              description: `${message} (${block.lineCount} lines > ${rule.threshold})`,
              suggestion: rule.suggestion || 'Consider breaking this into smaller functions.',
              source: `rule:${rule.name || 'custom'}`,
            });
          }
        }
      }
    }
  }

  return issues;
}

module.exports = { runRules, matchesPattern, globToRegex, hasNearbyMatch, findFunctionBlocks };
