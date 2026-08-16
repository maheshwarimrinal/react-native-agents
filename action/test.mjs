#!/usr/bin/env node
/**
 * Tests for the audit engine. Zero dependencies, no network, no API key.
 *
 *   node action/test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const { globToRegExp, matchesGlob, isIgnored, route, addedLines } = await import('./lib/router.mjs');
const { parseDiff, renderForPrompt, findPosition, nearestChangedLine, changedFilePaths } =
  await import('./lib/diff.mjs');
const { LLM, estimateTokens, estimateCost, BudgetExceededError } = await import('./lib/llm.mjs');
const awaitedAudit = await import('./lib/audit.mjs');
const { parseFindings, dedupe, countBySeverity, gateFails } = awaitedAudit;
const { renderSummary } = await import('./lib/github.mjs');
const { detectProject } = await import('./index.mjs');
const { loadAgents } = await import('../scripts/lib/source.mjs');

const actionYml = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failures.push({ name, err });
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failures.push({ name, err });
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

/* ---------------------------------------------------------------- *
 * Glob matching
 * ---------------------------------------------------------------- */

test('glob: ** crosses directories', () => {
  assert(matchesGlob('src/features/cart/Cart.tsx', '**/*.tsx'));
  assert(matchesGlob('Cart.tsx', '**/*.tsx'), '**/ should match zero segments');
});

test('glob: * does not cross a directory boundary', () => {
  assert(matchesGlob('metro.config.js', '*.js'));
  assert(!matchesGlob('src/a.js', '*.js'));
});

test('glob: brace alternation', () => {
  assert(matchesGlob('a/b.ts', '**/*.{ts,tsx}'));
  assert(matchesGlob('a/b.tsx', '**/*.{ts,tsx}'));
  assert(!matchesGlob('a/b.js', '**/*.{ts,tsx}'));
});

test('glob: dots are literal, not wildcards', () => {
  assert(!matchesGlob('appXjson', 'app.json'));
  assert(matchesGlob('app.json', 'app.json'));
});

test('glob: exact platform files', () => {
  assert(matchesGlob('android/app/src/main/AndroidManifest.xml', '**/AndroidManifest.xml'));
  assert(matchesGlob('ios/App/Info.plist', '**/Info.plist'));
});

test('ignores build output, lockfiles, and binaries', () => {
  assert(isIgnored('node_modules/react/index.js'));
  assert(isIgnored('dist/claude-code/x.md'));
  assert(isIgnored('assets/logo.png'));
  assert(isIgnored('ios/Pods/Foo/Bar.m'));
  assert(!isIgnored('src/App.tsx'));
});

/* ---------------------------------------------------------------- *
 * Routing — the cost lever
 * ---------------------------------------------------------------- */

const agents = loadAgents();

test('routes eas.json to release, not accessibility', () => {
  const { selected } = route(['eas.json'], agents);
  const ids = selected.map((a) => a.id);
  assert(ids.includes('rn-release'), `expected rn-release, got ${ids}`);
  assert(!ids.includes('rn-ui-accessibility'), 'a11y should not run on eas.json');
});

test('routes AndroidManifest.xml to security', () => {
  const ids = route(['android/app/src/main/AndroidManifest.xml'], agents).selected.map((a) => a.id);
  assert(ids.includes('rn-security'), `got ${ids}`);
});

test('routes a component to a11y and code quality', () => {
  const ids = route(['src/components/Button.tsx'], agents).selected.map((a) => a.id);
  assert(ids.includes('rn-ui-accessibility'), `got ${ids}`);
  assert(ids.includes('rn-code-quality'), `got ${ids}`);
});

test('routes auth files to security', () => {
  const ids = route(['src/lib/authClient.ts'], agents).selected.map((a) => a.id);
  assert(ids.includes('rn-security'), `got ${ids}`);
});

test('routes test files to the testing agent', () => {
  const ids = route(['src/__tests__/Cart.test.tsx'], agents).selected.map((a) => a.id);
  assert(ids.includes('rn-testing'), `got ${ids}`);
});

test('config files route when the app is not at the repository root', () => {
  // A bare `eas.json` signal only matches at the root, which silently skips the
  // app in every monorepo — and in this repo's own demo under examples/.
  for (const [file, expected] of [
    ['apps/mobile/eas.json', 'rn-release'],
    ['packages/app/app.config.ts', 'rn-release'],
    ['apps/mobile/package.json', 'rn-release'],
    ['packages/app/metro.config.js', 'rn-performance'],
    ['apps/mobile/jest.config.js', 'rn-testing'],
    ['apps/mobile/package.json', 'rn-security'],
  ]) {
    const ids = route([file], agents).selected.map((a) => a.id);
    assert(ids.includes(expected), `${file} should route to ${expected}; got ${ids}`);
  }
});

test('the bundled demo exercises every review agent it claims to', () => {
  // The demo README lists expected findings per specialist; if routing skips one,
  // that documented finding can never be produced.
  const demo = [
    'examples/react-native-audit-demo/eas.json',
    'examples/react-native-audit-demo/src/screens/CatalogueScreen.tsx',
    'examples/react-native-audit-demo/src/lib/auth.ts',
    'examples/react-native-audit-demo/src/hooks/useCatalogue.ts',
    'examples/react-native-audit-demo/src/screens/CatalogueScreen.test.tsx',
  ];
  const ids = route(demo, agents).selected.map((a) => a.id);
  for (const expected of [
    'rn-release', 'rn-performance', 'rn-security', 'rn-code-quality',
    'rn-testing', 'rn-ui-accessibility',
  ]) {
    assert(ids.includes(expected), `demo should route ${expected}; got ${ids}`);
  }
});

test('all lockfiles are ignored consistently', () => {
  // Only `*.lock` was excluded before, so yarn.lock was skipped while
  // package-lock.json and pnpm-lock.yaml were sent to the model — thousands of
  // lines of hashes, no usable signal, and inconsistent between projects.
  for (const f of [
    'yarn.lock', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lockb',
    'ios/Podfile.lock', 'Gemfile.lock', 'apps/mobile/yarn.lock',
  ]) {
    assert(isIgnored(f), `${f} should be ignored`);
  }
});

test('broadened config patterns still exclude vendored copies', () => {
  for (const f of [
    'node_modules/some-lib/package.json',
    'ios/Pods/Foo/package.json',
    'dist/app.json',
  ]) {
    eq(route([f], agents).selected.length, 0, `${f} must not route`);
  }
});

