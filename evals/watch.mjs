/**
 * Progress viewer for a long eval run.
 *
 * Reads `results.json`, which the runner rewrites after every case, so this can
 * be run from a second terminal without touching the run itself.
 *
 *   node evals/watch.mjs            once
 *   node evals/watch.mjs --follow   refresh until the run finishes
 *
 * `--follow` is built in because macOS has no `watch(1)` and asking someone to
 * install one to see a progress bar is a poor trade.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results.json');
/**
 * Count case.json files, not directories. Counting directories reported 55
 * because twelve empty ones exist from an old `mkdir -p` brace-expansion
 * accident — a progress bar that can never reach 100% is worse than none.
 */
const TOTAL = fs
  .readdirSync(HERE, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    fs
      .readdirSync(path.join(HERE, d.name))
      .filter((c) => fs.existsSync(path.join(HERE, d.name, c, 'case.json'))),
  ).length;

const follow = process.argv.includes('--follow');
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function render() {
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  } catch {
    return { done: false, text: dim('  no results yet — the first case is still running.\n  Ollama loads several GB before it can answer, so a few minutes here is normal.') };
  }

  const pass = rows.filter((r) => r.pass).length;
  const clean = rows.filter((r) => r.clean);
  const cleanFail = clean.filter((r) => !r.pass);
  const viol = rows.filter((r) => r.violations?.length);
  const errored = rows.filter((r) => r.error);

  const pct = Math.round((rows.length / TOTAL) * 30);
  const bar = '█'.repeat(pct).padEnd(30, '·');

  const out = [
    `  ${bar}  ${rows.length}/${TOTAL}`,
    '',
    `  passing      ${pass}/${rows.length}`,
    `  clean cases  ${clean.length - cleanFail.length}/${clean.length}` +
      (cleanFail.length ? red('   ← model invented findings in correct code') : ''),
  ];

  if (viol.length) {
    out.push('', red(`  ${viol.length} forbidden-advice violation(s) — act on these:`));
    for (const v of viol) out.push(red(`    ${v.id}`) + dim(`  ${v.violations.join(', ')}`));
  }
  if (cleanFail.length) {
    out.push('', red('  clean-case failures — act on these:'));
    for (const v of cleanFail) out.push(red(`    ${v.id}`));
  }
  if (errored.length) {
    out.push('', yellow(`  ${errored.length} error(s):`));
    for (const e of errored.slice(0, 5)) out.push(dim(`    ${e.id} — ${e.error}`));
  }

  out.push('', dim(`  last: ${rows.at(-1)?.id ?? '—'}`));

  const done = rows.length >= TOTAL;
  if (done) {
    out.push(
      '',
      viol.length || cleanFail.length
        ? red('  Run finished with findings that need attention.')
        : green('  Run finished. No violations, no invented findings.'),
    );
  }
  return { done, text: out.join('\n') };
}

if (!follow) {
  console.log(render().text);
} else {
  const tick = () => {
    const { done, text } = render();
    process.stdout.write('\x1b[2J\x1b[H'); // clear + home
    console.log(`\n${text}\n`);
    if (done) process.exit(0);
    setTimeout(tick, 10_000);
  };
  tick();
}
