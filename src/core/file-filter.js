/**
 * Smart file filtering - skip files that shouldn't be reviewed
 * Platform-agnostic.
 */

const SKIP_PATTERNS = [
  /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/,
  /Gemfile\.lock$/, /Cargo\.lock$/, /poetry\.lock$/,
  /composer\.lock$/, /go\.sum$/, /Pipfile\.lock$/,
  /\.generated\./, /\.auto\./, /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/, /\.chunk\.(js|css)$/,
  /\.d\.ts$/, /\.pb\./, /_grpc\.py$/, /__generated__/,
  /dist\//, /build\//, /out\//, /\.next\//, /\.nuxt\//, /public\/static\//,
  /node_modules\//, /vendor\//, /third_party\//, /packages\/.*\/node_modules/,
  /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|tiff)$/,
  /\.(mp3|mp4|wav|avi|mov|wmv|flv|webm)$/,
  /\.(woff|woff2|ttf|eot|otf)$/,
  /\.(zip|tar|gz|rar|7z|bz2)$/,
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/,
  /\.(exe|dll|so|dylib|o|a|lib)$/,
  /\.eslintrc/, /\.prettierrc/, /\.editorconfig$/,
  /\.gitignore$/, /\.npmrc$/, /\.nvmrc$/, /\.tool-versions$/,
];

const MAX_FILE_LINES = 500;

/**
 * Convert a glob-like pattern to a RegExp.
 * Supports `*` and `**` wildcards.
 */
function globToRegex(pattern) {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars
    .replace(/\*\*/g, '{{GLOBSTAR}}')       // protect **
    .replace(/\*/g, '[^/]*')                // * matches anything except /
    .replace(/\?/g, '[^/]')                 // ? matches single char
    .replace(/{{GLOBSTAR}}/g, '.*');         // ** matches everything

  return new RegExp(re);
}

/**
 * Check if a filename matches any ignore pattern (glob or regex).
 */
function matchesIgnorePattern(filename, ignorePatterns) {
  if (!ignorePatterns || ignorePatterns.length === 0) return false;

  for (const pattern of ignorePatterns) {
    if (typeof pattern === 'string') {
      // Directory prefix patterns (ending with /) only match at the start
      if (pattern.endsWith('/')) {
        if (filename.startsWith(pattern)) return true;
        // Also match if filename is exactly the directory name without trailing /
        if (filename === pattern.slice(0, -1)) return true;
        continue;
      }
      // Treat as glob pattern
      const regex = globToRegex(pattern);
      if (regex.test(filename)) return true;
    } else if (pattern instanceof RegExp) {
      if (pattern.test(filename)) return true;
    }
  }
  return false;
}

function shouldSkipFile(filename, ignorePatterns) {
  // Check user-defined ignore patterns first
  if (matchesIgnorePattern(filename, ignorePatterns)) {
    return { skip: true, reason: 'matches ignore pattern' };
  }

  // Check built-in skip patterns
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(filename)) {
      return { skip: true, reason: `matches skip pattern: ${pattern}` };
    }
  }
  return { skip: false };
}

/**
 * Check if a diff chunk looks like a binary file diff.
 */
function isBinaryDiff(patch) {
  if (!patch) return false;
  // Git marks binary files with "Binary files ... differ" or "GIT binary patch"
  return /^Binary files .+ differ$/m.test(patch) || /^GIT binary patch$/m.test(patch);
}

function filterFiles(files, config = {}) {
  const reviewable = [];
  const skipped = [];
  const ignorePatterns = config.ignore || [];
  const maxFileLines = config.filter?.max_file_lines || MAX_FILE_LINES;

  for (const file of files) {
    // Check if it's a binary file diff
    if (isBinaryDiff(file.patch)) {
      skipped.push({ filename: file.filename, reason: 'binary file' });
      continue;
    }

    const check = shouldSkipFile(file.filename, ignorePatterns);
    if (check.skip) {
      skipped.push({ filename: file.filename, reason: check.reason });
      continue;
    }

    const lineCount = file.patch.split('\n').length;
    if (lineCount > maxFileLines) {
      skipped.push({ filename: file.filename, reason: `too large (${lineCount} lines > ${maxFileLines})` });
      continue;
    }

    if (file.additions === 0 && file.deletions > 0) {
      skipped.push({ filename: file.filename, reason: 'deletion only' });
      continue;
    }

    if (file.status === 'renamed' && file.additions === 0 && file.deletions === 0) {
      skipped.push({ filename: file.filename, reason: 'rename only, no changes' });
      continue;
    }

    reviewable.push(file);
  }

  return { reviewable, skipped };
}

module.exports = { shouldSkipFile, filterFiles, matchesIgnorePattern, isBinaryDiff, SKIP_PATTERNS, MAX_FILE_LINES };