test('routing actually reduces agent count for a narrow change', () => {
  const { selected } = route(['eas.json'], agents);
  assert(selected.length < agents.length, 'narrow change should not fan out to every agent');
});

test('ignored-only changesets select nothing', () => {
  const { selected } = route(['node_modules/x/index.js', 'assets/a.png'], agents);
  eq(selected.length, 0, 'should route nothing');
});

test('maxAgents caps the fan-out', () => {
  const { selected } = route(
    ['src/App.tsx', 'eas.json', 'src/auth.ts', 'src/__tests__/a.test.ts'],
    agents,
    { maxAgents: 2 },
  );
  assert(selected.length <= 2, `got ${selected.length}`);
});

test('explicit agent list bypasses routing', () => {
  const { selected } = route(['README.md'], agents, { only: ['rn-security'] });
  eq(selected.length, 1);
  eq(selected[0].id, 'rn-security');
});

test('diff keyword signals add routing evidence', () => {
  const diff = '+++ b/src/x.ts\n+const t = await AsyncStorage.setItem("token", jwt) // certificate pinning\n';
  const { reasons } = route(['src/x.ts'], agents, { diffText: diff });
  assert(
    JSON.stringify(reasons['rn-security'] ?? []).includes('diff mentions'),
    `expected keyword evidence, got ${JSON.stringify(reasons['rn-security'])}`,
  );
});

test('addedLines extracts only additions', () => {
  const lines = addedLines('+++ b/x\n+added\n-removed\n context\n+also');
  eq(lines.length, 2);
  eq(lines[0], 'added');
});

/* ---------------------------------------------------------------- *
 * Review vs interactive agents
 * ---------------------------------------------------------------- */

const { isReviewAgent } = await import('./lib/router.mjs');

test('interactive agents are never routed to a pull request', () => {
  // rn-doctor needs an error log and rn-build needs a request; firing them at a
  // diff spends tokens to say nothing, and noise gets review bots muted.
  const everyFile = [
    'src/App.tsx', 'android/app/build.gradle', 'ios/Podfile', 'package.json',
    'src/__tests__/a.test.tsx', 'eas.json', 'src/native/Thing.kt',
  ];
  const ids = route(everyFile, agents).selected.map((a) => a.id);
  for (const interactive of ['rn-doctor', 'rn-build']) {
    assert(!ids.includes(interactive), `${interactive} must not be routed for review; got ${ids}`);
  }
});

test('interactive agents are still reachable when explicitly requested', () => {
  const { selected } = route(['README.md'], agents, { only: ['rn-doctor'] });
  eq(selected.length, 1);
  eq(selected[0].id, 'rn-doctor');
});

test('review-mode agents are unaffected by the mode filter', () => {
  for (const id of ['rn-security', 'rn-performance', 'rn-native-modules']) {
    const a = agents.find((x) => x.id === id);
    assert(isReviewAgent(a), `${id} should be reviewable (mode=${a.mode})`);
  }
});

test('observability routes on directory layouts, not just filenames', () => {
  // `src/analytics/events.ts` is the common shape and matches no filename
  // pattern — it routed only to code-quality before directory globs were added.
  for (const f of [
    'src/analytics/events.ts',
    'src/telemetry/index.ts',
    'src/monitoring/alerts.ts',
    'src/observability/tracing.ts',
    'src/instrumentation/network.ts',
  ]) {
    const ids = route([f], agents).selected.map((a) => a.id);
    assert(ids.includes('rn-observability'), `${f} should route to observability; got ${ids}`);
  }
});

test('observability routes on vendor files and entry points', () => {
  for (const f of [
    'src/lib/sentry.ts',
    'android/app/proguard-rules.pro',
    'ios/sentry.properties',
    'index.js',
  ]) {
    const ids = route([f], agents).selected.map((a) => a.id);
    assert(ids.includes('rn-observability'), `${f} should route to observability; got ${ids}`);
  }
});

test('observability does NOT route on every App.tsx change', () => {
  // Almost every UI change touches App.tsx. Routing it here spent an
  // observability model call on unrelated work; telemetry added elsewhere is
  // still caught by the diff keyword signals.
  const ids = route(['App.tsx'], agents).selected.map((a) => a.id);
  assert(!ids.includes('rn-observability'), `App.tsx should not route to observability; got ${ids}`);
  assert(ids.includes('rn-ui-accessibility'), 'but it should still route to the UI agent');
});

test('observability is picked up when a diff actually adds telemetry', () => {
  const diff = '+++ b/src/App.tsx\n+Sentry.init({ dsn, tracesSampleRate: 0.1 }); // crash reporting\n';
  const { reasons } = route(['src/App.tsx'], agents, { diffText: diff });
  assert(
    JSON.stringify(reasons['rn-observability'] ?? []).includes('diff mentions'),
    `expected keyword evidence, got ${JSON.stringify(reasons['rn-observability'])}`,
  );
});

test('native code routes to the native-modules agent', () => {
  const ids = route(['android/src/main/java/com/x/FooModule.kt'], agents).selected.map((a) => a.id);
  assert(ids.includes('rn-native-modules'), `got ${ids}`);
});

test('a podspec routes to the native-modules agent', () => {
  const ids = route(['MyLib.podspec'], agents).selected.map((a) => a.id);
  assert(ids.includes('rn-native-modules'), `got ${ids}`);
});

/* ---------------------------------------------------------------- *
 * Fetching the diff — the 406 "too_large" path
 * ---------------------------------------------------------------- */

const { GitHub } = await import('./lib/github.mjs');

/**
 * Stand in for fetch so the fallback can be exercised without network.
 * Must await `fn()` — returning the promise would restore the real fetch
 * before the async work under test had run.
 */
