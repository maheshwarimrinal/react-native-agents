/**
 * Deterministic bundle analysis.
 *
 * Deliberately contains no LLM call. Bundle composition is a measurement, not a
 * judgement — running a model over it would add cost, latency, and the risk of
 * an invented number to something arithmetic answers exactly.
 *
 * That property matters commercially as well as technically: this check costs
 * nothing per run, so it can be offered without an API key at all.
 *
 * The model's role, if any, comes later — interpreting a real number, never
 * producing one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* ------------------------------------------------------------------ *
 * Building the bundle
 * ------------------------------------------------------------------ */

/**
 * Produce a production bundle and its source map.
 * Uses the project's own CLI so it works for both Expo and bare projects.
 */
export function buildBundle({ cwd, platform = 'android', outDir, expo = null }) {
  fs.mkdirSync(outDir, { recursive: true });
  const bundleOut = path.join(outDir, `index.${platform}.bundle`);
  const mapOut = `${bundleOut}.map`;

  const isExpo = expo ?? (fs.existsSync(path.join(cwd, 'app.json')) && hasDep(cwd, 'expo'));
  const entry = findEntry(cwd);

  const args = isExpo
    ? ['expo', 'export:embed', '--platform', platform, '--dev', 'false',
       '--bundle-output', bundleOut, '--sourcemap-output', mapOut, '--entry-file', entry]
    : ['react-native', 'bundle', '--platform', platform, '--dev', 'false', '--minify', 'true',
       '--entry-file', entry, '--bundle-output', bundleOut, '--sourcemap-output', mapOut];

  // --no-install: without it npx will silently download an unpinned CLI, which
  // means unexpected network access in CI and a different tool version than the
  // project actually depends on.
  try {
    execFileSync('npx', ['--no-install', ...args], { cwd, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const text = String(err.stderr ?? err.message);
    if (/could not determine executable|not found|npx canceled/i.test(text)) {
      throw new Error(
        `The ${isExpo ? 'expo' : 'react-native'} CLI is not installed in this project. ` +
          'Run your package manager\'s install first — this tool will not download it for you.',
      );
    }
    throw err;
  }

  return { bundlePath: bundleOut, mapPath: mapOut };
}

function hasDep(cwd, name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return Boolean({ ...pkg.dependencies, ...pkg.devDependencies }[name]);
  } catch {
    return false;
  }
}

function findEntry(cwd) {
  for (const c of ['index.js', 'index.ts', 'index.tsx', 'App.js', 'App.tsx']) {
    if (fs.existsSync(path.join(cwd, c))) return c;
  }
  return 'index.js';
}

/* ------------------------------------------------------------------ *
 * Attribution
 * ------------------------------------------------------------------ */

/**
 * Attribute bundle bytes to source modules using the source map.
 *
 * Two details of the source map format matter here, and getting either wrong
 * silently misattributes bytes to the wrong package:
 *
 * 1. The generated-column field (index 0) is a delta **within a line** and
 *    resets at each `;`. The source index, source line, and source column
 *    (indices 1-3) are deltas across the **entire** mappings string and must
 *    NOT be reset per line.
 *
 * 2. Segments mark where a source's contribution *starts*. A segment owns the
 *    generated columns from its own start up to the next segment's start, and
 *    the final segment on a line owns the remainder of that line.
 *
 * Attributing a whole line to its first segment (a tempting shortcut) is wrong
 * for minified bundles, where one generated line routinely contains code from
 * dozens of modules.
 */
export function attribute(bundlePath, mapPath) {
  const bundle = fs.readFileSync(bundlePath);
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

  const bytesBySource = new Map();
  const lines = bundle.toString('utf8').split('\n');

  // Deltas that persist across the whole mappings string.
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;

  const groups = (map.mappings ?? '').split(';');

  for (let genLine = 0; genLine < groups.length; genLine++) {
    const group = groups[genLine];
    if (!group) continue;

    const lineText = lines[genLine] ?? '';
    const lineBytes = Buffer.byteLength(lineText, 'utf8');

    // Generated column resets at the start of every line.
    let genColumn = 0;
    const segs = [];

    for (const raw of group.split(',')) {
      if (!raw) continue;
      const f = decodeVLQ(raw);
      if (f.length === 0) continue;

      genColumn += f[0];
      if (f.length >= 4) {
        sourceIndex += f[1];
        sourceLine += f[2];
        sourceColumn += f[3];
        segs.push({ column: genColumn, source: sourceIndex });
      } else {
        // A one-field segment has no source — it marks generated-only output.
        segs.push({ column: genColumn, source: null });
      }
    }

    // Each segment owns [its column, the next segment's column).
    for (let i = 0; i < segs.length; i++) {
      const { column, source } = segs[i];
      if (source === null) continue;
      const end = i + 1 < segs.length ? segs[i + 1].column : lineText.length;
      const width = Math.max(0, Math.min(end, lineText.length) - column);
      if (width === 0) continue;

      // Column indices are UTF-16 code units; measure the real byte cost of
      // that slice rather than assuming one byte per unit.
      const bytes = Buffer.byteLength(lineText.slice(column, column + width), 'utf8');
      const name = map.sources?.[source];
      if (!name) continue;
      const key = normaliseSource(name);
      bytesBySource.set(key, (bytesBySource.get(key) ?? 0) + bytes);
    }

    // Newlines and any columns before the first segment belong to no source.
    void lineBytes;
  }

  return {
    totalBytes: bundle.length,
    // Sum of attributed bytes — always ≤ totalBytes, since runtime preamble and
    // inter-module glue map to no source. Exposed so callers can be honest
    // about coverage instead of implying every byte was attributed.
    attributedBytes: [...bytesBySource.values()].reduce((a, b) => a + b, 0),
    bySource: bytesBySource,
    byPackage: rollUpToPackages(bytesBySource),
  };
}

/** Base64 VLQ decoding — the source map segment encoding. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function decodeVLQ(segment) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    if (digit === -1) continue;
    const cont = digit & 32;
    value += (digit & 31) << shift;
    if (cont) {
      shift += 5;
    } else {
      const negative = value & 1;
      value >>= 1;
      out.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

function normaliseSource(s) {
  return s.replace(/^(\.\.\/)+/, '').replace(/^webpack:\/\/\//, '');
}

/**
 * Roll module paths up to something a human can act on: an npm package name, or
 * a top-level app directory. "node_modules/lodash/..." is noise; "lodash" is a
 * decision.
 */
export function rollUpToPackages(bySource) {
  const byPackage = new Map();

  for (const [source, bytes] of bySource) {
    const key = packageOf(source);
    byPackage.set(key, (byPackage.get(key) ?? 0) + bytes);
  }

  return new Map([...byPackage.entries()].sort((a, b) => b[1] - a[1]));
}

export function packageOf(source) {
  const nm = source.lastIndexOf('node_modules/');
  if (nm !== -1) {
    const rest = source.slice(nm + 'node_modules/'.length);
    const parts = rest.split('/');
    return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  if (source.startsWith('[') || source.includes('<anonymous>')) return '(runtime)';
  const parts = source.split('/').filter(Boolean);
  // Group app code by its top two directories so features are distinguishable.
  return parts.length > 1 ? `${parts[0]}/${parts[1]}` : source;
}

/* ------------------------------------------------------------------ *
 * Comparison and budgets
 * ------------------------------------------------------------------ */

export function compare(base, head) {
  const keys = new Set([...base.byPackage.keys(), ...head.byPackage.keys()]);
  const rows = [];

  for (const key of keys) {
    const before = base.byPackage.get(key) ?? 0;
    const after = head.byPackage.get(key) ?? 0;
    if (before === after) continue;
    rows.push({
      name: key,
      before,
      after,
      delta: after - before,
      status: before === 0 ? 'added' : after === 0 ? 'removed' : 'changed',
    });
  }

  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    totalBefore: base.totalBytes,
    totalAfter: head.totalBytes,
    totalDelta: head.totalBytes - base.totalBytes,
    percent: base.totalBytes ? ((head.totalBytes - base.totalBytes) / base.totalBytes) * 100 : 0,
    rows,
  };
}

/**
 * Known cheaper alternatives. Only suggested when the package is actually
 * present and material — an unsolicited list of swaps is noise.
 */
export const ALTERNATIVES = {
  moment: 'date-fns or dayjs (Hermes ships Intl, so formatting may need no library at all)',
  lodash: 'cherry-pick imports (lodash/get) or use native methods',
  'crypto-js': 'expo-crypto or a native module — JS crypto is both large and slow',
  rxjs: 'usually replaceable by plain async/await for app-level code',
  'core-js': 'often a polyfill Hermes no longer needs — check before shipping it',
  'aws-sdk': 'the modular @aws-sdk/client-* packages',
  firebase: 'the modular @react-native-firebase/* packages',
};

export function budgetVerdict(cmp, { maxTotalBytes = null, maxDeltaBytes = null, maxPercent = null }) {
  const failures = [];
  // `!== null` rather than truthiness: a budget of 0 means "no increase at all",
  // which truthiness would silently treat as "no budget set".
  if (maxTotalBytes !== null && maxTotalBytes !== undefined && cmp.totalAfter > maxTotalBytes) {
    failures.push(`total ${fmtBytes(cmp.totalAfter)} exceeds budget ${fmtBytes(maxTotalBytes)}`);
  }
  if (maxDeltaBytes !== null && maxDeltaBytes !== undefined && cmp.totalDelta > maxDeltaBytes) {
    failures.push(`increase ${fmtBytes(cmp.totalDelta)} exceeds budget ${fmtBytes(maxDeltaBytes)}`);
  }
  if (maxPercent !== null && maxPercent !== undefined && cmp.percent > maxPercent) {
    failures.push(`increase ${cmp.percent.toFixed(1)}% exceeds budget ${maxPercent}%`);
  }
  return { pass: failures.length === 0, failures };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

export function fmtBytes(n) {
  const abs = Math.abs(n);
  if (abs >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (abs >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function fmtDelta(n) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtBytes(Math.abs(n))}`;
}

export function renderReport(analysis, { top = 15 } = {}) {
  const lines = [
    `## 📦 Bundle: ${fmtBytes(analysis.totalBytes)}`,
    '',
    '| Package | Size | Share |',
    '|---|---:|---:|',
  ];
  let i = 0;
  for (const [name, bytes] of analysis.byPackage) {
    if (i++ >= top) break;
    const pct = ((bytes / analysis.totalBytes) * 100).toFixed(1);
    const alt = ALTERNATIVES[name];
    lines.push(`| \`${name}\`${alt ? ' ⚠️' : ''} | ${fmtBytes(bytes)} | ${pct}% |`);
  }

  const flagged = [...analysis.byPackage.keys()].filter((k) => ALTERNATIVES[k]);
  if (flagged.length) {
    lines.push('', '**Lighter alternatives exist for:**', '');
    for (const f of flagged) lines.push(`- \`${f}\` — ${ALTERNATIVES[f]}`);
  }

  return lines.join('\n');
}

export function renderComparison(cmp, verdict, { top = 12 } = {}) {
  const dir = cmp.totalDelta > 0 ? '📈' : cmp.totalDelta < 0 ? '📉' : '➡️';
  const lines = [
    `## 📦 Bundle size ${dir} ${fmtDelta(cmp.totalDelta)}`,
    '',
    `\`${fmtBytes(cmp.totalBefore)}\` → \`${fmtBytes(cmp.totalAfter)}\`` +
      (cmp.totalBefore ? ` (${cmp.percent > 0 ? '+' : ''}${cmp.percent.toFixed(1)}%)` : ''),
    '',
  ];

  if (verdict && !verdict.pass) {
    lines.push(`> ❌ **Budget exceeded** — ${verdict.failures.join('; ')}`, '');
  }

  if (cmp.rows.length === 0) {
    lines.push('_No change in bundle composition._', '', FOOTER);
    return lines.join('\n');
  }

  lines.push('| Package | Change | Now |', '|---|---:|---:|');
  for (const r of cmp.rows.slice(0, top)) {
    const tag = r.status === 'added' ? ' 🆕' : r.status === 'removed' ? ' 🗑️' : '';
    lines.push(`| \`${r.name}\`${tag} | ${fmtDelta(r.delta)} | ${fmtBytes(r.after)} |`);
  }
  if (cmp.rows.length > top) lines.push(`| _+${cmp.rows.length - top} more_ | | |`);

  const added = cmp.rows.filter((r) => r.status === 'added' && ALTERNATIVES[r.name]);
  if (added.length) {
    lines.push('', '**This PR adds a package with a lighter alternative:**', '');
    for (const a of added) lines.push(`- \`${a.name}\` (${fmtBytes(a.after)}) — ${ALTERNATIVES[a.name]}`);
  }

  lines.push('', FOOTER);
  return lines.join('\n');
}

const FOOTER = '<sub>Measured from the production bundle and its source map. No estimation.</sub>';
