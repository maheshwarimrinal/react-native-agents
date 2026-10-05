#!/usr/bin/env node
/**
 * Generates every tool-specific distribution from agents/ + shared/.
 *
 *   node scripts/build.mjs              build everything into dist/
 *   node scripts/build.mjs --check      verify dist/ is in sync (CI gate)
 *   node scripts/build.mjs --only cursor,windsurf
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DIST_DIR, VERSION, loadAgents, loadSharedContext, pruneStale, rmDir } from './lib/source.mjs';
import { TARGETS } from './lib/targets.mjs';
import { BUILD_MARKER } from './lib/build-constants.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/**
 * Keep the version in TELEMETRY.md's example payload in step with package.json.
 *
 * A test asserts these match, because that page documents every field this
 * package can transmit and a stale example reads as a document nobody
 * maintains. But nothing *updated* it, so the assertion turned every release
 * into: bump, watch the gate fail, hand-edit a doc, re-tag. It blocked the
 * 1.3.1 release it was written to protect.
 *
 * Generating it here means the `version` npm hook fixes it before the release
 * commit is made, and the test goes back to being a guard rather than a chore.
 *
 * @returns {boolean} whether the file needed changing
 */
function syncTelemetryVersion({ dryRun = false } = {}) {
  const file = path.join(ROOT, 'TELEMETRY.md');
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(
    /(\|\s*`version`\s*\|\s*`)[^`]+(`)/,
    `$1${VERSION}$2`,
  );
  if (after === before) return false;
  if (!dryRun) fs.writeFileSync(file, after);
  return true;
}

const args = process.argv.slice(2);
const check = args.includes('--check');
/**
 * `--out <dir>` writes the build somewhere other than `dist/`.
 *
 * It exists for the test suite. Before it, `scripts/test.mjs` built straight
 * into the real `dist/` so it would have something to assert against — which
 * meant running the tests rewrote the working tree, and made the `--check`
 * gate two hundred lines later structurally incapable of failing: it compared
 * a fresh build against a `dist/` that the same process had just regenerated.
 * The same shape as a test whose assertions never run.
 */
// Shared with scripts/test.mjs via a side-effect-free module: this file runs a
// build on import, so it cannot be the one that exports the constant.

/**
 * Deliberately NOT exported. This file runs a build at import time, so an
 * export invites a test to import it and trigger one as a side effect — the
 * same trap that made `refresh-api-snapshot.mjs` fire a network refresh on
 * import. The `--out` tests drive the real CLI through execFileSync instead,
 * which is what users actually hit.
 */
function parseOutDir(argv) {
  // Exact flag only. `startsWith('--out')` also matched `--outDir` and
  // `--output`, quietly treating the next token as the destination — so a typo
  // aimed the build, and the prune that follows it, somewhere the user never
  // named.
  const outArg = argv.find((a) => a === '--out' || a.startsWith('--out='));
  if (!outArg) return null;

  const value = outArg.startsWith('--out=')
    ? outArg.slice('--out='.length)
    : argv[argv.indexOf(outArg) + 1];

  // `path.resolve('')` is the current working directory, and a directory path
  // is always truthy — so validating AFTER resolving cannot catch a missing
  // value. A bare `node scripts/build.mjs --out` therefore aimed the build at
  // the repo root, where pruneStale() deletes every file it did not generate.
  // The check has to happen on the raw argument, before resolve() erases the
  // difference between "no value" and "here".
  if (!value || value.startsWith('-')) {
    throw new Error('--out needs a directory (e.g. --out tmp/build)');
  }
  const dir = path.resolve(value);

  // Defence in depth, because the failure mode is unrecoverable data loss and
  // one bad argument should not be able to cause it. A build may only write
  // into somewhere absent, empty, or marked as a previous build of this repo.
  // `--out .`, `--out ~` and `--out ../some-other-project` all refuse.
  if (fs.existsSync(dir)) {
    /**
     * lstat, not stat: a symlink to a directory passes `isDirectory()` and
     * `readdirSync` reads through it, so every check in this function applies to
     * the target while the user only named the link. Verified — with a marker
     * inside the target, `--out link` pruned a file in the real directory.
     *
     * The safety rule itself survives the indirection, so this is not a bypass.
     * It is refused anyway because on a destructive path the directory the user
     * typed should be the directory that is affected, and a marker is much
     * easier to acquire accidentally through a symlink into a shared or cached
     * tree than by typing the real path.
     */
    if (fs.lstatSync(dir).isSymbolicLink()) {
      throw new Error(
        `refusing to build into ${value}: it is a symlink. Pass the real directory, so the ` +
          `path pruned is the path you named.`,
      );
    }
    if (!fs.statSync(dir).isDirectory()) throw new Error(`--out ${value} is not a directory`);
    const entries = fs.readdirSync(dir);
    if (entries.length && !entries.includes(BUILD_MARKER)) {
      throw new Error(
        `refusing to build into ${dir}: not empty and not a previous build of this repo ` +
          `(no ${BUILD_MARKER}). Its contents would be pruned. Pass an empty or new directory.`,
      );
    }
  }
  return dir;
}

const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function build(distDir) {
  const shared = loadSharedContext();
  const agents = loadAgents();

  const names = only ?? Object.keys(TARGETS);
  const unknown = names.filter((n) => !TARGETS[n]);
  if (unknown.length) {
    throw new Error(`Unknown target(s): ${unknown.join(', ')}. Known: ${Object.keys(TARGETS).join(', ')}`);
  }

  const results = [];
  for (const name of names) {
    results.push(TARGETS[name]({ agents, shared, distDir }));
  }
  return { agents, results };
}

function snapshot(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(path.relative(dir, full), fs.readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

try {
  // Parsed inside the try so a bad `--out` produces the build's own error
  // message rather than an unhandled stack trace.
  const outDir = parseOutDir(args);

  if (check) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-agents-'));
    build(tmp);
    const fresh = snapshot(tmp);
    const committed = snapshot(DIST_DIR);
    rmDir(tmp);

    const problems = [];
    // --check must not write, but it must still notice.
    if (syncTelemetryVersion({ dryRun: true })) {
      problems.push(`stale:    TELEMETRY.md version row (run \`npm run build\`)`);
    }
    for (const [file, content] of fresh) {
      if (!committed.has(file)) problems.push(`missing:  ${file}`);
      else if (committed.get(file) !== content) problems.push(`stale:    ${file}`);
    }
    for (const file of committed.keys()) {
      if (!fresh.has(file)) problems.push(`orphaned: ${file}`);
    }

    if (problems.length) {
      console.error(c.red(`\n✗ dist/ is out of sync with agents/ (${problems.length} file(s))\n`));
      for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
      if (problems.length > 30) console.error(c.dim(`  …and ${problems.length - 30} more`));
      console.error(c.yellow('\n  Run `npm run build` and commit the result.\n'));
      process.exit(1);
    }
    console.log(c.green(`✓ dist/ is in sync (${fresh.size} files)`));
    process.exit(0);
  }

  const target = outDir ?? DIST_DIR;

  // Write first, then prune what's no longer generated. Safer than deleting
  // dist/ up front: a mid-build failure leaves the previous output intact, and
  // it works on filesystems that refuse recursive removal.
  const { agents, results } = build(target);

  const written = results.flatMap((r) => r.files);
  const warnings = results.flatMap((r) => r.warnings);
  const { removed, failed } = pruneStale(target, written);
  const total = written.length;

  if (failed.length) {
    warnings.push(
      `could not remove ${failed.length} stale file(s) (${failed[0].code}) — e.g. ${failed[0].file}`,
    );
  }

  // Written after the prune, which would otherwise delete it as a file the
  // build did not generate. Lets a repeat `--out` into the same directory be
  // recognised instead of refused.
  if (outDir) fs.writeFileSync(path.join(outDir, BUILD_MARKER), `${VERSION}\n`);

  // TELEMETRY.md lives in the repo, not in the build output. A build aimed
  // somewhere else must not touch it, or `--out` stops being side-effect free
  // and the problem it was added to solve comes back through a side door.
  if (!outDir && syncTelemetryVersion()) {
    warnings.push(`TELEMETRY.md version row updated to ${VERSION}`);
  }

  console.log(c.bold('\n  React Native Agents — build\n'));
  console.log(`  ${agents.length} agents, ${agents.reduce((n, a) => n + a.references.length, 0)} reference files\n`);
  for (const r of results) {
    console.log(`  ${c.green('✓')} ${r.name.padEnd(14)} ${c.dim(`${r.files.length} files`)}`);
  }

  if (warnings.length) {
    console.log(c.yellow(`\n  ${warnings.length} warning(s):`));
    for (const w of warnings) console.log(c.yellow(`    ! ${w}`));
  }

  console.log(
    c.dim(
      `\n  ${total} files written to ${outDir ? target : 'dist/'}${removed.length ? `, ${removed.length} stale removed` : ''}\n`,
    ),
  );
} catch (err) {
  console.error(c.red(`\n✗ Build failed: ${err.message}\n`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
}