async function withMockFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const PR_FILES = [
  { filename: 'dist/claude-code/x.md', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' },
  { filename: 'package-lock.json', status: 'modified', patch: '@@ -1 +1 @@\n-x\n+y' },
  { filename: 'src/Feed.tsx', status: 'modified', patch: '@@ -10,2 +10,3 @@\n context\n+const a = 1;' },
  { filename: 'src/New.tsx', status: 'added', patch: '@@ -0,0 +1,2 @@\n+import x;\n+export default x;' },
  { filename: 'assets/logo.png', status: 'modified' }, // binary: no patch
];

await testAsync('a 406 diff falls back to the files API instead of failing', async () => {
  // GitHub refuses the diff endpoint past ~300 files or ~20,000 lines, which any
  // PR regenerating build output crosses. Previously this aborted the whole run.
  const gh = new GitHub({ token: 't', repo: 'o/r', prNumber: 1, sha: 'abc' });
  const diff = await withMockFetch(
    async (url) => {
      if (!String(url).includes('/files')) {
        return { ok: false, status: 406, text: async () => '{"message":"too_large"}' };
      }
      const page = Number(new URL(url).searchParams.get('page'));
      return { ok: true, status: 200, json: async () => (page === 1 ? PR_FILES : []) };
    },
    () => gh.getDiff(),
  );

  const parsed = parseDiff(diff);
  const paths = changedFilePaths(parsed);
  assert(paths.includes('src/Feed.tsx'), `expected src/Feed.tsx, got ${paths}`);
  assert(paths.includes('src/New.tsx'), `expected src/New.tsx, got ${paths}`);
});

await testAsync('the fallback drops ignored files before rebuilding', async () => {
  // Generated output and lockfiles are usually what made the diff oversized in
  // the first place, so filtering them is what makes the PR reviewable at all.
  const gh = new GitHub({ token: 't', repo: 'o/r', prNumber: 1, sha: 'abc' });
  const diff = await withMockFetch(
    async (url) => {
      if (!String(url).includes('/files')) {
        return { ok: false, status: 406, text: async () => '' };
      }
      const page = Number(new URL(url).searchParams.get('page'));
      return { ok: true, status: 200, json: async () => (page === 1 ? PR_FILES : []) };
    },
    () => gh.getDiff(),
  );

  assert(!diff.includes('dist/claude-code'), 'generated output must not be reassembled');
  assert(!diff.includes('package-lock.json'), 'lockfiles must not be reassembled');
  assert(!diff.includes('logo.png'), 'binary files have no patch to include');
});

await testAsync('the rebuilt diff keeps correct line numbers and file status', async () => {
  const gh = new GitHub({ token: 't', repo: 'o/r', prNumber: 1, sha: 'abc' });
  const diff = await withMockFetch(
    async (url) => {
      if (!String(url).includes('/files')) return { ok: false, status: 406, text: async () => '' };
      const page = Number(new URL(url).searchParams.get('page'));
      return { ok: true, status: 200, json: async () => (page === 1 ? PR_FILES : []) };
    },
    () => gh.getDiff(),
  );

  const parsed = parseDiff(diff);
  const feed = parsed.find((f) => f.path === 'src/Feed.tsx');
  const added = parsed.find((f) => f.path === 'src/New.tsx');
  eq(added.status, 'added', 'new files must be marked added');
  eq(feed.hunks[0].lines.find((l) => l.type === '+').newLine, 11, 'line numbers must survive rebuild');
});

await testAsync('the fallback paginates beyond one page', async () => {
  const gh = new GitHub({ token: 't', repo: 'o/r', prNumber: 1, sha: 'abc' });
  const bigPage = Array.from({ length: 100 }, (_, i) => ({
    filename: `src/F${i}.tsx`, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b',
  }));
  let pagesRequested = 0;

  const diff = await withMockFetch(
    async (url) => {
      if (!String(url).includes('/files')) return { ok: false, status: 406, text: async () => '' };
      pagesRequested += 1;
      const page = Number(new URL(url).searchParams.get('page'));
      return { ok: true, status: 200, json: async () => (page === 1 ? bigPage : [bigPage[0]]) };
    },
    () => gh.getDiff(),
  );

  assert(pagesRequested >= 2, `should request a second page, requested ${pagesRequested}`);
  assert(parseDiff(diff).length > 90, 'should reassemble the full first page');
});

await testAsync('non-406 failures still raise, with an actionable message', async () => {
  const gh = new GitHub({ token: 't', repo: 'o/r', prNumber: 1, sha: 'abc' });
  for (const [status, expect] of [[403, /permission|pull-requests: write/i], [404, /not found/i], [401, /invalid or expired/i]]) {
    let err = null;
    try {
      await withMockFetch(
        async () => ({ ok: false, status, text: async () => '' }),
        () => gh.getDiff(),
      );
    } catch (e) {
      err = e;
    }
    assert(err, `${status} should throw`);
    assert(expect.test(err.message), `${status} message unhelpful: ${err.message}`);
  }
});

await testAsync('a PR of only ignored files yields an empty diff, not a crash', async () => {
  const gh = new GitHub({ token: 't', repo: 'o/r', prNumber: 1, sha: 'abc' });
  const diff = await withMockFetch(
    async (url) => {
      if (!String(url).includes('/files')) return { ok: false, status: 406, text: async () => '' };
      const page = Number(new URL(url).searchParams.get('page'));
      return {
        ok: true, status: 200,
        json: async () => (page === 1 ? [{ filename: 'dist/a.md', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }] : []),
      };
    },
    () => gh.getDiff(),
  );
  eq(diff, '', 'nothing reviewable should produce an empty diff');
});

/* ---------------------------------------------------------------- *
 * Bundle size — deterministic, no model involved
 * ---------------------------------------------------------------- */

const size = await import('./lib/size.mjs');

test('size: VLQ decodes the base case', () => {
  const v = size.decodeVLQ('AAAA');
  eq(v.length, 4);
  eq(v[0], 0);
});

test('size: VLQ handles negative and multi-digit values', () => {
  assert(size.decodeVLQ('D')[0] === -1, `got ${size.decodeVLQ('D')[0]}`);
  assert(Number.isInteger(size.decodeVLQ('gB')[0]));
});

test('size: attributes node_modules paths to package names', () => {
  eq(size.packageOf('node_modules/lodash/get.js'), 'lodash');
  eq(size.packageOf('../../node_modules/moment/locale/fr.js'), 'moment');
});

test('size: keeps npm scopes intact', () => {
  eq(size.packageOf('node_modules/@react-navigation/native/lib/index.js'), '@react-navigation/native');
});

test('size: groups app code by its top directories', () => {
  eq(size.packageOf('src/screens/Feed.tsx'), 'src/screens');
});

test('size: rolls many modules up into one package total', () => {
  const bySource = new Map([
    ['node_modules/lodash/get.js', 1000],
    ['node_modules/lodash/set.js', 500],
    ['src/app/index.tsx', 300],
  ]);
  const byPackage = size.rollUpToPackages(bySource);
  eq(byPackage.get('lodash'), 1500);
});

test('size: rollup is sorted largest first', () => {
  const byPackage = size.rollUpToPackages(
    new Map([['node_modules/small/a.js', 10], ['node_modules/big/b.js', 9000]]),
  );
  eq([...byPackage.keys()][0], 'big');
});

test('size: comparison reports added, removed, and changed', () => {
  const base = { totalBytes: 1000, byPackage: new Map([['keep', 400], ['gone', 300]]) };
  const head = { totalBytes: 1400, byPackage: new Map([['keep', 400], ['fresh', 700]]) };
  const cmp = size.compare(base, head);
  eq(cmp.totalDelta, 400);
  const byName = Object.fromEntries(cmp.rows.map((r) => [r.name, r.status]));
  eq(byName.fresh, 'added');
  eq(byName.gone, 'removed');
  assert(!('keep' in byName), 'unchanged packages should not appear');
});

test('size: budget verdict fails on an excessive delta', () => {
  const cmp = { totalAfter: 2000, totalDelta: 500, percent: 33 };
  eq(size.budgetVerdict(cmp, { maxDeltaBytes: 100 }).pass, false);
  eq(size.budgetVerdict(cmp, { maxDeltaBytes: 1000 }).pass, true);
});

test('size: budget verdict fails on an excessive percentage', () => {
  const cmp = { totalAfter: 2000, totalDelta: 500, percent: 33 };
  eq(size.budgetVerdict(cmp, { maxPercent: 10 }).pass, false);
});

test('size: no budget means no failure', () => {
  eq(size.budgetVerdict({ totalAfter: 9e9, totalDelta: 9e9, percent: 900 }, {}).pass, true);
});

test('size: formats bytes at each magnitude', () => {
  eq(size.fmtBytes(512), '512 B');
  eq(size.fmtBytes(2048), '2.0 KB');
  eq(size.fmtBytes(2 * 1024 * 1024), '2.00 MB');
});

test('size: report surfaces a lighter alternative when one is known', () => {
  const cmp = size.compare(
    { totalBytes: 100, byPackage: new Map() },
    { totalBytes: 1000, byPackage: new Map([['moment', 900]]) },
  );
  const md = size.renderComparison(cmp, { pass: true, failures: [] });
  assert(/date-fns|dayjs/.test(md), 'should suggest a lighter date library');
});

test('size: report states the numbers are measured, not estimated', () => {
  const md = size.renderComparison(
    size.compare({ totalBytes: 10, byPackage: new Map() }, { totalBytes: 10, byPackage: new Map() }),
    { pass: true, failures: [] },
  );
  assert(/measured/i.test(md), 'must not read as an estimate');
});

test('size: analyzer performs no model call', () => {
  // The whole commercial argument is that this costs nothing to run.
  const src = fs.readFileSync(path.join(HERE, 'lib/size.mjs'), 'utf8');
  assert(!/anthropic|openai|api[_-]?key|LLM\(/i.test(src), 'size analysis must stay deterministic');
});

test('size: parses human-readable budget strings', async () => {
  const { parseSize } = await import('./size.mjs');
  eq(parseSize('100kb'), 102400);
  eq(parseSize('1.5mb'), 1572864);
  eq(parseSize('2048'), 2048);
  eq(parseSize(undefined), null);
});

test('size: a malformed budget throws instead of silently disabling the check', async () => {
  // Returning null here would leave the run green with no budget enforced —
  // the exact outcome the budget exists to prevent.
  const { parseSize, parsePercent } = await import('./size.mjs');
  for (const bad of ['nope', '1.2.3mb', '-5kb', '10gbb', 'kb']) {
    let threw = false;
    try { parseSize(bad); } catch { threw = true; }
    assert(threw, `parseSize(${JSON.stringify(bad)}) should throw, not return silently`);
  }
  for (const bad of ['abc', '-1', 'NaN']) {
    let threw = false;
    try { parsePercent(bad); } catch { threw = true; }
    assert(threw, `parsePercent(${JSON.stringify(bad)}) should throw`);
  }
});

test('size: a zero budget means "no increase allowed", not "unset"', async () => {
  const { parseSize } = await import('./size.mjs');
  eq(parseSize('0'), 0);
  const cmp = { totalAfter: 1100, totalDelta: 100, percent: 10 };
  eq(size.budgetVerdict(cmp, { maxDeltaBytes: 0 }).pass, false, 'delta 0 must be enforced');
  eq(size.budgetVerdict(cmp, { maxPercent: 0 }).pass, false, 'percent 0 must be enforced');
});

test('size: an unset budget still passes', () => {
  const cmp = { totalAfter: 1e9, totalDelta: 1e9, percent: 999 };
  eq(size.budgetVerdict(cmp, { maxDeltaBytes: null, maxPercent: null }).pass, true);
});

test('size: source index deltas persist across generated lines', () => {
  // Resetting the source-index delta per line silently attributes bytes to the
  // wrong package — the bug is invisible without a multi-line fixture.
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const enc = (n) => {
    let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
    let o = '';
    do { let d = v & 31; v >>>= 5; if (v > 0) d |= 32; o += B64[d]; } while (v > 0);
    return o;
  };
  const seg = (a, b, c, d) => enc(a) + enc(b) + enc(c) + enc(d);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-map-'));
  const bundle = path.join(dir, 'b.js');
  // Line 1 → source 0, line 2 → source 1 (delta +1 carried across the ';').
  fs.writeFileSync(bundle, 'AAAA\nBBBB');
  fs.writeFileSync(`${bundle}.map`, JSON.stringify({
    version: 3,
    sources: ['node_modules/alpha/a.js', 'node_modules/beta/b.js'],
    mappings: [seg(0, 0, 0, 0), seg(0, 1, 0, 0)].join(';'),
  }));

  const r = size.attribute(bundle, `${bundle}.map`);
  eq(r.bySource.get('node_modules/alpha/a.js'), 4, 'line 1 belongs to alpha');
  eq(r.bySource.get('node_modules/beta/b.js'), 4, 'line 2 belongs to beta — delta must carry over');
});

test('size: segments split one line across several sources', () => {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const enc = (n) => {
    let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
    let o = '';
    do { let d = v & 31; v >>>= 5; if (v > 0) d |= 32; o += B64[d]; } while (v > 0);
    return o;
  };
  const seg = (a, b, c, d) => enc(a) + enc(b) + enc(c) + enc(d);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-map2-'));
  const bundle = path.join(dir, 'b.js');
  fs.writeFileSync(bundle, 'AAAABBBBBBCCCC'); // 4 + 6 + 4
  fs.writeFileSync(`${bundle}.map`, JSON.stringify({
    version: 3,
    sources: ['node_modules/alpha/a.js', 'node_modules/beta/b.js', 'src/app/c.js'],
    mappings: [seg(0, 0, 0, 0), seg(4, 1, 0, 0), seg(6, 1, 0, 0)].join(','),
  }));

  const r = size.attribute(bundle, `${bundle}.map`);
  eq(r.bySource.get('node_modules/alpha/a.js'), 4);
  eq(r.bySource.get('node_modules/beta/b.js'), 6);
  eq(r.bySource.get('src/app/c.js'), 4);
  eq(r.attributedBytes, 14, 'every mapped byte attributed exactly once');
});

test('size: reports attributed bytes so coverage can be stated honestly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-map3-'));
  const bundle = path.join(dir, 'b.js');
  fs.writeFileSync(bundle, 'unmapped runtime preamble');
  fs.writeFileSync(`${bundle}.map`, JSON.stringify({ version: 3, sources: [], mappings: '' }));
  const r = size.attribute(bundle, `${bundle}.map`);
  eq(r.attributedBytes, 0);
  assert(r.totalBytes > 0, 'total still measured');
});

