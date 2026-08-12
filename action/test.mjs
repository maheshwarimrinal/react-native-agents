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
const { parseFindings, dedupe, countBySeverity, gateFails } = await import('./lib/audit.mjs');
const { renderSummary } = await import('./lib/github.mjs');
const { detectProject } = await import('./index.mjs');
const { loadAgents } = await import('../scripts/lib/source.mjs');

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

const actionYml = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8');

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
