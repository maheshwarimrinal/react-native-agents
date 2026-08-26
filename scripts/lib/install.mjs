/**
 * Installation planning and conflict handling.
 *
 * The installer writes into somebody else's repository, so the default must be
 * to never destroy anything. Files like `AGENTS.md` and
 * `.github/copilot-instructions.md` very often already exist and contain the
 * user's own project instructions — silently replacing those is data loss.
 *
 * The model here is: build a full plan first, show it, then act. Nothing is
 * written until the whole plan is known, so a conflict discovered on file 40
 * cannot leave the project half-modified.
 */
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ action: 'create'|'identical'|'conflict', src: string, dest: string, rel: string }} PlanEntry */

/**
 * Files whose contents are commonly authored by the user rather than owned by
 * this tool. A conflict here is far more likely to be real, so we never
 * overwrite them even under --force without also taking a backup.
 */
export const USER_OWNED = [
  'AGENTS.md',
  '.github/copilot-instructions.md',
  'CLAUDE.md',
  '.cursorrules',
  '.windsurfrules',
];

export function isUserOwned(rel) {
  const norm = rel.split(path.sep).join('/');
  return USER_OWNED.some((u) => norm === u || norm.endsWith(`/${u}`));
}

/**
 * Walk the source tree and classify every file against the destination.
 *
 * @returns {PlanEntry[]}
 */
export function plan(srcRoot, destRoot, { filter } = {}) {
  /** @type {PlanEntry[]} */
  const entries = [];

  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(src);
        continue;
      }
      if (filter && !filter(src)) continue;

      const rel = path.relative(srcRoot, src);
      const dest = path.join(destRoot, rel);

      let action = 'create';
      if (fs.existsSync(dest)) {
        action = sameContent(src, dest) ? 'identical' : 'conflict';
      }
      entries.push({ action, src, dest, rel });
    }
  };

  walk(srcRoot);
  return entries.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * A backup path that does not already exist.
 *
 * `${dest}.bak` unconditionally was silent data loss on the second install:
 * run one, and the user's original AGENTS.md moves to AGENTS.md.bak; run it
 * again, and that same path is overwritten with the *generated* file from run
 * one. The thing the backup existed to protect is gone, and the user is told
 * "backed up" both times.
 *
 * Falls back to `.bak.2`, `.bak.3`, … so the first backup — the one that holds
 * the user's own work — is always the one that survives.
 *
 * A dry run calls this too: it reports what *would* happen, so it has to
 * predict the same name rather than naming a path that is already taken.
 */
export function freeBackupPath(dest, exists = fs.existsSync) {
  const first = `${dest}.bak`;
  if (!exists(first)) return first;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${dest}.bak.${n}`;
    if (!exists(candidate)) return candidate;
  }
  // A thousand backups of one file means something is very wrong; a timestamp
  // is still better than clobbering.
  return `${dest}.bak.${Date.now()}`;
}

function sameContent(a, b) {
  try {
    return fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  } catch {
    return false;
  }
}

/**
 * Apply a plan.
 *
 * @param {PlanEntry[]} entries
 * @param {object} opts
 * @param {'skip'|'overwrite'|'backup'} opts.onConflict  default 'skip'
 * @param {boolean} [opts.dryRun]
 * @returns {{ created:number, skipped:number, overwritten:number, backedUp:string[], identical:number }}
 */
export function apply(entries, { onConflict = 'skip', dryRun = false } = {}) {
  const result = { created: 0, skipped: 0, overwritten: 0, backedUp: [], identical: 0 };

  for (const e of entries) {
    if (e.action === 'identical') {
      result.identical += 1;
      continue;
    }

    if (e.action === 'conflict') {
      if (onConflict === 'skip') {
        result.skipped += 1;
        continue;
      }
      // User-authored files always get a backup, even under --force. Losing
      // someone's AGENTS.md because they passed a flag is still data loss.
      if (onConflict === 'backup' || isUserOwned(e.rel)) {
        const bak = freeBackupPath(e.dest);
        if (!dryRun) fs.copyFileSync(e.dest, bak);
        result.backedUp.push(path.relative(process.cwd(), bak));
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(e.dest), { recursive: true });
        fs.copyFileSync(e.src, e.dest);
      }
      result.overwritten += 1;
      continue;
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(e.dest), { recursive: true });
      fs.copyFileSync(e.src, e.dest);
    }
    result.created += 1;
  }

  return result;
}

/** A short unified-ish preview of what differs, for `--dry-run --verbose`. */
export function previewDiff(entry, maxLines = 12) {
  let existing;
  let incoming;
  try {
    existing = fs.readFileSync(entry.dest, 'utf8').split('\n');
    incoming = fs.readFileSync(entry.src, 'utf8').split('\n');
  } catch {
    return '(could not read files for comparison)';
  }

  const out = [];
  const max = Math.max(existing.length, incoming.length);
  for (let i = 0; i < max && out.length < maxLines; i++) {
    if (existing[i] !== incoming[i]) {
      if (existing[i] !== undefined) out.push(`- ${existing[i]}`);
      if (incoming[i] !== undefined) out.push(`+ ${incoming[i]}`);
    }
  }
  if (out.length >= maxLines) out.push('  …');
  return out.length ? out.join('\n') : '(files differ only in trailing whitespace)';
}

export function summarise(entries) {
  return {
    create: entries.filter((e) => e.action === 'create').length,
    conflict: entries.filter((e) => e.action === 'conflict'),
    identical: entries.filter((e) => e.action === 'identical').length,
    total: entries.length,
  };
}
