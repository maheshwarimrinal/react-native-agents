#!/usr/bin/env node
/**
 * rn-agents size — deterministic bundle analysis.
 *
 * No API key, no model call, no cost. Bundle composition is arithmetic.
 *
 *   npx rn-agents size                        analyse the current bundle
 *   npx rn-agents size --base main            compare against a base branch
 *   npx rn-agents size --budget-delta 100kb   fail if the PR grows it too much
 *   npx rn-agents size --json                 machine-readable, for trending
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  attribute,
  budgetVerdict,
  buildBundle,
  compare,
  fmtBytes,
  renderComparison,
  renderReport,
} from './lib/size.mjs';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const [k, v] = argv[i].slice(2).split('=');
    out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return out;
}

/**
 * Accepts "100kb", "1.5mb", "204800". Returns null only when nothing was
 * supplied; anything unparseable throws.
 *
 * Silently returning null for a malformed value disables the budget check while
 * the run still reports success — the exact failure mode a budget exists to
 * prevent. A typo must be loud.
 */
export function parseSize(v, flag = 'budget') {
  if (v === undefined || v === null || v === true || v === '') return null;
  // Anchored so "1.2.3mb" is rejected rather than coerced to NaN.
  const m = String(v).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!m) {
    throw new Error(
      `Invalid --${flag} value: "${v}". Use a number with an optional unit, e.g. 250kb, 1.5mb, 204800.`,
    );
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid --${flag} value: "${v}".`);
  return Math.round(n * ({ b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 ** 3 }[m[2] ?? 'b'] ?? 1));
}

/** Percentage budgets have the same silent-disable hazard via NaN. */
export function parsePercent(v) {
  if (v === undefined || v === null || v === true || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid --budget-percent value: "${v}". Use a non-negative number, e.g. 5 or 0.`);
  }
  return n;
}

/** Which package manager the project actually uses. */
export function detectPackageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return { name: 'pnpm', install: ['pnpm', ['install', '--frozen-lockfile']] };
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return { name: 'yarn', install: ['yarn', ['install', '--frozen-lockfile']] };
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) {
    return { name: 'bun', install: ['bun', ['install', '--frozen-lockfile']] };
  }
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return { name: 'npm', install: ['npm', ['ci', '--silent', '--no-audit', '--no-fund']] };
  return null;
}

