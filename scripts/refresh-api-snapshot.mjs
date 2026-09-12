#!/usr/bin/env node
/**
 * Refresh the vendored API snapshots the guards read.
 *
 * The guards in scripts/test.mjs reject identifiers React Native and its
 * ecosystem do not ship. They need ground truth, and ground truth goes stale —
 * so this fetches it rather than asking anyone to maintain a list by hand. A
 * hand-maintained allowlist is the same process that let `accessibilityInvalid`
 * and a non-existent Reanimated 4.7.x through in the first place.
 *
 * What it does:
 *
 *   1. Reads every named import in the agent corpus, grouped by library.
 *   2. Resolves each library's current version from the npm registry.
 *   3. Fetches that version's TypeScript entry point and extracts the names it
 *      actually exports.
 *   4. Reports, per library: verified / MISSING / could-not-check.
 *
 * It records **only the identifiers the corpus claims**, not full export lists.
 * That keeps the snapshot small, makes adding an import a deliberate act — a new
 * name is unverified until this runs — and avoids the maintenance burden of
 * mirroring twenty libraries' entire public surface.
 *
 * Network access is required, so this is a maintenance command, never part of
 * `npm test`. CI reads the committed snapshot.
 *
 * Usage:
 *   node scripts/refresh-api-snapshot.mjs            # report only
 *   node scripts/refresh-api-snapshot.mjs --write    # update the snapshot
 *   node scripts/refresh-api-snapshot.mjs --only react-native-iap
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'scripts/data/rn-lib-versions.json');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ONLY = args[args.indexOf('--only') + 1] ?? null;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

/**
 * Libraries whose surface we deliberately do not check.
 *
 * `react-native` itself is covered by rn-a11y-surface.json for the namespace
 * that matters; its full export list is enormous and mostly stable. Path
 * imports and workspace aliases have no registry entry to resolve.
 */
const SKIP = new Set(['react', 'react-native']);
const isCheckable = (lib) =>
  !SKIP.has(lib) && !lib.startsWith('@/') && !lib.startsWith('.') && !lib.includes('/Libraries/');

/* ------------------------------------------------------------------ *
 * 1. What the corpus claims
 * ------------------------------------------------------------------ */

function claimedImports() {
  const byLib = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      // Skip FUSE artefacts: they are stale duplicates and would resurrect
      // identifiers that were already corrected in the real file.
      else if (e.name.endsWith('.md') && !e.name.startsWith('.fuse')) collect(f);
    }
  };

  const collect = (file) => {
    const text = fs.readFileSync(file, 'utf8');
    for (const block of text.matchAll(/```(?:tsx|jsx|ts|js)\n([\s\S]*?)```/g)) {
      for (const m of block[1].matchAll(
        /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s+from\s*['"]([^'"]+)['"]/g,
      )) {
        const lib = m[2];
        if (!isCheckable(lib)) continue;
        if (!byLib.has(lib)) byLib.set(lib, new Map());
        for (const raw of m[1].split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
          if (!name) continue;
          const where = byLib.get(lib);
          if (!where.has(name)) where.set(name, new Set());
          where.get(name).add(path.relative(ROOT, file));
        }
      }
    }
  };

  walk(path.join(ROOT, 'agents'));
  return byLib;
}

/* ------------------------------------------------------------------ *
 * 2 & 3. What the library actually ships
 * ------------------------------------------------------------------ */

