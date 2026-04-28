/**
 * Smart file filtering - skip files that shouldn't be reviewed
 */

// Files to skip entirely
const SKIP_PATTERNS = [
  // Lock files
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Gemfile\.lock$/,
  /Cargo\.lock$/,
  /poetry\.lock$/,
  /composer\.lock$/,
  /go\.sum$/,
  /Pipfile\.lock$/,

  // Auto-generated code
  /\.generated\./,
  /\.auto\./,
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /\.chunk\.(js|css)$/,
  /\.d\.ts$/,           // TypeScript declaration files
  /\.pb\./,             // Protobuf generated
  /_grpc\.py$/,         // gRPC generated
  /__generated__/,      // GraphQL generated

  // Build output
  /dist\//,
  /build\//,
  /out\//,
  /\.next\//,
  /\.nuxt\//,
  /public\/static\//,

  // Dependencies
  /node_modules\//,
  /vendor\//,
  /third_party\//,
  /packages\/.*\/node_modules/,

  // Binary / media files
  /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|tiff)$/,
  /\.(mp3|mp4|wav|avi|mov|wmv|flv|webm)$/,
  /\.(woff|woff2|ttf|eot|otf)$/,
  /\.(zip|tar|gz|rar|7z|bz2)$/,
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/,
  /\.(exe|dll|so|dylib|o|a|lib)$/,

  // Config that rarely needs review
  /\.eslintrc/,
  /\.prettierrc/,
  /\.editorconfig$/,
  /\.gitignore$/,
  /\.npmrc$/,
  /\.nvmrc$/,
  /\.tool-versions$/,
];

// Max file size (lines) to review
const MAX_FILE_LINES = 500;

/**
 * Check if a file should be skipped
 * @param {string} filename
 * @returns {{ skip: boolean, reason?: string }}
 */
function shouldSkipFile(filename) {
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(filename)) {
      return { skip: true, reason: `matches skip pattern: ${pattern}` };
    }
  }
  return { skip: false };
}

/**
 * Filter files and return only reviewable ones
 * @param {Array} files - Parsed file changes
 * @returns {{ reviewable: Array, skipped: Array }}
 */
function filterFiles(files) {
  const reviewable = [];
  const skipped = [];

  for (const file of files) {
    const check = shouldSkipFile(file.filename);
    if (check.skip) {
      skipped.push({ filename: file.filename, reason: check.reason });
      continue;
    }

    // Check line count
    const lineCount = file.patch.split('\n').length;
    if (lineCount > MAX_FILE_LINES) {
      skipped.push({ filename: file.filename, reason: `too large (${lineCount} lines > ${MAX_FILE_LINES})` });
      continue;
    }

    // Skip files with only deletions (no code to review)
    if (file.additions === 0 && file.deletions > 0) {
      skipped.push({ filename: file.filename, reason: 'deletion only' });
      continue;
    }

    // Skip renamed files with no content changes
    if (file.status === 'renamed' && file.additions === 0 && file.deletions === 0) {
      skipped.push({ filename: file.filename, reason: 'rename only, no changes' });
      continue;
    }

    reviewable.push(file);
  }

  return { reviewable, skipped };
}

module.exports = { shouldSkipFile, filterFiles, SKIP_PATTERNS, MAX_FILE_LINES };