function setOutput(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (f) fs.appendFileSync(f, `${name}=${String(value).replace(/\n/g, '%0A')}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = path.resolve(args.cwd ?? process.env.GITHUB_WORKSPACE ?? process.cwd());
  const platform = args.platform ?? 'android';
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-size-'));

  if (!fs.existsSync(path.join(cwd, 'package.json'))) {
    fail(`No package.json in ${cwd}. Point at a React Native project with --cwd.`);
  }

  // Validate budgets before building anything — discovering a typo after a
  // three-minute bundle build is a waste, and silently ignoring it is worse.
  try {
    parseSize(args['budget-total'], 'budget-total');
    parseSize(args['budget-delta'], 'budget-delta');
    parsePercent(args['budget-percent']);
  } catch (err) {
    fail(err.message);
  }

  console.log(c.bold('\n  Bundle analysis\n'));
  console.log(c.dim(`  ${cwd}  ·  ${platform}`));
  console.log(c.dim('  Building production bundle… (no model call, no cost)\n'));

  let head;
  try {
    const built = buildBundle({ cwd, platform, outDir });
    head = attribute(built.bundlePath, built.mapPath);
  } catch (err) {
    fail(
      `Bundle build failed.\n\n${String(err.stderr ?? err.message).slice(0, 1500)}\n\n` +
        'This is a build problem rather than a sizing one — the rn-doctor agent handles those.',
    );
  }

  // ---- Single-bundle report -------------------------------------------
  if (!args.base) {
    const report = renderReport(head);
    console.log(report.replace(/\|/g, ' ').replace(/^#+ /gm, '  '));

    if (args.json) {
      const out = {
        totalBytes: head.totalBytes,
        byPackage: Object.fromEntries(head.byPackage),
      };
      fs.writeFileSync(args.json === true ? 'bundle-size.json' : args.json, JSON.stringify(out, null, 2));
      console.log(c.dim(`\n  Wrote ${args.json === true ? 'bundle-size.json' : args.json}`));
    }

    setOutput('total-bytes', head.totalBytes);
    setOutput('report', report);
    appendSummary(report);

    const max = parseSize(args['budget-total'], 'budget-total');
    if (max !== null && head.totalBytes > max) {
      console.log(c.red(`\n  ✗ ${fmtBytes(head.totalBytes)} exceeds budget ${fmtBytes(max)}\n`));
      process.exit(1);
    }
    console.log(c.green(`\n  ✓ ${fmtBytes(head.totalBytes)}\n`));
    return;
  }

  // ---- Comparison against a base ---------------------------------------
  const base = String(args.base);
  console.log(c.dim(`  Comparing against ${base}…\n`));

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-size-base-'));
  let baseAnalysis;
  try {
    // A detached worktree keeps the developer's checkout untouched — never
    // stash or check out branches in someone's working directory.
    execFileSync('git', ['worktree', 'add', '--detach', worktree, base], { cwd, stdio: 'pipe' });

    const pm = detectPackageManager(worktree);
    if (!pm) {
      throw new Error(
        'No recognised lockfile in the base checkout (looked for package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb).',
      );
    }
    console.log(c.dim(`  Installing base dependencies with ${pm.name}…`));
    execFileSync(pm.install[0], pm.install[1], { cwd: worktree, stdio: 'pipe' });

    const builtBase = buildBundle({ cwd: worktree, platform, outDir: path.join(outDir, 'base') });
    baseAnalysis = attribute(builtBase.bundlePath, builtBase.mapPath);
  } catch (err) {
    // Falling back to a single-bundle report here would skip the comparison AND
    // any budget check while still exiting 0 — a budget that silently stops
    // being enforced is worse than no budget at all.
    console.error(c.red(`\n  ✗ Could not build the base bundle for "${base}".`));
    console.error(c.dim(`    ${String(err.stderr ?? err.message).slice(0, 600)}`));
    console.error(
      c.dim(
        '\n    The comparison and any budget checks were NOT evaluated.\n' +
          '    Fix the base build, or drop --base to get a single-bundle report.\n',
      ),
    );
    process.exit(2); // distinct from 1 (budget exceeded) so CI can tell them apart
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd, stdio: 'pipe' });
    } catch {
      /* best effort */
    }
  }

  const cmp = compare(baseAnalysis, head);
  const verdict = budgetVerdict(cmp, {
    maxTotalBytes: parseSize(args['budget-total'], 'budget-total'),
    maxDeltaBytes: parseSize(args['budget-delta'], 'budget-delta'),
    maxPercent: parsePercent(args['budget-percent']),
  });

  const md = renderComparison(cmp, verdict);
  console.log(md.replace(/\|/g, ' ').replace(/^#+ /gm, '  '));

  setOutput('total-bytes', cmp.totalAfter);
  setOutput('delta-bytes', cmp.totalDelta);
  setOutput('percent', cmp.percent.toFixed(2));
  setOutput('report', md);
  appendSummary(md);

  if (args.json) {
    const f = args.json === true ? 'bundle-size.json' : args.json;
    fs.writeFileSync(f, JSON.stringify({ ...cmp, rows: cmp.rows }, null, 2));
    console.log(c.dim(`\n  Wrote ${f}`));
  }

  if (!verdict.pass) {
    console.log(c.red(`\n  ✗ ${verdict.failures.join('; ')}\n`));
    process.exit(1);
  }
  console.log(c.green(`\n  ✓ ${fmtBytes(cmp.totalAfter)} (${cmp.totalDelta >= 0 ? '+' : ''}${fmtBytes(cmp.totalDelta)})\n`));
}

function appendSummary(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, `${md}\n`);
}

function fail(msg) {
  console.error(c.red(`\n  ✗ ${msg}\n`));
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(c.red(`\n  ✗ ${err.message}\n`));
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
}
