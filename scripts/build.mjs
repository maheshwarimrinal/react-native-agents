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
import { DIST_DIR, loadAgents, loadSharedContext, pruneStale, rmDir } from './lib/source.mjs';
import { TARGETS } from './lib/targets.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
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

  // Write first, then prune what's no longer generated. Safer than deleting
  // dist/ up front: a mid-build failure leaves the previous output intact, and
  // it works on filesystems that refuse recursive removal.
  const { agents, results } = build(DIST_DIR);

  const written = results.flatMap((r) => r.files);
  const warnings = results.flatMap((r) => r.warnings);
  const { removed, failed } = pruneStale(DIST_DIR, written);
  const total = written.length;

  if (failed.length) {
    warnings.push(
      `could not remove ${failed.length} stale file(s) (${failed[0].code}) — e.g. ${failed[0].file}`,
    );
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
    c.dim(`\n  ${total} files written to dist/${removed.length ? `, ${removed.length} stale removed` : ''}\n`),
  );
} catch (err) {
  console.error(c.red(`\n✗ Build failed: ${err.message}\n`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
}