async function json(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function text(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

/**
 * Strip comments before reading exports.
 *
 * The first version of this did not, and a single JSDoc tag broke it:
 *
 *   export { useScrollOffset,
 *     /* @deprecated Please use {@link useScrollOffset} instead. *\/
 *     useSharedValue, useTimestamp } from './hook';
 *
 * The `}` closing `{@link …}` terminated the `export { … }` capture, silently
 * dropping every name after it. That produced six confident "not exported"
 * reports against libraries which do export them — including `useSharedValue`,
 * which is Reanimated's single most-used hook.
 *
 * A verifier that reports false absences is worse than no verifier: it would
 * have been committed as ground truth, and the guard would then have rejected
 * correct code.
 */
export function stripCommentsForExports(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Exported names from a `.d.ts`, following one level of local `export * from`.
 *
 * Deliberately shallow: a full module graph needs a TypeScript compiler, which
 * this package does not depend on and will not start depending on for a
 * maintenance script.
 *
 * Returns `{ names, complete }`. `complete` is false when the file re-exports
 * from **another package** — at that point the local name list is a subset, and
 * a missing name proves nothing. Callers must not report absence when the
 * picture is incomplete.
 */
async function exportedNames(pkg, version, entry, depth = 0) {
  const names = new Set();
  let complete = true;
  const base = `https://unpkg.com/${pkg}@${version}/`;

  let raw;
  try {
    raw = await text(base + entry);
  } catch {
    return { names, complete: false };
  }
  const src = stripCommentsForExports(raw);

  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:const|function|class|enum|let|var)\s+([\w$]+)/g,
  )) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop().replace(/^type\s+/, '').trim();
      if (name) names.add(name);
    }
  }
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:interface|type)\s+([\w$]+)/g)) {
    names.add(m[1]);
  }

  // Re-exports that leave the package: the local list can no longer be
  // exhaustive. @react-navigation/native re-exports most of its surface from
  // @react-navigation/core, which is why it reported useNavigation as missing.
  if (hasOffshoreReexport(src)) complete = false;

  if (depth < 1) {
    for (const m of src.matchAll(/export\s+\*\s+from\s+['"]\.\/([^'"]+)['"]/g)) {
      const rel = m[1].replace(/\.js$/, '.d.ts');
      const nested = path.posix.join(path.posix.dirname(entry), rel);
      const sub = await exportedNames(pkg, version, nested, depth + 1);
      for (const n of sub.names) names.add(n);
      if (!sub.complete) complete = false;
    }
  }
  return { names, complete };
}

/**
 * `msw/native` and `@hookform/resolvers/zod` are subpaths, not packages — the
 * registry 404s on them. Resolve to the publishable root: one leading segment,
 * or two when the name is scoped.
 */
/** A re-export whose source is another package, not a local path. */
export function hasOffshoreReexport(src) {
  return /export\s+(?:\*|\{[^}]*\})\s+from\s+['"][^.'"]/.test(stripCommentsForExports(src));
}