test('size: bundle build refuses to download a CLI it does not have', () => {
  const src = fs.readFileSync(path.join(HERE, 'lib/size.mjs'), 'utf8');
  assert(/--no-install/.test(src), 'npx must not silently fetch an unpinned CLI');
});

test('size: base comparison supports every common package manager', async () => {
  const { detectPackageManager } = await import('./size.mjs');
  for (const [file, expected] of [
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lockb', 'bun'],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-pm-'));
    fs.writeFileSync(path.join(dir, file), '');
    eq(detectPackageManager(dir)?.name, expected, `${file} → ${expected}`);
  }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-pm-none-'));
  eq(detectPackageManager(empty), null, 'no lockfile must be detectable, not assumed npm');
});

test('size: a failed base build exits non-zero instead of falling back', () => {
  // Falling back to a single-bundle report would skip the comparison AND the
  // budget check while still exiting 0. Assert on the catch block's behaviour
  // rather than on prose, which legitimately mentions the fallback.
  const src = fs.readFileSync(path.join(HERE, 'size.mjs'), 'utf8');
  const catchBlock = src.slice(src.indexOf('Could not build the base bundle'));
  const body = catchBlock.slice(0, catchBlock.indexOf('} finally'));

  assert(/process\.exit\(2\)/.test(body), 'base-build failure needs a distinct non-zero exit');
  assert(
    !/renderReport\(/.test(body),
    'must not print a single-bundle report as a fallback — that hides the skipped budget check',
  );
  assert(!/^\s*return;\s*$/m.test(body), 'must not return successfully from the failure path');
});

/* ---------------------------------------------------------------- *
 * Diff parsing
 * ---------------------------------------------------------------- */

const SAMPLE_DIFF = `diff --git a/src/Feed.tsx b/src/Feed.tsx
index 111..222 100644
--- a/src/Feed.tsx
+++ b/src/Feed.tsx
@@ -10,6 +10,9 @@ export function Feed() {
   const [posts, setPosts] = useState([]);
   return (
     <FlatList
+      data={posts.filter(p => p.visible)}
+      keyExtractor={(_, i) => String(i)}
+      renderItem={({ item }) => <Row item={item} />}
       style={styles.list}
     />
   );
diff --git a/eas.json b/eas.json
new file mode 100644
--- /dev/null
+++ b/eas.json
@@ -0,0 +1,3 @@
+{
+  "build": {}
+}
`;

const parsed = parseDiff(SAMPLE_DIFF);

test('parses both files from the diff', () => eq(parsed.length, 2));
test('detects an added file', () => eq(parsed[1].status, 'added'));
test('counts additions', () => eq(parsed[0].additions, 3));

test('assigns correct new-file line numbers', () => {
  const added = parsed[0].hunks[0].lines.filter((l) => l.type === '+');
  eq(added[0].newLine, 13, 'first added line');
  eq(added[1].newLine, 14);
  eq(added[2].newLine, 15);
});

test('findPosition locates a changed line', () => {
  const p = findPosition(parsed, 'src/Feed.tsx', 13);
  assert(p !== null && p > 0, `got ${p}`);
});

test('findPosition returns null for a line outside the diff', () => {
  eq(findPosition(parsed, 'src/Feed.tsx', 9999), null);
});

test('nearestChangedLine snaps a near-miss onto the diff', () => {
  const near = nearestChangedLine(parsed, 'src/Feed.tsx', 16);
  assert(near && near.line === 15, `got ${JSON.stringify(near)}`);
});

test('nearestChangedLine refuses a far miss', () => {
  eq(nearestChangedLine(parsed, 'src/Feed.tsx', 500), null);
});

test('changedFilePaths excludes deletions', () => {
  const withDelete = parseDiff(`${SAMPLE_DIFF}diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n`);
  assert(!changedFilePaths(withDelete).includes('old.ts'));
});

test('renderForPrompt annotates lines with numbers', () => {
  const { text } = renderForPrompt(parsed);
  assert(text.includes('   13 +'), 'expected a numbered added line');
  assert(text.includes('### src/Feed.tsx'), 'expected a file header');
});

test('renderForPrompt truncates oversized files', () => {
  const big = parseDiff(
    `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -1,1 +1,1 @@\n` +
      Array.from({ length: 5000 }, (_, i) => `+line ${i} ${'x'.repeat(40)}`).join('\n'),
  );
  const { truncatedFiles } = renderForPrompt(big, { maxCharsPerFile: 2000 });
  eq(truncatedFiles, 1);
});

test('renderForPrompt respects the total character budget', () => {
  const { text } = renderForPrompt(parsed, { maxTotalChars: 200 });
  assert(text.length < 2000, `got ${text.length}`);
});

/* ---------------------------------------------------------------- *
 * Per-agent diff scoping — the silent-miss bug
 * ---------------------------------------------------------------- */

const { runAudit } = awaitedAudit;

/** A PR big enough that a shared diff would be truncated. */
function bigDiffWithNativeFileLast() {
  let d = '';
  for (let i = 0; i < 40; i++) {
    d += `diff --git a/src/Screen${i}.tsx b/src/Screen${i}.tsx\n--- a/src/Screen${i}.tsx\n+++ b/src/Screen${i}.tsx\n@@ -1,1 +1,80 @@\n`;
    for (let j = 0; j < 80; j++) d += `+const v${j} = "${'y'.repeat(40)}";\n`;
  }
  d +=
    'diff --git a/android/src/main/java/com/x/FooModule.kt b/android/src/main/java/com/x/FooModule.kt\n' +
    '--- a/android/src/main/java/com/x/FooModule.kt\n+++ b/android/src/main/java/com/x/FooModule.kt\n' +
    '@@ -1,1 +1,3 @@\n+class FooModule : ReactContextBaseJavaModule() {\n+  @ReactMethod fun read(p: String) = File(p).readText()\n+}\n';
  return d;
}

test('a shared diff would drop the native file — the bug this guards', () => {
  // Reproduces the PR #6 miss: rn-native-modules reported 0 findings on a
  // deliberately broken .kt file because the shared diff was truncated first.
  const files = parseDiff(bigDiffWithNativeFileLast());
  const shared = renderForPrompt(files);
  assert(
    !shared.text.includes('FooModule.kt'),
    'fixture is no longer large enough to demonstrate truncation',
  );
});

await testAsync('each agent receives only the files that routed it', async () => {
  const files = parseDiff(bigDiffWithNativeFileLast());
  const { selected, matchedFiles } = route(changedFilePaths(files), agents);

  const seen = {};
  const llm = {
    calls: 0, inTokens: 0, outTokens: 0, spentUsd: 0,
    async complete({ user }) {
      this.calls += 1;
      return JSON.stringify({ findings: [], summary: '' });
    },
  };
  // Capture what each agent was actually shown.
  const spy = {
    ...llm,
    async complete(args) {
      seen[Object.keys(seen).length] = args.user;
      return llm.complete.call(llm, args);
    },
  };

  await runAudit({
    agents: selected,
    sharedContext: 'ctx',
    diffFiles: files,
    llm: spy,
    matchedFiles,
    log: () => {},
  });

  const nativeIndex = selected.findIndex((a) => a.id === 'rn-native-modules');
  assert(nativeIndex >= 0, 'native agent should have been routed');
  const nativePrompt = seen[nativeIndex];
  assert(
    nativePrompt.includes('FooModule.kt'),
    'the native agent must see native code even on a large PR — this is the silent-miss bug',
  );
});

await testAsync('scoping keeps unrelated files out of a specialist prompt', async () => {
  const files = parseDiff(bigDiffWithNativeFileLast());
  const { selected, matchedFiles } = route(changedFilePaths(files), agents);

  const prompts = [];
  await runAudit({
    agents: selected,
    sharedContext: 'ctx',
    diffFiles: files,
    matchedFiles,
    llm: {
      calls: 0, inTokens: 0, outTokens: 0, spentUsd: 0,
      async complete({ user }) { prompts.push(user); return '{"findings":[],"summary":""}'; },
    },
    log: () => {},
  });

  const nativeIndex = selected.findIndex((a) => a.id === 'rn-native-modules');
  const nativePrompt = prompts[nativeIndex];
  assert(!nativePrompt.includes('Screen1.tsx'), 'native agent should not receive React screens');
  assert(
    /outside your area/.test(nativePrompt),
    'the prompt should say other files went to other specialists, so silence is not misread',
  );
});

await testAsync('agents matched only by keyword still receive the full diff', async () => {
  // Some agents route on diff-body keywords rather than filenames; scoping must
  // not starve them of context.
  const files = parseDiff(SAMPLE_DIFF);
  const prompts = [];
  await runAudit({
    agents: [agents.find((a) => a.id === 'rn-security')],
    sharedContext: 'ctx',
    diffFiles: files,
    matchedFiles: {}, // no file matches recorded
    llm: {
      calls: 0, inTokens: 0, outTokens: 0, spentUsd: 0,
      async complete({ user }) { prompts.push(user); return '{"findings":[],"summary":""}'; },
    },
    log: () => {},
  });
  assert(prompts[0].includes('Feed.tsx'), 'fallback to the full diff when nothing was matched');
});

/* ---------------------------------------------------------------- *
 * Cost control
 * ---------------------------------------------------------------- */

test('token estimate scales with length', () => {
  assert(estimateTokens('x'.repeat(3500)) >= 900);
});

test('cost estimate is provider-aware', () => {
  const opus = estimateCost('claude-opus-5', 1e6, 0);
  const haiku = estimateCost('claude-haiku-4-5-20251001', 1e6, 0);
  assert(opus > haiku, 'opus should cost more than haiku');
});

test('unknown model falls back to default pricing', () => {
  assert(estimateCost('some-future-model', 1e6, 0) > 0);
});

test('wouldExceed blocks a call over budget', () => {
  const llm = new LLM({ provider: 'mock', apiKey: 'x', model: 'claude-opus-5', budgetUsd: 0.001 });
  assert(llm.wouldExceed('x'.repeat(100000)), 'should refuse');
});

await testAsync('budget cap throws BudgetExceededError rather than spending', async () => {
  const llm = new LLM({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5', budgetUsd: 0.0001 });
  let thrown = null;
  try {
    await llm.complete({ system: 'x'.repeat(50000), user: 'y'.repeat(50000) });
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof BudgetExceededError, `got ${thrown?.name}`);
  eq(llm.spentUsd, 0, 'must not have spent anything');
});

/* ---------------------------------------------------------------- *
 * Finding parsing — models are not reliably well-behaved
 * ---------------------------------------------------------------- */

test('parses clean JSON', () => {
  const r = parseFindings('{"findings":[{"severity":"P1","title":"X","file":"a.ts","line":3}],"summary":"s"}');
  eq(r.findings.length, 1);
  eq(r.findings[0].severity, 'P1');
});

test('recovers JSON from a markdown fence', () => {
  const r = parseFindings('```json\n{"findings":[{"severity":"P0","title":"Y","file":"a.ts","line":1}]}\n```');
  eq(r.findings.length, 1);
});

test('recovers JSON despite conversational preamble', () => {
  const r = parseFindings('Sure! Here is the result:\n{"findings":[{"severity":"P2","title":"Z"}]}');
  eq(r.findings.length, 1);
});

test('returns empty on unparseable output rather than throwing', () => {
  eq(parseFindings('I could not complete this review.').findings.length, 0);
  eq(parseFindings('').findings.length, 0);
  eq(parseFindings(null).findings.length, 0);
});

test('drops findings with no title', () => {
  eq(parseFindings('{"findings":[{"severity":"P1"},{"severity":"P1","title":"ok"}]}').findings.length, 1);
});

test('coerces an invalid severity to P2', () => {
  eq(parseFindings('{"findings":[{"severity":"CRITICAL","title":"x"}]}').findings[0].severity, 'P2');
});

test('normalizes a leading ./ in file paths', () => {
  eq(parseFindings('{"findings":[{"title":"x","file":"./src/a.ts"}]}').findings[0].file, 'src/a.ts');
});

test('rejects a non-integer line number', () => {
  eq(parseFindings('{"findings":[{"title":"x","line":"twelve"}]}').findings[0].line, null);
});

/* ---------------------------------------------------------------- *
 * Dedupe and gating
 * ---------------------------------------------------------------- */

test('dedupes the same issue found by two agents, keeping higher severity', () => {
  const out = dedupe([
    { severity: 'P2', title: 'Token stored in AsyncStorage unencrypted', file: 'a.ts', line: 5, agent: 'rn-code-quality' },
    { severity: 'P0', title: 'Token stored in AsyncStorage unencrypted', file: 'a.ts', line: 5, agent: 'rn-security' },
  ]);
  eq(out.length, 1);
  eq(out[0].severity, 'P0');
  eq(out[0].agent, 'rn-security');
  assert(out[0].alsoFlaggedBy.includes('rn-code-quality'), 'should record corroboration');
});

test('dedupe merges the same issue described in different words', () => {
  // Observed on PR #6: rn-release and rn-performance both flagged the undeclared
  // `budget-hit` output, worded differently and two lines apart, and both were
  // posted. Duplicate findings read as noise and erode trust in the whole report.
  const out = dedupe([
    { severity: 'P2', title: "Output 'budget-hit' is produced by the action but not declared in action.yml", file: 'action.yml', line: 92, agent: 'rn-release' },
    { severity: 'P3', title: 'Action sets a `budget-hit` output but it is not declared in action.yml outputs', file: 'action.yml', line: 95, agent: 'rn-performance' },
  ]);
  eq(out.length, 1, 'should merge into one finding');
  eq(out[0].severity, 'P2', 'keeps the higher severity');
  assert(out[0].alsoFlaggedBy.includes('rn-performance'), 'records corroboration');
});

test('dedupe does not merge across different files', () => {
  const out = dedupe([
    { severity: 'P2', title: 'Missing accessibility label', file: 'a.tsx', line: 5, agent: 'x' },
    { severity: 'P2', title: 'Missing accessibility label', file: 'b.tsx', line: 5, agent: 'y' },
  ]);
  eq(out.length, 2);
});

test('dedupe does not merge distant lines in the same file', () => {
  const out = dedupe([
    { severity: 'P2', title: 'Missing accessibility label on the button', file: 'a.tsx', line: 5, agent: 'x' },
    { severity: 'P2', title: 'Missing accessibility label on the button', file: 'a.tsx', line: 400, agent: 'y' },
  ]);
  eq(out.length, 2, 'the same defect in two places is two findings');
});

test('dedupe similarity ignores boilerplate words', () => {
  const { isSameIssue } = awaitedAudit;
  assert(
    !isSameIssue(
      { title: 'The action file should use the code', file: 'a', line: 1 },
      { title: 'This code file sets the action', file: 'a', line: 1 },
    ),
    'titles made only of stopwords must not be treated as the same issue',
  );
});

test('keeps genuinely different findings on the same line', () => {
  const out = dedupe([
    { severity: 'P2', title: 'Missing accessibility label', file: 'a.tsx', line: 5, agent: 'rn-ui-accessibility' },
    { severity: 'P2', title: 'Inline style object breaks memoisation', file: 'a.tsx', line: 5, agent: 'rn-performance' },
  ]);
  eq(out.length, 2);
});

test('counts by severity', () => {
  const c = countBySeverity([{ severity: 'P0' }, { severity: 'P0' }, { severity: 'P3' }]);
  eq(c.P0, 2);
  eq(c.P3, 1);
  eq(c.P1, 0);
});

test('gate fails on P0 when configured', () => {
  assert(gateFails([{ severity: 'P0' }], 'P0'));
  assert(!gateFails([{ severity: 'P1' }], 'P0'), 'P1 must not trip a P0 gate');
  assert(gateFails([{ severity: 'P0' }], 'P1'), 'P0 is worse than P1, should trip');
});

test('gate never fails when disabled', () => {
  assert(!gateFails([{ severity: 'P0' }], 'never'));
  assert(!gateFails([{ severity: 'P0' }], ''));
});

/* ---------------------------------------------------------------- *
 * Summary rendering
 * ---------------------------------------------------------------- */

const baseSummary = {
  perAgent: { 'rn-security': { findings: 1, summary: 'One issue.' } },
  usage: { calls: 1, inTokens: 1000, outTokens: 200, costUsd: 0.012 },
};

test('summary leads with the critical count when P0 exists', () => {
  const md = renderSummary({ ...baseSummary, findings: [{ severity: 'P0', title: 'X' }] });
  assert(md.includes('1 critical issue'), md.slice(0, 200));
});

test('summary says so plainly when clean', () => {
  const md = renderSummary({ ...baseSummary, findings: [] });
  assert(md.includes('No issues found'), md.slice(0, 200));
});

test('summary includes the cost line', () => {
  const md = renderSummary({ ...baseSummary, findings: [] });
  assert(md.includes('$0.012'), 'cost should be visible to the user');
});

test('summary surfaces findings that could not be placed inline', () => {
  const md = renderSummary({
    ...baseSummary,
    findings: [],
    unplaceable: [{ severity: 'P1', title: 'Orphan finding', file: 'a.ts', line: 2, why: 'w', fix: 'f' }],
  });
  assert(md.includes('Orphan finding'), 'unplaceable findings must not be silently lost');
});

test('summary reports budget exhaustion', () => {
  const md = renderSummary({ ...baseSummary, findings: [], budgetHit: true });
  assert(md.includes('Budget cap reached'), md);
});

test('summary reports the gate failure reason', () => {
  const md = renderSummary({ ...baseSummary, findings: [], gateFailed: true, failOn: 'P0' });
  assert(md.includes('fail-on: P0'), md);
});

/* ---------------------------------------------------------------- *
 * Project detection
 * ---------------------------------------------------------------- */

test('detects RN, Expo, router, and language', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnproj-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      dependencies: {
        'react-native': '0.85.0',
        expo: '~57.0.0',
        'expo-router': '^4.0.0',
        zustand: '^5.0.0',
      },
    }),
  );
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
  const ctx = detectProject(dir);
  eq(ctx.reactNative, '0.85.0');
  eq(ctx.router, 'expo-router');
  eq(ctx.language, 'TypeScript');
  eq(ctx.workflow, 'expo (managed)');
  assert(ctx.stateManagement.includes('zustand'));
});

