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
const outArg = args.find((a) => a.startsWith('--out'));
const outDir = outArg
  ? path.resolve(outArg.includes('=') ? outArg.split('=')[1] : args[args.indexOf(outArg) + 1] ?? '')
  : null;
if (outArg && !outDir) throw new Error('--out needs a directory');

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