export function rootPackage(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

async function inspect(specifier) {
  const pkg = rootPackage(specifier);
  const tags = await json(`https://registry.npmjs.org/-/package/${pkg}/dist-tags`);
  const version = tags.latest;
  const meta = await json(`https://registry.npmjs.org/${pkg}/${version}`);
  // Subpath entry points are resolved below from the root package's types field.

  /**
   * Modern packages declare types in the `exports` map rather than a top-level
   * `types` field, and subpaths like `msw/native` only appear there. Three
   * libraries reported "no readable type entry" for exactly this reason.
   */
  const subpath = specifier === pkg ? '.' : `./${specifier.slice(pkg.length + 1)}`;
  const fromExports = [];
  const collectTypes = (node) => {
    if (!node) return;
    if (typeof node === 'string') {
      if (node.endsWith('.d.ts')) fromExports.push(node);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'types' || key === 'typings') collectTypes(value);
      else if (!key.startsWith('.')) collectTypes(value);
    }
  };
  collectTypes(meta.exports?.[subpath] ?? (subpath === '.' ? meta.exports : undefined));

  const entries = [
    ...fromExports,
    ...(subpath === '.' ? [meta.types, meta.typings] : []),
    'lib/typescript/src/index.d.ts',
    'lib/typescript/index.d.ts',
    'lib/index.d.ts',
    'dist/index.d.ts',
    'index.d.ts',
  ].filter(Boolean);

  for (const entry of entries) {
    const { names, complete } = await exportedNames(pkg, version, entry.replace(/^\.\//, ''));
    if (names.size) return { version, entry, names, complete, peer: meta.peerDependencies ?? {} };
  }
  return {
    version,
    entry: null,
    names: new Set(),
    complete: false,
    peer: meta.peerDependencies ?? {},
  };
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

/**
 * Only run the CLI when invoked directly.
 *
 * Without this the module cannot be imported: `scripts/test.mjs` needs
 * `stripCommentsForExports` and `hasOffshoreReexport` to test the extractor,
 * and importing the file used to execute a full network refresh and then call
 * `process.exit` — killing the test run mid-suite.
 */
function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  await main();
}

async function main() {

  const claimed = claimedImports();
  const libs = [...claimed.keys()].filter((l) => !ONLY || l === ONLY).sort();

  console.log(c.bold(`\n  API snapshot refresh — ${libs.length} librar${libs.length === 1 ? 'y' : 'ies'}\n`));

  const verified = {};
  let missing = 0;
  let unchecked = 0;

  for (const lib of libs) {
    const want = claimed.get(lib);
    let info;
    try {
      info = await inspect(lib);
    } catch (err) {
      console.log(`  ${c.yellow('?')} ${lib} ${c.dim(`— could not check (${err.message})`)}`);
      unchecked += want.size;
      continue;
    }

    if (!info.names.size) {
      console.log(`  ${c.yellow('?')} ${lib}@${info.version} ${c.dim('— no readable type entry')}`);
      unchecked += want.size;
      continue;
    }

    const ok = [];
    const bad = [];
    for (const [name, files] of want) (info.names.has(name) ? ok : bad).push([name, [...files]]);

    /**
     * Absence is only reportable when the export picture is complete.
     *
     * When a package re-exports from another package — @react-navigation/native
     * takes most of its surface from @react-navigation/core — the names read here
     * are a subset, and a name not found proves nothing. Reporting it as missing
     * is a false accusation against correct documentation, and committing that as
     * ground truth would make the guard reject working code.
     */
    if (!info.complete && bad.length) {
      console.log(
        `  ${c.yellow('?')} ${lib}@${info.version} ` +
          c.dim(`${ok.length}/${want.size} verified — re-exports leave the package, cannot confirm the rest`),
      );
      for (const [name] of bad) console.log(c.dim(`      ${name} — unconfirmed, not absent`));
      unchecked += bad.length;
      if (ok.length) {
        verified[lib] = {
          version_checked: info.version,
          checked_on: new Date().toISOString().slice(0, 10),
          type_entry: info.entry,
          partial: true,
          identifiers_verified: ok.map(([n]) => n).sort(),
        };
      }
      continue;
    }

    const mark = bad.length ? c.red('✗') : c.green('✓');
    console.log(`  ${mark} ${lib}@${info.version} ${c.dim(`${ok.length}/${want.size} verified`)}`);
    for (const [name, files] of bad) {
      console.log(c.red(`      ${name} — not exported`) + c.dim(` (${files.join(', ')})`));
      missing++;
    }

    verified[lib] = {
      version_checked: info.version,
      checked_on: new Date().toISOString().slice(0, 10),
      type_entry: info.entry,
      identifiers_verified: ok.map(([n]) => n).sort(),
      ...(Object.keys(info.peer).length ? { peer_dependencies: info.peer } : {}),
    };
  }

  console.log(
    `\n  ${missing ? c.red(`${missing} identifier(s) not exported`) : c.green('every claimed identifier exists')}` +
      (unchecked ? c.dim(`  ·  ${unchecked} could not be checked`) : '') +
      '\n',
  );

  if (WRITE) {
    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    snapshot.verified_imports = { ...(snapshot.verified_imports ?? {}), ...verified };
    snapshot.verified_on = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(c.dim(`  written to ${path.relative(ROOT, SNAPSHOT)}\n`));
  } else {
    console.log(c.dim('  report only — pass --write to update the snapshot\n'));
  }

  process.exit(missing ? 1 : 0);
}