test('detects bare workflow from native directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnbare-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'react-native': '0.85.0' } }));
  fs.mkdirSync(path.join(dir, 'ios'));
  fs.mkdirSync(path.join(dir, 'android'));
  eq(detectProject(dir).workflow, 'bare react-native');
});

test('project detection degrades gracefully with no package.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnempty-'));
  const ctx = detectProject(dir);
  assert(ctx.reactNative === undefined, 'must not invent a version');
});

/* ---------------------------------------------------------------- *
 * End-to-end through the CLI with the mock provider
 * ---------------------------------------------------------------- */

await testAsync('dry run routes without calling a model', async () => {
  const f = path.join(os.tmpdir(), 'rn-test.diff');
  fs.writeFileSync(f, SAMPLE_DIFF);
  const { stdout } = await run(['--diff-file', f, '--provider', 'mock', '--dry-run', 'true']);
  assert(stdout.includes('Routing to'), stdout);
  assert(stdout.includes('Dry run'), stdout);
});

await testAsync('full pipeline produces findings with the mock provider', async () => {
  const f = path.join(os.tmpdir(), 'rn-test2.diff');
  fs.writeFileSync(f, SAMPLE_DIFF);
  const { stdout } = await run(['--diff-file', f, '--provider', 'mock', '--workspace', ROOT]);
  assert(stdout.includes('Result'), stdout);
  assert(/P0 \d+  P1 \d+/.test(stdout), stdout);
  assert(stdout.includes('✓ Passed'), stdout);
});

