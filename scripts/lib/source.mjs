/**
 * Reads the canonical agent sources from agents/ and shared/.
 * Zero dependencies — includes a minimal YAML-subset frontmatter parser so the
 * repo can be consumed with `npx` and no install step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AGENTS_DIR = path.join(ROOT, 'agents');
export const SHARED_DIR = path.join(ROOT, 'shared');
export const DIST_DIR = path.join(ROOT, 'dist');

/* ------------------------------------------------------------------ *
 * Minimal YAML frontmatter parser
 * Supports: scalars, quoted strings, booleans, numbers, block lists
 * (`- item`), and inline flow lists (`[a, b, c]`). That is the entire
 * surface used by agent frontmatter, and keeping it hand-rolled means
 * this package has no dependencies.
 * ------------------------------------------------------------------ */

function coerce(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => coerce(s));
  }
  return v;
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---')) {
    return { data: {}, body: text };
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: text };

  const rawFm = text.slice(3, end).replace(/^\r?\n/, '');
  // Drop the closing `---` line and any blank lines that follow it, so emitted
  // files don't accumulate stray leading whitespace.
  const body = text.slice(end + 4).replace(/^(\r?\n)+/, '');

  const data = {};
  let currentKey = null;

  for (const line of rawFm.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(coerce(listItem[1]));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      currentKey = key;
      data[key] = value.trim() === '' ? [] : coerce(value);
    }
  }

  return { data, body: body.trimEnd() };
}

export function serializeFrontmatter(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${quoteIfNeeded(item)}`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${quoteIfNeeded(value)}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

function quoteIfNeeded(v) {
  if (typeof v !== 'string') return String(v);
  // Quote when the value could otherwise be misread as YAML structure.
  if (/^[\s]|[\s]$|^[[{>|*&!%@`]|:\s|^-\s|^(true|false|null|~)$|^-?\d+(\.\d+)?$/.test(v)) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

const REQUIRED_FIELDS = ['id', 'name', 'description', 'version'];

export function loadSharedContext() {
  const file = path.join(SHARED_DIR, 'rn-context.md');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').trimEnd();
}

export function loadAgents() {
  if (!fs.existsSync(AGENTS_DIR)) {
    throw new Error(`No agents/ directory at ${AGENTS_DIR}`);
  }

  const dirs = fs
    .readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const agents = dirs.map((dir) => {
    const agentFile = path.join(AGENTS_DIR, dir, 'agent.md');
    if (!fs.existsSync(agentFile)) {
      throw new Error(`agents/${dir} has no agent.md`);
    }

    const { data, body } = parseFrontmatter(fs.readFileSync(agentFile, 'utf8'));

    for (const field of REQUIRED_FIELDS) {
      if (data[field] === undefined || data[field] === '') {
        throw new Error(`agents/${dir}/agent.md is missing required frontmatter: ${field}`);
      }
    }

    const refsDir = path.join(AGENTS_DIR, dir, 'references');
    const references = fs.existsSync(refsDir)
      ? fs
          .readdirSync(refsDir)
          .filter((f) => f.endsWith('.md'))
          .sort()
          .map((f) => ({
            slug: f.replace(/\.md$/, ''),
            file: `references/${f}`,
            path: path.join(refsDir, f),
            title: firstHeading(fs.readFileSync(path.join(refsDir, f), 'utf8')) || f,
            content: fs.readFileSync(path.join(refsDir, f), 'utf8').trimEnd(),
          }))
      : [];

    // Cross-check the declared reference list against what's on disk.
    const declared = Array.isArray(data.references) ? data.references : [];
    const actual = references.map((r) => r.slug);
    const missing = declared.filter((d) => !actual.includes(d));
    if (missing.length) {
      throw new Error(
        `agents/${dir}/agent.md declares references not present on disk: ${missing.join(', ')}`,
      );
    }

    return { dir, ...data, body, references };
  });

  const ids = agents.map((a) => a.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate agent ids: ${[...new Set(dupes)].join(', ')}`);

  return agents;
}

function firstHeading(md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/* ------------------------------------------------------------------ *
 * Composition helpers
 * ------------------------------------------------------------------ */

/** The agent body plus the shared RN context, as one self-contained prompt. */
export function composePrompt(agent, sharedContext, { includeReferenceIndex = true } = {}) {
  const parts = [agent.body];

  if (includeReferenceIndex && agent.references.length) {
    parts.push(
      [
        '## Reference library',
        '',
        'Deep-dive material for this agent. Load the relevant file when you reach that area',
        'rather than working from memory.',
        '',
        ...agent.references.map((r) => `- \`${r.file}\` — ${r.title}`),
      ].join('\n'),
    );
  }

  if (sharedContext) {
    parts.push(`---\n\n${sharedContext}`);
  }

  return parts.join('\n\n');
}

/** Everything inlined — used for single-file targets with no filesystem access. */
export function composeFullPrompt(agent, sharedContext) {
  const parts = [agent.body];
  if (sharedContext) parts.push(`---\n\n${sharedContext}`);
  for (const ref of agent.references) {
    parts.push(`---\n\n<!-- reference: ${ref.slug} -->\n\n${ref.content}`);
  }
  return parts.join('\n\n');
}

export function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents.endsWith('\n') ? contents : `${contents}\n`, 'utf8');
  return filePath;
}

export function copyReferences(agent, targetDir) {
  const written = [];
  for (const ref of agent.references) {
    written.push(writeFile(path.join(targetDir, 'references', `${ref.slug}.md`), ref.content));
  }
  return written;
}

export function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Every file under `dir`, as paths relative to it. */
export function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out;
}

/**
 * Remove files present in `dir` but absent from `keep`.
 *
 * Deliberately best-effort: some environments (network mounts, container
 * bind-mounts, read-only checkouts) refuse unlink. Returning the failures
 * lets the caller warn instead of aborting an otherwise successful build.
 */
export function pruneStale(dir, keep) {
  const keepSet = new Set([...keep].map((f) => path.relative(dir, f)));
  const removed = [];
  const failed = [];

  for (const rel of listFiles(dir)) {
    if (keepSet.has(rel)) continue;
    try {
      fs.rmSync(path.join(dir, rel), { force: true });
      removed.push(rel);
    } catch (err) {
      failed.push({ file: rel, code: err.code });
    }
  }

  // Tidy up directories left empty by the prune; also best-effort.
  const dirs = new Set();
  for (const rel of removed) dirs.add(path.dirname(rel));
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      const full = path.join(dir, d);
      if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } catch {
      /* best-effort */
    }
  }

  return { removed, failed };
}
