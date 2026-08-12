/**
 * Unified-diff parsing.
 *
 * We need more than "what changed" — to post an *inline* review comment,
 * GitHub requires the position of a line within the diff hunk, so we track
 * the mapping from file + new-file line number back to diff position.
 */

/**
 * @typedef {{ path: string, status: string, hunks: Hunk[], additions: number, deletions: number }} FileDiff
 * @typedef {{ header: string, oldStart: number, newStart: number, lines: DiffLine[] }} Hunk
 * @typedef {{ type: '+'|'-'|' ', text: string, newLine: number|null, position: number }} DiffLine
 */

export function parseDiff(diffText) {
  /** @type {FileDiff[]} */
  const files = [];
  let current = null;
  let hunk = null;
  let position = 0; // GitHub counts position from the first @@ of each file
  let newLine = 0;

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('diff --git')) {
      if (current) files.push(current);
      const m = raw.match(/ b\/(.+)$/);
      current = { path: m ? m[1] : 'unknown', status: 'modified', hunks: [], additions: 0, deletions: 0 };
      hunk = null;
      position = 0;
      continue;
    }
    if (!current) continue;

    if (raw.startsWith('new file mode')) current.status = 'added';
    else if (raw.startsWith('deleted file mode')) current.status = 'deleted';
    else if (raw.startsWith('rename ')) current.status = 'renamed';

    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      newLine = m ? Number(m[2]) : 1;
      hunk = { header: raw, oldStart: m ? Number(m[1]) : 1, newStart: newLine, lines: [] };
      current.hunks.push(hunk);
      position += 1;
      continue;
    }

    if (!hunk) continue;
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"

    const type = raw[0] === '+' ? '+' : raw[0] === '-' ? '-' : ' ';
    position += 1;

    if (type === '+') {
      hunk.lines.push({ type, text: raw.slice(1), newLine, position });
      current.additions += 1;
      newLine += 1;
    } else if (type === '-') {
      hunk.lines.push({ type, text: raw.slice(1), newLine: null, position });
      current.deletions += 1;
    } else {
      hunk.lines.push({ type, text: raw.slice(1), newLine, position });
      newLine += 1;
    }
  }

  if (current) files.push(current);
  return files;
}

/**
 * Render a diff for the model, annotated with real line numbers.
 *
 * Without line numbers the model guesses at `file:line`, and wrong locations
 * make every finding untrustworthy. Prefixing each line with its actual number
 * in the new file is the cheapest way to keep citations honest.
 */
export function renderForPrompt(files, { maxCharsPerFile = 24000, maxTotalChars = 120000 } = {}) {
  const out = [];
  let total = 0;
  let truncatedFiles = 0;

  for (const f of files) {
    if (f.status === 'deleted') {
      out.push(`### ${f.path} (deleted)\n`);
      continue;
    }

    let body = '';
    for (const h of f.hunks) {
      body += `${h.header}\n`;
      for (const l of h.lines) {
        const n = l.newLine === null ? '    -' : String(l.newLine).padStart(5);
        body += `${n} ${l.type}${l.text}\n`;
      }
    }

    if (body.length > maxCharsPerFile) {
      body = `${body.slice(0, maxCharsPerFile)}\n… [file truncated: ${body.length - maxCharsPerFile} more chars]\n`;
      truncatedFiles += 1;
    }

    const block = `### ${f.path} (${f.status}, +${f.additions}/-${f.deletions})\n\`\`\`diff\n${body}\`\`\`\n`;

    if (total + block.length > maxTotalChars) {
      out.push(`\n… [${files.length - out.length} more changed files omitted to stay within budget]\n`);
      break;
    }
    out.push(block);
    total += block.length;
  }

  return { text: out.join('\n'), truncatedFiles, chars: total };
}

/**
 * Map `file:line` back to a GitHub diff position, so a finding can be posted
 * as an inline comment. Returns null when the line isn't part of the diff —
 * the caller should fall back to the summary comment rather than guessing.
 */
export function findPosition(files, filePath, line) {
  const f = files.find((x) => x.path === filePath);
  if (!f) return null;
  for (const h of f.hunks) {
    for (const l of h.lines) {
      if (l.newLine === line && l.type !== '-') return l.position;
    }
  }
  return null;
}

/** Nearest changed line to `line` within the same file — used to snap a finding onto the diff. */
export function nearestChangedLine(files, filePath, line, within = 8) {
  const f = files.find((x) => x.path === filePath);
  if (!f) return null;
  let best = null;
  for (const h of f.hunks) {
    for (const l of h.lines) {
      if (l.type !== '+' || l.newLine === null) continue;
      const d = Math.abs(l.newLine - line);
      if (d <= within && (best === null || d < best.d)) best = { d, line: l.newLine, position: l.position };
    }
  }
  return best;
}

export function changedFilePaths(files) {
  return files.filter((f) => f.status !== 'deleted').map((f) => f.path);
}