await testAsync('fail-on gate exits non-zero when tripped', async () => {
  const f = path.join(os.tmpdir(), 'rn-test3.diff');
  fs.writeFileSync(f, SAMPLE_DIFF);
  // The mock emits P2 findings, so a P2 gate must fail the run.
  let code = 0;
  try {
    await run(['--diff-file', f, '--provider', 'mock', '--fail-on', 'P2', '--workspace', ROOT]);
  } catch (e) {
    code = e.code;
  }
  eq(code, 1, 'should exit 1 when the gate trips');
});

await testAsync('audit fails when every agent errors', async () => {
  // The bug this guards: all agents failing (bad key, no credits) produced zero
  // findings, which is indistinguishable from a clean diff — reported as ✓ Passed.
  const f = path.join(os.tmpdir(), 'rn-allfail.diff');
  fs.writeFileSync(f, SAMPLE_DIFF);
  let err = null;
  try {
    // A real provider with a junk key: every agent call fails.
    await run(
      ['--diff-file', f, '--provider', 'anthropic', '--api-key', 'sk-ant-invalid', '--workspace', ROOT],
      { ANTHROPIC_API_KEY: 'sk-ant-invalid' },
    );
  } catch (e) {
    err = e;
  }
  assert(err, 'must not exit 0 when nothing was actually reviewed');
  assert(
    /reviewed nothing|agent\(s\) failed|errored/i.test(err.stdout + err.stderr),
    `expected an explicit failure message, got: ${(err.stdout + err.stderr).slice(-300)}`,
  );
});

