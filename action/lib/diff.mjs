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

/**
 * Undo git's C-style path quoting.
 *
 * git quotes a path in `diff --git` headers when it contains characters it
 * considers unusual — verified against git itself: non-ASCII and embedded
 * quotes are quoted, plain spaces are not.
 *
 *   diff --git "a/src/caf\303\251.tsx" "b/src/caf\303\251.tsx"
 *   diff --git "a/src/quote\"name.tsx" "b/src/quote\"name.tsx"
 *
 * The octal escapes are *bytes* of the UTF-8 encoding, not code points, so they
 * have to be collected and decoded together — decoding `\303` and `\251`
 * separately produces "Ã©" rather than "é".
 *
 * Returns the input unchanged when it is not quoted.
 */
export function unquoteGitPath(token) {
  if (typeof token !== 'string' || !token.startsWith('"') || !token.endsWith('"')) {
    return token;
  }
  const body = token.slice(1, -1);
  const bytes = [];
  const SIMPLE = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') {
      // Already-decoded characters: push their UTF-8 bytes so the whole run
      // decodes as one string.
      for (const b of new TextEncoder().encode(body[i])) bytes.push(b);
      continue;
    }
    const next = body[++i];
    if (next === undefined) break;
    const octal = body.slice(i, i + 3);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 2;
    } else if (next in SIMPLE) {
      bytes.push(SIMPLE[next]);
    } else {
      for (const b of new TextEncoder().encode(next)) bytes.push(b);
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return body;
  }
}

/**
 * The post-image path from a `diff --git` header.
 *
 * The previous implementation was `raw.match(/ b\/(.+)$/)`, which returned
 * `unknown` for every quoted path — so a repository with one non-ASCII filename
 * silently dropped that file from routing, and the audit reported nothing about
 * it while looking like it had run.
 *
 * A bare header containing spaces (`a/My File.tsx b/My File.tsx`) is genuinely
 * ambiguous, because the separator and the filename use the same character.
 * `parseDiff` therefore treats this as a first guess and prefers the `+++ b/`
 * line, which carries one path per line and cannot be ambiguous.
 */
export function pathFromDiffHeader(raw) {
  const rest = raw.slice('diff --git '.length);

  // Quoted form: two quoted tokens, escaped quotes not ending the token.
  const quoted = rest.match(/^"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"\s*$/);
  if (quoted) {
    return stripPrefix(unquoteGitPath(`"${quoted[2]}"`));
  }
  // Mixed: only one side needed quoting (a rename into an unusual name).
  const mixedB = rest.match(/\s"((?:[^"\\]|\\.)*)"\s*$/);
  if (mixedB) return stripPrefix(unquoteGitPath(`"${mixedB[1]}"`));

  const bare = rest.match(/ b\/(.+)$/);
  return bare ? bare[1] : null;
}

function stripPrefix(p) {
  return p.replace(/^[ab]\//, '');
}

export function parseDiff(diffText) {
  /** @type {FileDiff[]} */
  const files = [];
  let current = null;
  let hunk = null;
  let position = 0; // GitHub counts position from the first @@ of each file
  let newLine = 0;
  // Set once per file: the `+++`/`---` lines are unambiguous, so the first one
  // seen overrides the header guess rather than being overridden by it.
  let pathSettled = false;

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('diff --git')) {
      if (current) files.push(current);
      current = {
        path: pathFromDiffHeader(raw) ?? 'unknown',
        status: 'modified',
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      hunk = null;
      position = 0;
      pathSettled = false;
      continue;
    }
    if (!current) continue;

    if (raw.startsWith('new file mode')) current.status = 'added';
    else if (raw.startsWith('deleted file mode')) current.status = 'deleted';
    else if (raw.startsWith('rename ')) current.status = 'renamed';

    /**
     * One path per line, so no separator ambiguity. `+++` is the post-image and
     * is what routing cares about; for a deletion it is `/dev/null`, and the
     * `---` line carries the name instead.
     */
    if (!hunk && !pathSettled && (raw.startsWith('+++ ') || raw.startsWith('--- '))) {
      const token = raw.slice(4).replace(/\t.*$/, '');
      if (token !== '/dev/null') {
        const resolved = stripPrefix(unquoteGitPath(token));
        if (resolved) {
          current.path = resolved;
          // `---` is only a fallback; keep looking for a `+++` that overrides it.
          if (raw.startsWith('+++ ')) pathSettled = true;
        }
      }
      continue;
    }

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
  let omittedFiles = 0;
  /** @type {string[]} paths dropped entirely, so the caller can name them */
  let omitted = [];
  /**
   * @type {string[]} paths shown only in part.
   *
   * Counted but never named, so the caller could report "2 files truncated"
   * and nothing else — and the coverage gate had no path list to work with, so
   * a change past the per-file limit went unreviewed while the run passed.
   */
  const truncated = [];

  for (const f of files) {
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
      truncated.push(f.path);
    }

    // Deletions are called out, because "what was removed and why" is a
    // different review question from "is this new code correct". The body for a
    // deleted file is entirely `-` lines, which is exactly what the agent needs
    // in order to notice that an auth check or a test just disappeared.
    const heading =
      f.status === 'deleted'
        ? `### ${f.path} (DELETED — all ${f.deletions} line(s) below were removed)`
        : `### ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`;
    const block = `${heading}\n\`\`\`diff\n${body}\`\`\`\n`;

    if (total + block.length > maxTotalChars) {
      /**
       * Everything from here on is dropped, and the caller must be told how
       * much.
       *
       * `omittedFiles` was declared above and never assigned or returned, so
       * this count existed only as a note inside the prompt — the model saw
       * "3 more files omitted", the run reported nothing, and the summary
       * showed a clean review of a pull request a third of which was never
       * looked at. That is the same false-green shape as a failed agent
       * reporting zero findings.
       */
      omittedFiles = files.length - out.length;
      omitted = files.slice(files.length - omittedFiles).map((f) => f.path);
      out.push(`\n… [${omittedFiles} more changed files omitted to stay within budget]\n`);
      break;
    }
    out.push(block);
    total += block.length;
  }

  return { text: out.join('\n'), truncatedFiles, truncated, omittedFiles, omitted, chars: total };
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

/**
 * Every path in the changeset, deletions included.
 *
 * Deletions used to be filtered out, on the reasoning that there is no new code
 * to comment on. But *removing* code is a change worth reviewing, and often the
 * most consequential one: deleting an auth guard, a permission check, a
 * certificate-pinning config, a test that covered a security path, or an
 * `expo-updates` safeguard all left the audit with nothing to say. A pull
 * request consisting only of deletions routed to no agents at all and passed.
 *
 * Inline comments cannot be placed on a removed line — `findPosition` returns
 * null for them — so findings on deletions flow to the summary through the
 * existing unplaceable path.
 */
export function changedFilePaths(files) {
  return files.map((f) => f.path);
}
