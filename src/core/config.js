/**
 * Config loader - reads .review.yml from repo root
 * Platform-agnostic.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  review: {
    language: 'zh',
    max_diff_lines: 500,
    skip_if_no_diff: true,
    auto_approve: false,
    fail_on_critical: true,
    incremental: true,
  },
  model: { fallback: '' },
  filter: { skip_patterns: [], review_patterns: [], max_file_lines: 500 },
  severity: {
    block_threshold: 'critical',
    inline_threshold: 'warning',
  },
  language_rules: [],
  custom_prompt: '',
  ignore: [],
  webhooks: [],
  labels: { enabled: false, prefix: 'ai-review' },
  stats: { enabled: true },
};

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

    while (sectionStack.length > 1 && indent <= sectionStack[sectionStack.length - 1].indent) {
      sectionStack.pop();
      currentArrayKey = null;
    }

    const currentObj = sectionStack[sectionStack.length - 1].obj;

    if (line.startsWith('- ')) {
      const arrayItem = line.substring(2).trim();

      if (arrayItem.includes(':')) {
        const colonIdx = arrayItem.indexOf(':');
        const key = arrayItem.substring(0, colonIdx).trim();
        const val = parseValue(arrayItem.substring(colonIdx + 1).trim());

        if (currentArrayKey && Array.isArray(currentObj[currentArrayKey])) {
          const newObj = {};
          newObj[key] = val;
          // Check if next lines are part of this array item
          let j = i + 1;
          while (j < lines.length) {
            const nextLine = lines[j];
            const nextIndent = nextLine.search(/\S/);
            if (nextLine.trim() === '' || nextLine.trim().startsWith('#')) { j++; continue; }
            if (nextIndent > indent && !nextLine.trim().startsWith('- ')) {
              const nextTrimmed = nextLine.trim();
              const nextColonIdx = nextTrimmed.indexOf(':');
              if (nextColonIdx > 0) {
                newObj[nextTrimmed.substring(0, nextColonIdx).trim()] = parseValue(nextTrimmed.substring(nextColonIdx + 1).trim());
              }
              j++;
            } else {
              break;
            }
          }
          i = j - 1;
          currentObj[currentArrayKey].push(newObj);
        }
      } else {
        if (currentArrayKey && Array.isArray(currentObj[currentArrayKey])) {
          currentObj[currentArrayKey].push(parseValue(arrayItem));
        }
      }
    } else {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim();
        const val = line.substring(colonIdx + 1).trim();

        if (val === '' || val === '|' || val === '>') {
          // Nested object or multi-line string
          if (val === '|' || val === '>') {
            // Multi-line string
            let multiLine = '';
            let j = i + 1;
            while (j < lines.length) {
              const nextLine = lines[j];
              const nextIndent = nextLine.search(/\S/);
              if (nextLine.trim() === '') { multiLine += '\n'; j++; continue; }
              if (nextIndent > indent) {
                multiLine += (multiLine ? '\n' : '') + nextLine.trim();
                j++;
              } else {
                break;
              }
            }
            i = j - 1;
            currentObj[key] = multiLine.trim();
          } else {
            currentObj[key] = {};
            sectionStack.push({ obj: currentObj[key], indent });
          }
        } else {
          currentObj[key] = parseValue(val);
          currentArrayKey = key; // Might be followed by array items
        }
      }
    }
  }

  return result;
}

function parseValue(str) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'null' || str === '~') return null;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  // Remove quotes
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = { loadConfig, parseSimpleYaml, deepMerge, DEFAULT_CONFIG };