await testAsync('fail-on-error can be disabled for partial coverage', async () => {
  const f = path.join(os.tmpdir(), 'rn-partial.diff');
  fs.writeFileSync(f, SAMPLE_DIFF);
  // The mock provider succeeds, so this asserts the flag parses and the normal
  // path is unaffected.
  const { stdout } = await run([
    '--diff-file', f, '--provider', 'mock', '--fail-on-error', 'false', '--workspace', ROOT,
  ]);
  assert(/Passed/.test(stdout), stdout.slice(-200));
});

test('action.yml exposes fail-on-error and wires it through', () => {
  assert(/fail-on-error:/.test(actionYml), 'input missing');
  assert(/INPUT_FAIL_ON_ERROR/.test(actionYml), 'env wiring missing');
  assert(/default:\s*'true'/.test(actionYml), 'must default to failing on error');
});

await testAsync('empty diff exits cleanly', async () => {
  const f = path.join(os.tmpdir(), 'rn-empty.diff');
  fs.writeFileSync(f, '');
  const { stdout } = await run(['--diff-file', f, '--provider', 'mock']);
  assert(stdout.includes('Nothing to review'), stdout);
});

await testAsync('missing API key fails fast with a clear message', async () => {
  const f = path.join(os.tmpdir(), 'rn-test4.diff');
  fs.writeFileSync(f, SAMPLE_DIFF);
  let err = null;
  try {
    await run(['--diff-file', f, '--provider', 'anthropic'], { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' });
  } catch (e) {
    err = e;
  }
  assert(err && /No API key/.test(err.stderr), `got: ${err?.stderr}`);
});

/* ---------------------------------------------------------------- *
 * Action manifest
 * ---------------------------------------------------------------- */


test('action.yml declares every input the entrypoint reads', () => {
  for (const i of ['api-key', 'provider', 'model', 'agents', 'budget-usd', 'fail-on', 'github-token']) {
    assert(actionYml.includes(`${i}:`), `missing input: ${i}`);
  }
});

test('action.yml wires each input into an INPUT_ env var', () => {
  for (const e of ['INPUT_API_KEY', 'INPUT_PROVIDER', 'INPUT_BUDGET_USD', 'INPUT_FAIL_ON']) {
    assert(actionYml.includes(e), `missing env: ${e}`);
  }
});

test('action.yml is a composite action using action_path', () => {
  assert(actionYml.includes('using: composite'));
  assert(actionYml.includes('github.action_path'), 'must resolve scripts relative to the action');
});

test('example workflow requests pull-requests: write', () => {
  const wf = fs.readFileSync(path.join(HERE, 'examples/rn-audit.yml'), 'utf8');
  assert(wf.includes('pull-requests: write'), 'cannot post comments without this');
  assert(wf.includes('concurrency:'), 'should cancel superseded runs to avoid wasted spend');
});

/* ---------------------------------------------------------------- */

console.log('\n');
if (failures.length) {
  console.log('\x1b[31mFailures:\x1b[0m\n');
  for (const f of failures) {
    console.log(`  \x1b[31m✗\x1b[0m ${f.name}`);
    console.log(`    ${f.err.message}\n`);
  }
}
console.log(
  failures.length === 0
    ? `\x1b[32m✓ ${passed} passed\x1b[0m\n`
    : `\x1b[31m✗ ${failures.length} failed\x1b[0m, ${passed} passed\n`,
);
process.exit(failures.length === 0 ? 0 : 1);

function run(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [path.join(HERE, 'index.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`exit ${code}`), { code, stdout, stderr }));
    });
  });
}
