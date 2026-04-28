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

  // Custom review prompt additions
  custom_prompt: '',

  // Ignore rules (files/paths to always skip)
  ignore: [],
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
      // Simple YAML-like parsing (supports basic key: value and nested objects)
      const userConfig = parseSimpleYaml(content);
      return deepMerge(DEFAULT_CONFIG, userConfig);
    }
  } catch (e) {
    // Ignore config loading errors, use defaults
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Simple YAML parser for basic config files
 * Handles: key: value, nested objects, arrays, booleans, numbers
 */
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split('\n');
  let currentObj = result;
  let currentKey = '';

  for (let line of lines) {
    // Skip empty lines and comments
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // Count indentation
    const indent = content.split('\n').find(l => l.trim() === line)?.search(/\S/) || 0;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // Parse value
    if (value === '' || value === 'null') {
      value = null;
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (!isNaN(value) && value !== '') {
      value = Number(value);
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }

    // Handle arrays (simple: - item format)
    if (value === null) {
      currentObj[key] = {};
    } else {
      currentObj[key] = value;
    }
  }

  return result;
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
