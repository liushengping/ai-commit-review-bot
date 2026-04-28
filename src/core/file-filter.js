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

function shouldSkipFile(filename) {
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(filename)) {
      return { skip: true, reason: `matches skip pattern: ${pattern}` };
    }
  }
  return { skip: false };
}

function filterFiles(files) {
  const reviewable = [];
  const skipped = [];

  for (const file of files) {
    const check = shouldSkipFile(file.filename);
    if (check.skip) {
      skipped.push({ filename: file.filename, reason: check.reason });
      continue;
    }

    const lineCount = file.patch.split('\n').length;
    if (lineCount > MAX_FILE_LINES) {
      skipped.push({ filename: file.filename, reason: `too large (${lineCount} lines > ${MAX_FILE_LINES})` });
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

module.exports = { shouldSkipFile, filterFiles, SKIP_PATTERNS, MAX_FILE_LINES };
