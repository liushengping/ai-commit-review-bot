/**
 * Parse GitHub PR diff into structured chunks for AI review.
 * Handles unified diff format from GitHub API.
 */

/**
 * Parse raw diff string into file-level changes
 * @param {string} rawDiff - Unified diff string from GitHub API
 * @returns {Array<{filename: string, status: string, additions: number, deletions: number, patch: string}>}
 */
function parseDiff(rawDiff) {
  if (!rawDiff || typeof rawDiff !== 'string') return [];

  const files = [];
  const fileChunks = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');

    // Extract filename from "a/path b/path"
    const headerLine = lines[0] || '';
    const match = headerLine.match(/a\/(.+?) b\/(.+)/);
    if (!match) continue;

    const filename = match[2];

    // Determine file status
    let status = 'modified';
    if (headerLine.includes('new file')) status = 'added';
    else if (headerLine.includes('deleted file')) status = 'deleted';
    else if (headerLine.includes('rename')) status = 'renamed';

    // Count additions and deletions
    let additions = 0;
    let deletions = 0;
    const patchLines = [];

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
        patchLines.push(line);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
        patchLines.push(line);
      } else if (line.startsWith('@@')) {
        patchLines.push(line);
      } else if (!line.startsWith('diff') && !line.startsWith('index') &&
                 !line.startsWith('---') && !line.startsWith('+++')) {
        patchLines.push(' ' + line);
      }
    }

    files.push({
      filename,
      status,
      additions,
      deletions,
      patch: patchLines.join('\n'),
    });
  }

  return files;
}

/**
 * Truncate diff to fit within token limit
 * @param {Array} files - Parsed file changes
 * @param {number} maxLines - Maximum total lines
 * @returns {Array} Truncated file changes
 */
function truncateDiff(files, maxLines = 500) {
  let totalLines = 0;
  const result = [];

  for (const file of files) {
    const lines = file.patch.split('\n');
    if (totalLines + lines.length > maxLines) {
      const remaining = maxLines - totalLines;
      if (remaining > 20) {
        // Include partial file if we have enough room for meaningful context
        result.push({
          ...file,
          patch: lines.slice(0, remaining).join('\n') + '\n... (truncated)',
        });
      }
      break;
    }
    result.push(file);
    totalLines += lines.length;
  }

  return result;
}

/**
 * Format parsed files into a readable diff summary for AI consumption
 */
function formatDiffForReview(files) {
  if (files.length === 0) return 'No code changes detected.';

  const parts = [];
  parts.push(`Total files changed: ${files.length}\n`);

  for (const file of files) {
    parts.push(`--- File: ${file.filename} (${file.status}) [+${file.additions} -${file.deletions}] ---`);
    parts.push(file.patch);
    parts.push('');
  }

  return parts.join('\n');
}

module.exports = { parseDiff, truncateDiff, formatDiffForReview };
