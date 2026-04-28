/**
 * Config loader - reads .review.yml from repo root
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  // Review settings
  review: {
    language: 'zh',              // zh | en
    max_diff_lines: 500,
    skip_if_no_diff: true,
    auto_approve: false,         // Auto-approve if no issues found
    fail_on_critical: true,      // Fail action if critical issues found
    incremental: true,           // Only review new changes since last review
  },

  // AI model settings
  model: {
    fallback: '',                // Fallback model if primary fails
  },

  // File filtering
  filter: {
    skip_patterns: [],           // Additional regex patterns to skip
    review_patterns: [],         // Only review files matching these (empty = all)
    max_file_lines: 500,
  },

  // Severity thresholds
  severity: {
    // Issues at or above this level will block the PR
    block_threshold: 'critical', // none | info | warning | error | critical
    // Issues at or above this level will be shown as inline comments
    inline_threshold: 'warning', // none | info | warning | error | critical
  },

  // Language/framework specific review rules
  language_rules: [],
  // Example:
  // language_rules:
  //   - pattern: "*.py"
  //     prompt: "重点关注类型提示、f-string 安全"
  //   - pattern: "*.go"
  //     prompt: "重点关注 goroutine 泄露、error 处理"

  // Custom review prompt additions
  custom_prompt: '',

  // Ignore rules (files/paths to always skip)
  ignore: [],

  // Webhook notifications
  webhooks: [],
  // Example:
  // webhooks:
  //   - type: dingtalk
  //     url: https://oapi.dingtalk.com/robot/send?access_token=xxx
  //   - type: wecom
  //     url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
  //   - type: slack
  //     url: https://hooks.slack.com/services/xxx
  //   - type: feishu
  //     url: https://open.feishu.cn/open-apis/bot/v2/hook/xxx
  //   - type: generic
  //     url: https://your-server.com/webhook
  //     secret: optional-hmac-secret

  // PR labeling
  labels: {
    enabled: false,              // Auto-label PRs based on review results
    prefix: 'ai-review',        // Label prefix
  },

  // Statistics tracking
  stats: {
    enabled: true,               // Track review statistics
  },
};

/**
 * Load config from .review.yml in the repo
 * @param {string} repoRoot - Path to the repo root
 * @returns {object} Merged config
 */
function loadConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.review.yml');

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const userConfig = parseSimpleYaml(content);
      return deepMerge(DEFAULT_CONFIG, userConfig);
    }
  } catch (e) {
    // Ignore config loading errors, use defaults
  }

  return deepMerge(DEFAULT_CONFIG, {});
}

/**
 * Simple YAML parser for basic config files
 * Handles: key: value, nested objects, arrays, booleans, numbers
 */
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split('\n');
  let sectionStack = [{ obj: result, indent: -1 }];
  let currentArrayKey = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue;

    const indent = rawLine.search(/\S/);
    const line = rawLine.trim();

    // Pop section stack for outdented lines
    while (sectionStack.length > 1 && indent <= sectionStack[sectionStack.length - 1].indent) {
      sectionStack.pop();
      currentArrayKey = null;
    }

    const currentObj = sectionStack[sectionStack.length - 1].obj;

    // Handle array items: "- value" or "- key: value"
    if (line.startsWith('- ')) {
      const arrayItem = line.substring(2).trim();

      // Check if this is a nested object in an array
      if (arrayItem.includes(':')) {
        const colonIdx = arrayItem.indexOf(':');
        const key = arrayItem.substring(0, colonIdx).trim();
        const val = parseValue(arrayItem.substring(colonIdx + 1).trim());

        // Find or create the array
        if (currentArrayKey && Array.isArray(currentObj[currentArrayKey])) {
          const newObj = {};
          newObj[key] = val;
          currentObj[currentObj[currentArrayKey].length > 0 ? currentArrayKey : currentArrayKey] = currentObj[currentArrayKey];
          currentObj[currentArrayKey].push(newObj);
        } else {
          // Inline object in array
          const arrKey = findLastArrayContext(sectionStack);
          if (arrKey && Array.isArray(currentObj[arrKey])) {
            const newObj = {};
            newObj[key] = val;
            currentObj[arrKey].push(newObj);
          }
        }
      } else {
        // Simple array item
        if (currentArrayKey && Array.isArray(currentObj[currentArrayKey])) {
          currentObj[currentArrayKey].push(parseValue(arrayItem));
        }
      }
      continue;
    }

    // Handle key: value
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    if (value === '' || value === 'null') {
      // This is a nested object or array — peek next lines
      const nextNonEmpty = findNextNonEmpty(lines, i + 1);
      if (nextNonEmpty && nextNonEmpty.trim().startsWith('- ')) {
        // It's an array
        currentObj[key] = [];
        currentArrayKey = key;
      } else {
        // It's a nested object
        currentObj[key] = {};
        sectionStack.push({ obj: currentObj[key], indent });
        currentArrayKey = null;
      }
    } else {
      currentObj[key] = parseValue(value);
      currentArrayKey = null;
    }
  }

  return result;
}

function findNextNonEmpty(lines, start) {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() !== '' && !lines[i].trim().startsWith('#')) return lines[i];
  }
  return null;
}

function findLastArrayContext(sectionStack) {
  // Walk backwards to find the most recent array key
  return null; // simplified
}

function parseValue(value) {
  if (value === '' || value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (!isNaN(value) && value !== '') return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

/**
 * Deep merge two objects
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else if (Array.isArray(source[key])) {
      result[key] = [...(target[key] || []), ...source[key]];
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

module.exports = { loadConfig, DEFAULT_CONFIG };
