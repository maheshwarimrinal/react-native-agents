#!/usr/bin/env node
/**
 * Validation suite. Zero dependencies — uses node:test.
 *
 *   node scripts/test.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { loadAgents, loadSharedContext, parseFrontmatter, serializeFrontmatter, KNOWLEDGE, VERSION, knowledgeAgeDays } =
  await import(path.join(ROOT, 'scripts/lib/source.mjs'));
const { plan, apply, isUserOwned, summarise } = await import(path.join(ROOT, 'scripts/lib/install.mjs'));
const { scoreAgents, explainRouting, SIGNALS } = await import(path.join(ROOT, 'mcp-server/routing.mjs'));
/**
 * Terms that look like stems to the heuristic above but are deliberately whole
 * words — marking them would over-match ('spec' → 'specific', 'orient' →
 * screen 'orientation').
 */
const KNOWN_WHOLE_WORDS = new Set(['spec', 'orient', 'i18n', 'newarch', 'nx']);

const { telemetryState, consentState, sanitise, capture, ALLOWED_PROPERTIES } = await import(
  path.join(ROOT, 'scripts/lib/telemetry.mjs')
);
const { loadCases, scoreOutput, scannableText, classifyFailure, validate: validateCases, undefinedCalls, stripCommentsAndStrings, gateReasons, DEFAULT_MIN_PASS_RATE, splitClauses, containsWholeTerm, isQuestionCase } = await import(
  path.join(ROOT, 'evals/run.mjs')
);
const os = await import('node:os');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
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
    failed++;
    failures.push({ name, err });
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

function eq(a, b, msg) {
  if (a !== b) {
    throw new Error(`${msg ?? 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
}

/* ---------------------------------------------------------------- *
 * Frontmatter parser
 * ---------------------------------------------------------------- */

test('parses scalars, booleans, numbers', () => {
  const { data } = parseFrontmatter('---\nid: x\nalwaysApply: true\nn: 42\n---\nbody');
  assert(data.id === 'x', 'string');
  assert(data.alwaysApply === true, 'boolean');
  assert(data.n === 42, 'number');
});

test('parses block lists', () => {
  const { data } = parseFrontmatter('---\ntools:\n  - Read\n  - Grep\n---\n');
  assert(Array.isArray(data.tools) && data.tools.length === 2, 'block list');
});

test('parses flow lists', () => {
  const { data } = parseFrontmatter('---\ntools: [Read, Grep, Bash]\n---\n');
  assert(data.tools.length === 3 && data.tools[2] === 'Bash', 'flow list');
});

test('strips quotes', () => {
  const { data } = parseFrontmatter('---\nemoji: "⚡"\n---\n');
  assert(data.emoji === '⚡', 'quoted string');
});

test('separates body from frontmatter', () => {
  const { body } = parseFrontmatter('---\nid: x\n---\n# Heading\n\ntext');
  assert(body.startsWith('# Heading'), `body was: ${JSON.stringify(body.slice(0, 40))}`);
});

test('round-trips through serialize', () => {
  const input = { id: 'a', tools: ['Read', 'Grep'], alwaysApply: false, n: 3 };
  const { data } = parseFrontmatter(`${serializeFrontmatter(input)}body`);
  assert(data.id === 'a' && data.tools.length === 2 && data.n === 3, 'round trip');
  // alwaysApply: false is preserved
  assert(data.alwaysApply === false, 'false preserved');
});

test('handles content with no frontmatter', () => {
  const { data, body } = parseFrontmatter('# Just markdown');
  assert(Object.keys(data).length === 0 && body === '# Just markdown', 'passthrough');
});

/* ---------------------------------------------------------------- *
 * Agent sources
 * ---------------------------------------------------------------- */

const agents = loadAgents();
const shared = loadSharedContext();

test('loads at least six agents', () => assert(agents.length >= 6, `got ${agents.length}`));
test('shared context is non-trivial', () => assert(shared.length > 500, `got ${shared.length} chars`));

for (const a of agents) {
  test(`${a.id}: has required frontmatter`, () => {
    for (const f of ['id', 'name', 'description', 'version']) {
      assert(a[f], `missing ${f}`);
    }
  });

  test(`${a.id}: id is kebab-case and rn-prefixed`, () =>
    assert(/^rn-[a-z0-9-]+$/.test(a.id), `bad id: ${a.id}`));

  test(`${a.id}: description is descriptive enough to route on`, () =>
    assert(a.description.length >= 60, `description too short (${a.description.length})`));

  test(`${a.id}: body is substantial`, () =>
    assert(a.body.length > 1200, `body only ${a.body.length} chars`));

  test(`${a.id}: declares tools`, () =>
    assert(Array.isArray(a.tools) && a.tools.length > 0, 'no tools'));

  test(`${a.id}: has reference files`, () =>
    assert(a.references.length >= 3, `only ${a.references.length} references`));

  test(`${a.id}: declared references all exist on disk`, () => {
    const actual = a.references.map((r) => r.slug);
    for (const d of a.references.length ? (a.references, []) : []) void d;
    for (const declared of Array.isArray(a.referencesDeclared) ? a.referencesDeclared : []) {
      assert(actual.includes(declared), `missing ${declared}`);
    }
  });

  for (const r of a.references) {
    test(`${a.id}/${r.slug}: reference has a heading and content`, () => {
      assert(r.content.startsWith('#'), 'no top-level heading');
      assert(r.content.length > 800, `only ${r.content.length} chars`);
    });
  }

  test(`${a.id}: no unresolved authoring placeholders`, () => {
    // Note: `{{count}}` style braces are legitimate here (i18n interpolation
    // examples), so only genuine authoring markers are flagged.
    //
    // Code samples are stripped before matching. These tokens are legitimate
    // *content* in a shell or JS example — `test.todo` is a real Jest API, and
    // a grep pattern that searches for FIXME is not itself a FIXME. Checking
    // prose only keeps the guard meaningful without punishing accurate code.
    const all = [a.body, ...a.references.map((r) => r.content)].join('\n');
    const prose = all
      .replace(/```[\s\S]*?```/g, '')  // fenced blocks
      .replace(/`[^`\n]*`/g, '');       // inline code
    const m = prose.match(/\b(TODO|FIXME|XXX|TBD)\b|<placeholder>/i);
    assert(!m, `contains: ${m?.[0]}`);
  });

  test(`${a.id}: no non-ASCII stray characters in prose`, () => {
    // Allow common typography and the agent emoji; catch accidental CJK etc.
    const all = [a.body, ...a.references.map((r) => r.content)].join('\n');
    const stray = all.match(/[\u3000-\u9fff\uac00-\ud7af]/g);
    assert(!stray, `found: ${stray?.slice(0, 5).join(' ')}`);
  });
}

test('.gitignore does not hide any generated dist output', () => {
  // `.claude/` was added to ignore the local skills directory. Unanchored, it
  // also matches `dist/claude-code/.claude/` — so an entire target's generated
  // output became invisible to `git add`, and a release would have shipped a
  // dist tree missing the newest agent. Anchor root-level entries with a
  // leading slash.
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const offenders = gitignore
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    .filter((l) => !l.startsWith('/') && !l.includes('*'))
    // A bare `foo/` or `foo` in .gitignore matches at every depth, so it can
    // reach inside dist/. Anything that names a directory that exists under
    // dist/ must be anchored.
    .filter((l) => {
      const bare = l.replace(/\/$/, '');
      if (!bare || bare.includes('/')) return false;
      let found = false;
      const walk = (dir, depth) => {
        if (found || depth > 4) return;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (e.name === bare) {
            found = true;
            return;
          }
          walk(path.join(dir, e.name), depth + 1);
        }
      };
      walk(path.join(ROOT, 'dist'), 0);
      return found;
    });

  assert(
    offenders.length === 0,
    `unanchored .gitignore entries that also match inside dist/: ${offenders.join(', ')} ` +
      '— prefix with "/" to scope them to the repository root',
  );
});

test('no stray CJK characters anywhere in the repository source', () => {
  // The per-agent sweep above covers agent prose only. Twice now a stray CJK
  // character has been typed into a *source* file instead — once into the
  // `legacy architecture` regex in this very file, where it silently narrowed a
  // guard and nothing could see it. Source is scanned too. (Both sweeps write
  // their ranges as \\u escapes so they do not flag themselves.)
  const roots = ['scripts', 'action', 'mcp', 'evals'];
  const CJK = /[\u3000-\u9fff\uac00-\ud7af]/g;
  const hits = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        walk(full);
        continue;
      }
      if (!/\.(mjs|js|ts|tsx|json)$/.test(e.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      const found = text.match(CJK);
      if (found) hits.push(`${path.relative(ROOT, full)}: ${[...new Set(found)].slice(0, 5).join(' ')}`);
    }
  };

  for (const r of roots) walk(path.join(ROOT, r));
  assert(hits.length === 0, `stray CJK in source:\n    ${hits.join('\n    ')}`);
});

test('scoring reads the findings, not the JSON envelope they arrived in', () => {
  // scoreOutput used to receive the raw response. For a structured case that is
  // a fenced JSON document, so patterns matched key names and syntax rather than
  // advice — one real run reported a violation whose evidence was a ```json blob.
  const parsed = {
    findings: [
      { severity: 'P0', title: 'Token stored in plaintext', why: 'AsyncStorage is not encrypted', fix: 'Use Keychain' },
    ],
    summary: 'One critical issue.',
  };
  const raw = '```json\n' + JSON.stringify({ findings: parsed.findings }, null, 2) + '\n```';

  const text = scannableText(raw, parsed, false);
  assert(text.includes('Token stored in plaintext'), 'the title must be scored');
  assert(text.includes('AsyncStorage is not encrypted'), 'the why must be scored');
  assert(text.includes('Use Keychain'), 'the fix must be scored');
  assert(text.includes('One critical issue.'), 'the summary must be scored');

  // The envelope is gone.
  for (const noise of ['```json', '"findings"', '"severity"', '"title":', '"fix":']) {
    assert(!text.includes(noise), `envelope leaked into the haystack: ${noise}`);
  }

  // Concretely: an expect term naming a JSON field no longer passes for free.
  const def = { expect: [{ name: 'mentions a severity field', any: ['"severity"'] }], forbid: [] };
  assert(
    scoreOutput(text, def).expectPassed === 0,
    'a JSON field name must not satisfy an expectation',
  );
  assert(raw.includes('"severity"'), 'fixture sanity: the field name is in the envelope');
  assert(
    scoreOutput(raw.toLowerCase(), def).expectPassed === 1,
    'sanity: the raw envelope is exactly what used to satisfy it',
  );
});

test('a prose answer is still scored on its raw text', () => {
  // Question-style cases have no findings array. Routing them through the
  // findings extractor would score them against an empty string and pass
  // everything vacuously.
  const raw = 'You should migrate to TanStack Query, but it is not free.';
  eq(scannableText(raw, { findings: [], summary: '' }, true), raw);
});

test('a structured response with no findings scores as empty, not as its envelope', () => {
  // The clean-case path. If an empty findings array fell back to the raw text,
  // every clean case would be scored against the JSON that says it found
  // nothing — and `"findings": []` contains the word "findings".
  const raw = '```json\n{"findings": [], "summary": "No issues found."}\n```';
  const text = scannableText(raw, { findings: [], summary: 'No issues found.' }, false);
  eq(text, 'No issues found.');
  assert(!text.includes('findings'), 'the envelope must not leak on the empty path');
});

test('findings keep their order so "leads with" rules still work', () => {
  const parsed = {
    findings: [
      { severity: 'P1', title: 'Server state in the client store' },
      { severity: 'P0', title: 'Token stored in plaintext' },
    ],
    summary: '',
  };
  const text = scannableText('', parsed, false);
  assert(
    text.indexOf('Server state') < text.indexOf('Token stored'),
    'order must be preserved for ordering-sensitive rules',
  );
});

test('a failed case is classified by what actually went wrong', () => {
  // Every failure used to be reported as "missed expected findings". One real
  // run listed state/server-state-in-store at 6/6 under that heading — it had
  // matched everything and failed on a forbid rule.
  const mk = (o) => ({ pass: false, score: { expectPassed: 0, expectTotal: 0, violations: [] }, ...o });

  eq(classifyFailure(mk({ error: 'invalid JSON' })), 'errored');

  eq(
    classifyFailure(mk({ score: { expectPassed: 6, expectTotal: 6, violations: [{ name: 'x' }] } })),
    'violation',
    'complete answer + forbidden advice is not a miss',
  );

  eq(
    classifyFailure(mk({ score: { expectPassed: 3, expectTotal: 6, violations: [{ name: 'x' }] } })),
    'violation-and-missed',
    'incomplete AND forbidden is both, and must still appear in the missed list',
  );

  eq(
    classifyFailure(mk({ score: { expectPassed: 3, expectTotal: 6, violations: [] } })),
    'missed',
  );

  // A clean case has no expectations at all; a violation there is still a
  // violation, not a miss of zero things.
  eq(
    classifyFailure(mk({ score: { expectPassed: 0, expectTotal: 0, violations: [{ name: 'x' }] } })),
    'violation',
  );

  // An error outranks everything — nothing else was scored.
  eq(
    classifyFailure(mk({ error: 'timeout', score: { expectPassed: 0, expectTotal: 6, violations: [{ name: 'x' }] } })),
    'errored',
  );

  eq(classifyFailure({ pass: true }), null, 'a passing case has no failure class');
});

test('unlessAnywhere excuses a document-scoped claim, and only that', () => {
  // Two rules assert an absence across the WHOLE answer ("without mentioning
  // migration at all"), but their exception was clause-scoped — so they fired on
  // answers that discussed migration one sentence later.
  const rule = {
    name: 'recommends the swap without mentioning migration at all',
    all: ['mmkv'],
    unlessAnywhere: '\\bmigrat\\w+',
  };
  const caught = (t) => scoreOutput(t, { forbid: [rule] }).violations.length > 0;

  assert(caught('Swap AsyncStorage for MMKV.'), 'a bare recommendation is still a violation');
  assert(
    !caught('Swap AsyncStorage for MMKV. Note that you must migrate the existing data first.'),
    'the cost discussed a sentence later must excuse it',
  );
  // Clause scope would NOT have excused that — this is the whole point.
  const clauseScoped = { ...rule, unlessAnywhere: undefined, unlessPattern: '\\bmigrat\\w+' };
  assert(
    scoreOutput('Swap AsyncStorage for MMKV. Note that you must migrate the existing data first.', {
      forbid: [clauseScoped],
    }).violations.length > 0,
    'sanity: clause scope is what was producing the false positive',
  );
});

test('unlessAnywhere cannot be bolted onto a specific pattern', () => {
  // Document scope is a real widening. Combining it with an already-precise
  // pattern is how "a legitimate word anywhere excuses everything" comes back —
  // the exact failure `unless` was removed for.
  // loadCases expects <root>/<agent>/<case>/case.json.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-scope-'));
  const caseDir = path.join(dir, 'security', 'demo');
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(path.join(caseDir, 'input.tsx'), 'export const A = 1;\n');
  fs.writeFileSync(
    path.join(caseDir, 'case.json'),
    JSON.stringify({
      agent: 'rn-security',
      title: 'scope check',
      expect: [],
      forbid: [
        { name: 'bad', pattern: 'store the token', unlessAnywhere: 'keychain' },
        { name: 'both', all: ['mmkv'], unlessPattern: 'migrat', unlessAnywhere: 'migrat' },
      ],
    }),
  );

  const problems = validateCases(loadCases(dir), agents);
  assert(
    problems.some((p) => /combines a specific "pattern"/.test(p)),
    `pattern + unlessAnywhere must be rejected: ${problems.join(' | ')}`,
  );
  assert(
    problems.some((p) => /pick one scope/.test(p)),
    `both scopes at once must be rejected: ${problems.join(' | ')}`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tightened forbid rules still catch the advice they exist for', () => {
  // Each of these fired against a correct answer in a real run. Tightening a
  // rule is only safe if the bad advice is still caught — otherwise the fix is
  // just the rule giving up.
  const load = (c) => JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', c, 'case.json'), 'utf8'));
  const ruleOf = (c, n) => {
    const r = load(c).forbid.find((f) => f.name === n);
    assert(r, `${c}: rule "${n}" not found`);
    return r;
  };
  const check = (rule, bad, good) => {
    const caught = (t) => scoreOutput(t.toLowerCase(), { forbid: [rule] }).violations.length > 0;
    assert(caught(bad), `should still catch: ${bad}`);
    assert(!caught(good), `should no longer fire on: ${good}`);
  };

  check(
    ruleOf('observability/proguard-strips-sdk', 'blames the iOS side when the failure is Android-only'),
    'The missing dSYM upload is the cause of the empty crash list.',
    // Deliberately carries NO qualifier the unlessPattern could catch: a bare,
    // neutral mention of the iOS pipeline. The first version of this test used
    // "iOS crash reporting is unaffected", which the widened unlessPattern
    // excused all by itself — so reverting the pattern to `dsym|ios (crash|
    // symbolicat)` left the test green and proved nothing.
    'Compare the behaviour with the dSYM pipeline on iOS to see the difference.',
  );

  check(
    ruleOf('release/missing-sourcemaps', 'treats attaching the map as an artifact as sufficient'),
    'Source maps are handled — the workflow already attaches them.',
    'The source maps are uploaded to Sentry as part of the release step, which is what symbolication needs.',
  );

  check(
    ruleOf('permissions/blocked-treated-as-denied', 'recommends re-requesting on mount or on every launch'),
    'You should call request() on mount so the user sees the prompt again.',
    // Plain description of the existing code, with no qualifier for the
    // unlessPattern to catch — so this isolates the pattern change. The earlier
    // version said "is currently requested on launch", and `currently` in the
    // exception list excused it whichever pattern was in force.
    'The code requests the permission on mount.',
  );

  check(
    ruleOf('monorepo/duplicate-react', 'recommends deleting node_modules as the first step'),
    'Start by running rm -rf node_modules and reinstalling.',
    'First confirm the duplicate with npm ls react and inspect the resolved paths. ' +
      'That tells you which package pulled the second copy. '.repeat(12) +
      'Only then rm -rf node_modules and reinstall.',
  );

  check(
    ruleOf('background/load-bearing-sync', 'recommends a foreground service to make polling reliable'),
    'Use a foreground service so the sync runs reliably.',
    'A foreground service is only appropriate for work the user can see, such as navigation.',
  );
});

test('the fixture scanner sees calls through a namespace object', () => {
  // evals/state/clean-auth-store called SecureStore.deleteItemAsync with no
  // import, and --validate passed it. The call scan skipped anything preceded by
  // a dot — correct for the *method*, but it meant the receiver was never
  // checked at all. A clean case asserts there is nothing to report, so a
  // fixture that does not compile penalises every model that reads it properly.
  const src = "export async function logout() {\n  await SecureStore.deleteItemAsync('t');\n}\n";
  assert(undefinedCalls(src, 'input.ts').includes('SecureStore'), 'undefined namespace must be reported');

  const withImport = `import * as SecureStore from 'expo-secure-store';\n${src}`;
  eq(undefinedCalls(withImport, 'input.ts').length, 0, 'a namespace import must satisfy it');
});

test('the fixture scanner ignores call-shaped prose in comments and strings', () => {
  // Nine of the fourteen findings on the first run of the member-call scan were
  // English sentences: "…the sheet is gone. Cancelling on unmount (…" parses as
  // gone.Cancelling(.
  const src = [
    '// The spring is gone. Cancelling on unmount (see below) is what matters.',
    '/* Compare with Foo.bar() in the other file. */',
    'const msg = "call Baz.qux() to reset";',
    'export const ok = 1;',
  ].join('\n');
  eq(undefinedCalls(src, 'input.ts').join(), '', `no prose should be reported: ${undefinedCalls(src, 'input.ts')}`);

  // Real code next to that prose is still checked.
  eq(undefinedCalls(`${src}\nMissingNs.go();\n`, 'input.ts').join(), 'MissingNs');
});

test('stripping preserves line structure', () => {
  // Replacing with spaces rather than deleting keeps offsets stable, so a
  // reported identifier still lines up with the source.
  const src = 'const a = 1; // note\nconst b = "x";\n';
  const out = stripCommentsAndStrings(src);
  eq(out.length, src.length, 'length must be preserved');
  eq(out.split('\n').length, src.split('\n').length, 'line count must be preserved');
  assert(out.includes('const a = 1;'), 'code survives');
  assert(!out.includes('note'), 'comment text is gone');
});

test('destructured callback params and namespace imports both count as bindings', () => {
  eq(undefinedCalls("Linking.addEventListener('url', ({ url }) => url.split('/'));\nconst Linking = {};\n", 'input.ts').join(), '');
});

test('a forbid rule does not fire on the correct answer naming the failure mode', () => {
  // "claims a promise can go unsettled" triggered on the bare word `hang`, with
  // no exception at all. A correct review of a correct TurboModule names the
  // failure mode precisely in order to rule it out — so the suite was punishing
  // the answer it wanted.
  const rule = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'evals/native-modules/clean-turbomodule/case.json'), 'utf8'),
  ).forbid.find((f) => f.name.includes('unsettled'));
  const caught = (t) => scoreOutput(t.toLowerCase(), { forbid: [rule] }).violations.length > 0;

  assert(caught('If the native side throws, the promise can hang forever.'), 'the real claim is caught');
  assert(caught('This will never resolve when the bridge is busy.'), 'the paraphrase is caught');

  for (const correct of [
    'Every path settles the promise, so it cannot hang.',
    'There is no path that leaves the promise unsettled.',
    'Both the resolve and reject branches are covered; the promise never hangs.',
  ]) {
    assert(!caught(correct), `must not fire on a correct answer: ${correct}`);
  }
});

test('an exception is no narrower than the expectation it mirrors', () => {
  // dependencies/deprecated-storage-swap expects "raises data migration for
  // existing users" and forbids "recommends the swap without mentioning
  // migration at all" — the same concept, asserted twice. Their vocabularies had
  // drifted: the model said "existing users", which satisfied the expectation
  // and did NOT excuse the violation, so one case reported both that the model
  // raised migration and that it never mentioned it.
  //
  // The pairs are listed explicitly. There are two, and inferring the link from
  // rule names would be guesswork of exactly the kind this suite keeps removing.
  const pairs = [
    {
      case: 'dependencies/deprecated-storage-swap',
      expect: 'raises data migration for existing users',
      forbid: 'recommends the swap without mentioning migration at all',
    },
    {
      case: 'state/server-state-in-store',
      expect: null, // no mirrored expectation; the exception stands alone
      forbid: 'presents the server-state migration as free',
    },
    {
      case: 'animation/stale-worklet-closure',
      expect: 'identifies the empty dependency array as what pins the captured values',
      forbid: 'treats the wrong-item symptom as a list keying bug without the closure',
    },
  ];

  for (const pair of pairs) {
    if (!pair.expect) continue;
    const def = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'evals', pair.case, 'case.json'), 'utf8'),
    );
    const e = def.expect.find((x) => x.name === pair.expect);
    const f = def.forbid.find((x) => x.name === pair.forbid);
    assert(e && f, `${pair.case}: pair not found`);
    const exception = new RegExp(f.unlessAnywhere ?? f.unlessPattern, 'i');

    for (const term of e.any ?? []) {
      assert(
        exception.test(term),
        `${pair.case}: "${term}" satisfies the expectation "${pair.expect}" but does not ` +
          `excuse "${pair.forbid}" — the case would report both at once`,
      );
    }
  }
});

test('README documents every agent and states the right counts', () => {
  // The README said "Ten expert AI agents" and "57 reference documents" while
  // the collection was 21 and 113. Docs drift silently; this makes it fail loudly.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  const undocumented = agents.filter((a) => !readme.includes(`\`/${a.command}\``)).map((a) => a.id);
  assert(undocumented.length === 0, `not in the README table: ${undocumented.join(', ')}`);

  const refCount = agents.reduce((n, a) => n + a.references.length, 0);
  assert(
    readme.includes(`${agents.length} playbooks`),
    `README should say "${agents.length} playbooks"`,
  );
  assert(
    readme.includes(`${refCount} reference documents`),
    `README should say "${refCount} reference documents"`,
  );
});

test('README lists exactly the agents excluded from PR routing', () => {
  // The claim "Doctor and Build are excluded" stayed in the README after four
  // more interactive agents were added.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const interactive = agents.filter((a) => a.mode === 'interactive');

  for (const a of interactive) {
    const title = a.title.replace(/^RN /, '');
    assert(
      new RegExp(`\\*\\*[^*]*\\b${title}\\b[^*]*\\*\\*`, 'i').test(readme),
      `${a.id} is interactive but not named in the README's excluded list`,
    );
  }
});

test('generated marketplace and plugin metadata state the real agent count', () => {
  // These said "Six specialist React Native agents" at 21 agents, across three
  // releases, because they were literals in the generator that nothing checked.
  for (const rel of [
    'dist/claude-code/.claude-plugin/marketplace.json',
    'dist/claude-code/plugins/react-native-agents/.claude-plugin/plugin.json',
  ]) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const json = JSON.parse(fs.readFileSync(full, 'utf8'));
    const descriptions = [json.description, json.metadata?.description, json.plugins?.[0]?.description]
      .filter(Boolean);
    assert(descriptions.length > 0, `${rel} has no description`);
    for (const d of descriptions) {
      assert(
        new RegExp(`\\b${agents.length}\\b`).test(d),
        `${rel} should state ${agents.length} agents: ${d.slice(0, 70)}...`,
      );
    }
  }
});

test('package.json description states the real agent count', () => {
  // The description claimed ten areas at 21 agents, and an earlier fix to it
  // silently no-opped. A count in prose is exactly the thing that goes stale.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    new RegExp(`\\b${agents.length}\\b`).test(pkg.description),
    `description should state ${agents.length} agents: ${pkg.description.slice(0, 80)}...`,
  );
});

test('package.json keywords cover the agent domains', () => {
  // npm discovery runs on keywords. An agent nobody can find is an agent
  // nobody uses.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const haystack = `${pkg.description} ${pkg.keywords.join(' ')}`.toLowerCase();
  const required = [
    'upgrade', 'debug', 'dependenc', 'navigation', 'offline', 'push',
    'permission', 'state', 'parity', 'onboarding', 'store',
    'performance', 'security', 'accessibility', 'observability', 'release',
  ];
  const missing = required.filter((k) => !haystack.includes(k));
  assert(missing.length === 0, `not discoverable: ${missing.join(', ')}`);
});

test('docs pin the action to the floating major tag, not a stale version', () => {
  // Four places pinned @v1.1.0 and were still pinned there at 1.2.0. A hard
  // version in docs goes stale on every release; @v1 does not.
  //
  // action/examples/ ships inside the npm package, so a stale pin there sends
  // real users to an older Action — it was missed because this test only
  // looked at docs.
  const shipped = fs.existsSync(path.join(ROOT, 'action/examples'))
    ? fs.readdirSync(path.join(ROOT, 'action/examples')).map((f) => `action/examples/${f}`)
    : [];
  for (const rel of ['README.md', 'docs/github-action.md', ...shipped]) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const stale = fs.readFileSync(full, 'utf8').match(/react-native-agents@v\d+\.\d+\.\d+/g);
    assert(!stale, `${rel} pins a stale version: ${stale?.join(', ')}`);
  }
});

test('docs/agents.md documents every agent', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/agents.md'), 'utf8');
  const missing = agents.filter((a) => !doc.includes(`\`${a.id}\``)).map((a) => a.id);
  assert(missing.length === 0, `undocumented in docs/agents.md: ${missing.join(', ')}`);
});

// A large share of React Native projects are JavaScript, and an agent whose
// globs or audit commands only reach TypeScript is invisible in them. This was
// the single most common finding across two rounds of review.
const TS_ONLY_BY_DESIGN = new Set([
  // Codegen requires TypeScript spec files — `NativeFoo.ts`, `FooSpec.ts` —
  // so these globs are correctly TypeScript-only.
  'rn-native-modules',
]);

for (const a of agents) {
  test(`${a.id}: globs reach JavaScript projects`, () => {
    if (TS_ONLY_BY_DESIGN.has(a.id)) return;
    const globs = (a.globs ?? []).join(' ');
    const mentionsTs = /\bts\b|\.ts|tsx/.test(globs);
    if (!mentionsTs) return; // native/config-only agents are fine
    assert(
      /\bjs\b|\.js|jsx/.test(globs),
      `globs cover TypeScript but not JavaScript: ${(a.globs ?? []).join(', ')}`,
    );
  });

  test(`${a.id}: audit commands do not exclude JavaScript`, () => {
    const all = [a.body, ...a.references.map((r) => r.content)].join('\n');
    const bad = all.match(/--glob ["'][^"']*\{ts,tsx\}["']|--type ts\b|--glob ["']\*\*\/\*\.tsx["']/g);
    assert(!bad, `ripgrep examples exclude .js/.jsx: ${[...new Set(bad ?? [])].join(', ')}`);
  });
}

/* ------------------------------------------------------------------ *
 * Telemetry — the tests that matter are the ones proving it does nothing
 * unless asked, and cannot carry personal data if it does.
 * ------------------------------------------------------------------ */

test('telemetry is off by default', () => {
  // No config, no env vars — the state a first-time user is in.
  // Asserted against consentState so it holds regardless of whether this
  // build has a key configured.
  const state = consentState({}, {});
  assert(!state.enabled, `should be off by default, got: ${state.reason}`);
  assert(!telemetryState({}, {}).enabled, 'and off end to end');
});

test('telemetry stays off when the user has not opted in', () => {
  for (const config of [{}, { installId: 'x' }, { telemetryNoticeShown: true }]) {
    assert(!consentState({}, config).enabled, JSON.stringify(config));
  }
});

test('DO_NOT_TRACK overrides an explicit opt-in', () => {
  // Any signal that says no wins. There must be no combination where a user
  // who set DO_NOT_TRACK still gets tracked.
  for (const env of [{ DO_NOT_TRACK: '1' }, { DO_NOT_TRACK: 'true' }]) {
    // consentState, not telemetryState: with no key configured the latter
    // short-circuits and would pass without testing the rule at all.
    const state = consentState(env, { telemetry: true });
    assert(!state.enabled, `DO_NOT_TRACK should win, got: ${state.reason}`);
    assert(state.reason.includes('DO_NOT_TRACK'), `for the right reason, got: ${state.reason}`);
  }
});

test('RN_AGENTS_TELEMETRY=0 overrides an opt-in config', () => {
  const state = consentState({ RN_AGENTS_TELEMETRY: '0' }, { telemetry: true });
  assert(!state.enabled, state.reason);
  assert(state.reason.includes('RN_AGENTS_TELEMETRY'), `for the right reason, got: ${state.reason}`);
});

test('an explicit opt-in is actually honoured', () => {
  // The mirror of the DO_NOT_TRACK test. Without this, "always returns false"
  // would pass every consent test on this page.
  assert(consentState({}, { telemetry: true }).enabled, 'config opt-in should enable');
  assert(consentState({ RN_AGENTS_TELEMETRY: '1' }, {}).enabled, 'env opt-in should enable');
});

test('sanitise drops everything not on the allow-list', () => {
  const dirty = {
    surface: 'cli',
    tool: 'cursor',
    // None of these should survive.
    projectName: 'acme-banking',
    repo: 'acme/mobile',
    cwd: '/Users/sam/code/acme',
    email: 'sam@example.com',
    errorMessage: 'ENOENT: no such file',
    stack: 'at Object.<anonymous>',
    userName: 'sam',
  };
  const clean = sanitise(dirty);

  const kept = Object.keys(clean).sort().join(',');
  assert(kept === 'surface,tool', `only surface,tool should survive — got: ${kept}`);
});

test('sanitise drops allow-listed keys whose value looks like a path or an email', () => {
  // Second line of defence: even if a key is on the list, a value carrying a
  // separator, a traversal, or a Windows drive letter never ships.
  for (const value of ['/Users/sam/app', 'C:\\code\\app', '../secrets', 'sam@example.com', 'acme/mobile']) {
    const clean = sanitise({ tool: value });
    assert(clean.tool === undefined, `should have dropped: ${value}`);
  }
});

test('sanitise accepts only primitives', () => {
  const clean = sanitise({ agent_count: { nested: 'object' }, version: ['1.2.0'] });
  assert(Object.keys(clean).length === 0, `expected nothing, got: ${JSON.stringify(clean)}`);
});

test('capture is a no-op when telemetry is disabled', async () => {
  // If this ever performs a network call while disabled, it is a serious bug.
  const sent = await capture('test_event', { surface: 'cli' }, { env: { RN_AGENTS_TELEMETRY: '0' } });
  assert(sent === false, 'capture should not send while disabled');
});

test('the allow-list contains no field that could identify a person', () => {
  // A tripwire on the list itself. Adding `repo`, `path`, `email` or similar
  // fails here rather than in production.
  const forbidden = /path|dir|repo|project|email|user|name|host|ip|url|file|message|stack|token|key/i;
  const offenders = [...ALLOWED_PROPERTIES].filter(
    (k) => forbidden.test(k) && !['agent_id', 'node_major'].includes(k),
  );
  assert(offenders.length === 0, `identifying-sounding fields on the allow-list: ${offenders.join(', ')}`);
});

test('telemetry is documented', () => {
  const doc = path.join(ROOT, 'TELEMETRY.md');
  assert(fs.existsSync(doc), 'TELEMETRY.md must exist');
  const text = fs.readFileSync(doc, 'utf8');

  // Every field that can ship must be named in the document.
  for (const key of ALLOWED_PROPERTIES) {
    assert(text.includes(key), `TELEMETRY.md does not document the field: ${key}`);
  }
  for (const phrase of ['DO_NOT_TRACK', 'RN_AGENTS_TELEMETRY', 'telemetry disable']) {
    assert(text.includes(phrase), `TELEMETRY.md should mention ${phrase}`);
  }
});

test('navigator factory triggers match real React Navigation APIs', () => {
  // `creatematerialtopnavigator` shipped and could never match: the real API is
  // createMaterialTopTabNavigator. A trigger with a typo is invisible — it
  // simply never fires, and nothing fails.
  const nav = agents.find((a) => a.id === 'rn-navigation');
  const REAL = [
    'createstacknavigator',
    'createnativestacknavigator',
    'createbottomtabnavigator',
    'creatematerialtoptabnavigator',
    'creatematerialbottomtabnavigator',
    'createdrawernavigator',
  ];
  const factories = nav.triggers.filter((t) => t.startsWith('create'));
  const bogus = factories.filter((t) => !REAL.includes(t));
  assert(bogus.length === 0, `not real navigator factories: ${bogus.join(', ')}`);
});

/* ------------------------------------------------------------------ *
 * QA revalidation guards. Two rounds of review found the same shape of
 * defect: a reference file corrected while the always-loaded agent body
 * kept saying the opposite. These assert agreement, not prose.
 * ------------------------------------------------------------------ */

test('no agent contradicts itself on sandbox receipt handling', () => {
  // store-policy.md said "reject sandbox receipts in production" while
  // validation.md correctly said TestFlight and App Review produce them.
  const pay = agents.find((a) => a.id === 'rn-payments');
  const all = [pay.body, ...pay.references.map((r) => r.content)].join('\n').toLowerCase();
  // Match the *prescriptive* form only. "Do not simply reject sandbox receipts"
  // is the correct guidance and must not trip this.
  assert(
    !/(must|should|need to)\s+(\*\*)?reject sandbox/.test(all),
    'still prescribes rejecting sandbox receipts',
  );
  assert(!/reject sandbox receipts in production/.test(all), 'the old wording survives somewhere');
  assert(all.includes('21007'), 'should document the production-first / 21007 retry flow');
  assert(all.includes('segregat'), 'should say segregate rather than reject');
});

test('monorepo guidance is SDK-aware in the body, not only the references', () => {
  // The body is always loaded; a reference that contradicts it loses.
  const mono = agents.find((a) => a.id === 'rn-monorepo');
  assert(/sdk 52/i.test(mono.body), 'agent body should name the SDK 52 threshold');
  assert(
    !/- \*\*`watchFolders` includes the workspace root\*\*/.test(mono.body),
    'agent body still mandates watchFolders unconditionally',
  );
  const refs = mono.references.map((r) => r.content).join('\n');
  assert(/sdk 56/i.test(refs), 'references should separate the SDK 56 filesystem threshold');
});

test('payments body qualifies claims rather than stating platform mandates', () => {
  const pay = agents.find((a) => a.id === 'rn-payments');
  assert(
    /not sufficient on its own/i.test(pay.body),
    'body should say the purchase listener alone misses Android renewals',
  );
  assert(
    /threat[- ]model/i.test(pay.body),
    'body should frame client validation as a threat-model call',
  );
});

test('release paths run every validator, including the eval one', () => {
  // A tag-triggered publish bypassed evals/run.mjs --validate entirely, so the
  // undefined-helper check could never block a release.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    /evals\/run\.mjs --validate/.test(pkg.scripts.prepublishOnly),
    'prepublishOnly must run the eval validator',
  );

  const wf = path.join(ROOT, '.github/workflows/publish.yml');
  if (fs.existsSync(wf)) {
    const text = fs.readFileSync(wf, 'utf8');
    for (const cmd of ['scripts/test.mjs', 'action/test.mjs', 'evals/run.mjs --validate']) {
      assert(text.includes(cmd), `publish.yml must run ${cmd}`);
    }
  }
});

test('monorepo guidance prefers dependency resolution over resolver overrides', () => {
  const mono = agents.find((a) => a.id === 'rn-monorepo');
  const refs = mono.references.map((r) => r.content).join('\n');
  assert(
    /dependency level first|overrides.*resolutions/i.test(refs),
    'duplicate React should be fixed by deduplication before extraNodeModules',
  );
  assert(
    /sdk 54/i.test(mono.body) || /sdk 54/i.test(refs),
    'pnpm guidance must be scoped to the SDK, not stated as always required',
  );
});

/**
 * Contested platform claims, and the phrasing that must never appear.
 *
 * Four generations of this guard were defeated, each by the mechanism that was
 * meant to make it smart:
 *
 *   1. Asserting a qualifier existed somewhere — both positions passed at once.
 *   2. Skipping sentences containing 'not' — the claim excused itself.
 *   3. Skipping negations before the match — an unrelated 'not' excused it.
 *   4. An `allow` list matched with includes() — appending a contradictory
 *      clause to an allowed sentence skipped the whole rule for that sentence.
 *
 * There is no escape hatch now. A rule is a list of patterns; if the text
 * matches, it fails. Correct prose is prose that does not repeat the forbidden
 * wording — which is a stricter and much simpler contract than teaching a
 * regular expression to recognise irony.
 */
const FORBIDDEN_ABSOLUTES = [
  {
    claim: 'a fixed React Native floor for Reanimated 4',
    patterns: [
      /reanimated\s*4[^.]{0,50}(needs|requires|supports)[^.]{0,20}(react native\s*)?0\.7[0-7]/i,
      /rn\s*(>=|≥)\s*0\.7[0-7]/i,
      /(react native|rn)\s+0\.76\s+(or newer|and above|\+)/i,
    ],
    why: 'Support is a moving window per Reanimated minor, not a floor — 4.7.x drops RN 0.78. Read the compatibility table',
  },
  {
    claim: 'captured React values frozen forever, with no mention of dependencies',
    patterns: [
      /(captured|capture)\s+by\s+copy[^.|]{0,30}frozen\s+at\s+creation/i,
      /(usestate|state|props?)\s+(values?\s+)?(inside|in)\s+a?\s*worklet[^.|]{0,40}(always|permanently|forever)\s+stale/i,
      /no\s+captured\s+component\s+state\b/i,
      /captured\s+a\s+`?usestate`?\s+value\s+instead\s+of\s+a\s+shared\s+value/i,
    ],
    why: 'A Reanimated hook re-creates its worklet when its dependencies change, so the copy refreshes on re-render. What pins it is a frozen dependency list, a ref, or a value that must change between renders',
  },
  {
    claim: 'a per-frame operation costing nothing',
    patterns: [
      /costs?\s+nothing\s+per\s+frame/i,
      /(free|zero[- ]cost)\s+(per\s+frame|on\s+every\s+frame)/i,
    ],
    why: 'Nothing on a frame path is free. Say what it does and does not cost',
  },
  {
    claim: 'the UI thread as an unconditional property of a library',
    patterns: [
      /animations?\s+must\s+run\s+on\s+the\s+ui\s+thread\b/i,
      /worklets\s+run\s+on\s+the\s+ui\s+thread\s*\./i,
      /\bgesture\s+handler\b[^.|]{0,30}runs\s+on\s+the\s+ui\s+thread\s*[,.]/i,
    ],
    why: 'Where code runs depends on the API and its configuration, not the library — useAnimatedStyle also runs once on JS, and core Animated needs useNativeDriver',
  },
  {
    claim: 'the Babel plugin named only by its legacy path',
    patterns: [
      /rg\s+'reanimated\/plugin'/i,
      /['"`]reanimated\/plugin['"`]\s+must\s+be\s+last/i,
    ],
    why: 'Reanimated 4 renamed it to react-native-worklets/plugin — a grep for the old name alone reports a correct config as broken',
  },
  {
    claim: 'index keys remounting the tail of a list',
    patterns: [
      /(index|key=\{i\})[^.]{0,60}(whole tail|entire tail|tail)[^.]{0,30}(re-?mounts?|re-?animates?|re-?enters?)/i,
      /(re-?mounts?|re-?animates?)[^.]{0,40}(every|all)\s+(items?|rows?)\s+after/i,
      /items?\s+\d+\.\.n\s+["']?enter/i,
    ],
    why: 'React reuses the surviving positional keys; only the last index unmounts. The wrong row animates — the tail does not re-enter',
  },
  {
    claim: 'Reanimated 4 on the legacy architecture',
    patterns: [
      /reanimated\s*4[^.]{0,60}(works|supported|runs)[^.]{0,30}(paper|legacy|old arch)/i,
      /reanimated\s*4[^.]{0,60}supports?\s+(both|the legacy|paper)/i,
    ],
    why: 'Reanimated 4 is New Architecture only — it drops Paper entirely',
  },
  {
    claim: 'runOnJS presented as current on 4.x',
    patterns: [
      /runOnJS\s+is\s+the\s+(current|recommended|correct)\s+/i,
      /(use|prefer)\s+runOnJS\s+(in|on|with)\s+reanimated\s*4/i,
    ],
    why: 'runOnJS is deprecated in Reanimated 4 — scheduleOnRN, with un-curried arguments',
  },
  {
    claim: 'worklets always run on the UI thread',
    patterns: [
      /worklets?\s+(always|automatically)\s+runs?\s+on\s+the\s+UI\s+thread/i,
      /(guaranteed|always)\s+to\s+run\s+on\s+the\s+UI\s+thread/i,
    ],
    why: 'Without the Babel plugin a worklet silently runs on JS — that is the whole failure mode',
  },
  {
    claim: 'a worklet sees current React state',
    patterns: [
      /worklets?\s+(can\s+)?(read|see|access)\s+(the\s+)?(current|latest)\s+(react\s+)?state/i,
      /useState[^.]{0,40}(works|is fine|safe)\s+(inside|within)\s+a?\s*worklet/i,
    ],
    why: 'A worklet captures by copy at creation — captured state is frozen, which is the top bug in this area',
  },
  {
    claim: 'sandbox receipts',
    patterns: [
      /(must|should|need to)\s+(\*\*)?reject sandbox/i,
      /reject sandbox receipts in production/i,
      /\breject(ing)?\s+sandbox\s+receipts?/i,
    ],
    why: 'TestFlight and App Review produce sandbox receipts — accept and segregate',
  },
  {
    claim: 'on-device validation',
    patterns: [
      /(on-device|client-side)\s+(receipt\s+)?validation\s+is\s+not\s+validation/i,
      /receipt\s+validated\s+on\s+the\s+device[^.]{0,80}is\s+not\s+validated/i,
    ],
    why: 'Apple documents both; it is a threat-model choice, not a non-thing',
  },
  {
    claim: 'restore without an account',
    patterns: [
      /restore[^.]{0,60}(must|has to|required to)\s+(work|be reachable)\s+without[^.]{0,20}account/i,
      // The bullet this originally shipped as, which no earlier pattern caught.
      /restore path[^.]{0,30},\s*reachable without an account/i,
      /reachable without an account/i,
    ],
    why: 'Apple requires the mechanism, not that it work signed out',
  },
  {
    claim: 'hardcoded prices',
    patterns: [
      /hardcoded price[^.]{0,60}(is a|are a|is an|automatic)\s*(store\s+)?rejection/i,
      // The code-comment form: "wrong in every other currency, and a store rejection".
      /wrong in every other (currency|storefront)[^.]{0,20},?\s*and a store rejection/i,
    ],
    why: 'a plausible rejection cause, not an automatic one',
  },
  {
    claim: 'refund notifications',
    patterns: [/server[- ]to[- ]server notifications are (required|mandatory|the only)/i],
    why: 'scheduled reconciliation against the store API is also authoritative',
  },
  {
    claim: 'Android 14 foreground services',
    patterns: [/(a\s+)?(wrong|mismatched)\s+type\s+is\s+a\s+(store\s+)?rejection/i],
    why: 'a runtime exception and a policy rejection are distinct outcomes',
  },
];

for (const agent of agents) {
  test(`${agent.id}: no unqualified absolutes on contested platform claims`, () => {
    // Checked per file so one document cannot hedge on another's behalf.
    const files = [
      { name: 'agent.md', text: agent.body },
      ...agent.references.map((r) => ({ name: `${r.slug ?? r.name}.md`, text: r.content })),
    ];
    const hits = [];
    for (const { name, text } of files) {
      // Sentence-scoped, because these phrases legitimately appear inside
      // explicit negations — "it does NOT impose a blanket rule that restore
      // must work without an account" states the correct position and must
      // not be flagged as the absolute it is refuting.
      // Whole-file, not sentence-scoped: sentence splitting was itself an
      // inference, and a claim split across a line break evaded it.
      for (const rule of FORBIDDEN_ABSOLUTES) {
        for (const pattern of rule.patterns) {
          const m = text.replace(/\n+/g, ' ').match(pattern);
          if (m) hits.push(`${name}: "${m[0].trim()}" — ${rule.why}`);
        }
      }
    }
    assert(hits.length === 0, `unqualified absolutes:\n    ${hits.join('\n    ')}`);
  });
}

test('agent ids are unique', () => {
  const ids = agents.map((a) => a.id);
  assert(new Set(ids).size === ids.length, 'duplicate ids');
});

test('agent colors are unique', () => {
  // Cosmetic, but a collision means two agents are visually indistinguishable
  // in every target's UI. Four collided when the collection grew from 10 to 21,
  // and nothing caught it.
  const seen = new Map();
  for (const a of agents) {
    if (seen.has(a.color)) {
      assert(false, `${a.color}: ${seen.get(a.color)} and ${a.id}`);
    }
    seen.set(a.color, a.id);
  }
});

test('agent emoji are unique', () => {
  const seen = new Map();
  for (const a of agents) {
    if (seen.has(a.emoji)) {
      assert(false, `${a.emoji}: ${seen.get(a.emoji)} and ${a.id}`);
    }
    seen.set(a.emoji, a.id);
  }
});

test('slash commands are unique', () => {
  const cmds = agents.map((a) => a.command).filter(Boolean);
  assert(new Set(cmds).size === cmds.length, 'duplicate commands');
});

test('no agent repeats a trigger, glob, or reference within its own frontmatter', () => {
  // `bgtaskscheduler` appeared twice in rn-background's twenty-item trigger
  // list. Harmless at run time, but it is the kind of thing that reads as
  // carelessness in a public repo, and a duplicate is invisible by eye at that
  // length. Case-insensitive: triggers are matched that way, so `Doze` and
  // `doze` are the same entry.
  //
  // Read the frontmatter rather than the loaded agent: `loadAgents` replaces
  // the declared `references` list with hydrated objects, so the loaded value
  // is a directory listing that cannot contain a duplicate — checking it would
  // have looked like coverage while testing nothing.
  for (const a of agents) {
    const { data } = parseFrontmatter(
      fs.readFileSync(path.join(ROOT, 'agents', a.dir, 'agent.md'), 'utf8'),
    );
    for (const key of ['triggers', 'globs', 'references']) {
      const list = data[key];
      if (!Array.isArray(list)) continue;
      const seen = new Set();
      for (const raw of list) {
        const item = String(raw).trim().toLowerCase();
        assert(!seen.has(item), `agents/${a.dir}/agent.md: "${raw}" listed twice under ${key}`);
        seen.add(item);
      }
    }
  }
});

/* ---------------------------------------------------------------- *
 * Build output
 * ---------------------------------------------------------------- */

const DIST = path.join(ROOT, 'dist');

await testAsync('build produces dist/', async () => {
  await run('node', [path.join(ROOT, 'scripts/build.mjs')]);
  assert(fs.existsSync(DIST), 'no dist/');
});

const expectedPaths = [
  'index.json',
  'claude-code/.claude-plugin/marketplace.json',
  'claude-code/plugins/react-native-agents/.claude-plugin/plugin.json',
  'claude-code/plugins/react-native-agents/commands/rn-audit.md',
  'cursor/.cursor/rules/react-native-context.mdc',
  'windsurf/.windsurf/rules/react-native-context.md',
  'copilot/.github/copilot-instructions.md',
  'agents-md/AGENTS.md',
];

for (const p of expectedPaths) {
  test(`emits ${p}`, () => assert(fs.existsSync(path.join(DIST, p)), 'missing'));
}

for (const a of agents) {
  test(`${a.id}: emitted for every target`, () => {
    const targets = [
      `claude-code/.claude/agents/${a.id}.md`,
      `claude-code/plugins/react-native-agents/agents/${a.id}.md`,
      `cursor/.cursor/rules/${a.id}.mdc`,
      `windsurf/.windsurf/rules/${a.id}.md`,
      `copilot/.github/instructions/${a.id}.instructions.md`,
      `copilot/.github/chatmodes/${a.id}.chatmode.md`,
      `agents-md/.agents/react-native/${a.id}.md`,
    ];
    for (const t of targets) assert(fs.existsSync(path.join(DIST, t)), `missing ${t}`);
  });

  test(`${a.id}: Claude Code frontmatter is valid`, () => {
    const raw = fs.readFileSync(path.join(DIST, `claude-code/.claude/agents/${a.id}.md`), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    assert(data.name === a.id, `name mismatch: ${data.name}`);
    assert(typeof data.description === 'string' && data.description.length > 0, 'no description');
    assert(typeof data.tools === 'string' && data.tools.includes('Read'), `tools: ${data.tools}`);
    assert(body.length > 1000, 'body too short');
  });

  test(`${a.id}: Cursor .mdc frontmatter is valid`, () => {
    const raw = fs.readFileSync(path.join(DIST, `cursor/.cursor/rules/${a.id}.mdc`), 'utf8');
    const { data } = parseFrontmatter(raw);
    assert(typeof data.description === 'string', 'no description');
    assert(typeof data.globs === 'string' && data.globs.length > 0, 'no globs');
    assert(typeof data.alwaysApply === 'boolean', `alwaysApply: ${typeof data.alwaysApply}`);
  });

  test(`${a.id}: Windsurf rules respect the 12k char limit`, () => {
    const dir = path.join(DIST, 'windsurf/.windsurf/rules');
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(a.id));
    for (const f of files) {
      const size = fs.statSync(path.join(dir, f)).size;
      assert(size <= 12000, `${f} is ${size} bytes`);
    }
  });

  test(`${a.id}: Windsurf trigger is a valid mode`, () => {
    const raw = fs.readFileSync(path.join(DIST, `windsurf/.windsurf/rules/${a.id}.md`), 'utf8');
    const { data } = parseFrontmatter(raw);
    assert(
      ['always_on', 'model_decision', 'glob', 'manual'].includes(data.trigger),
      `trigger: ${data.trigger}`,
    );
  });
}

test('marketplace.json is valid JSON with one plugin', () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIST, 'claude-code/.claude-plugin/marketplace.json'), 'utf8'));
  assert(j.name && Array.isArray(j.plugins) && j.plugins.length === 1, 'bad marketplace');
  assert(j.plugins[0].source.startsWith('./'), 'plugin source must be a relative path');
});

test('index.json lists every agent', () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIST, 'index.json'), 'utf8'));
  assert(j.agents.length === agents.length, `index has ${j.agents.length}`);
});

await testAsync('--check passes against a fresh build', async () => {
  await run('node', [path.join(ROOT, 'scripts/build.mjs'), '--check']);
});

/* ---------------------------------------------------------------- *
 * MCP server smoke test over stdio
 * ---------------------------------------------------------------- */

await testAsync('MCP server: initialize, tools, prompts, resources', async () => {
  const responses = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_react_native_agents', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_react_native_agent', arguments: { agent_id: 'rn-performance' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_reference', arguments: { agent_id: 'rn-security', reference: 'masvs-checklist' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'suggest_agent', arguments: { task: 'my FlatList is janky and drops frames' } } },
    { jsonrpc: '2.0', id: 7, method: 'prompts/list' },
    { jsonrpc: '2.0', id: 8, method: 'resources/list' },
    { jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'rn-agents://rn-testing/playbook' } },
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_reference', arguments: { agent_id: 'rn-security', reference: 'nope' } } },
  ]);

  const r = (id) => responses.find((x) => x.id === id);

  assert(r(1)?.result?.serverInfo?.name === 'react-native-agents', 'initialize');
  assert(r(2)?.result?.tools?.length >= 5, 'tools/list');
  assert(r(3)?.result?.content?.[0]?.text?.includes('rn-performance'), 'list agents');
  assert(r(4)?.result?.content?.[0]?.text?.includes('performance engineer'), 'get agent');
  assert(r(5)?.result?.content?.[0]?.text?.includes('MASVS'), 'get reference');
  assert(r(6)?.result?.content?.[0]?.text?.includes('rn-performance'), 'suggest agent');
  assert(r(7)?.result?.prompts?.length >= 7, 'prompts/list');
  assert(r(8)?.result?.resources?.length > 20, 'resources/list');
  assert(r(9)?.result?.contents?.[0]?.text?.includes('test engineer'), 'resources/read');
  assert(r(10)?.result?.isError === true, 'unknown reference should be an error result');
});

await testAsync('MCP audit plan lists review agents only, and counts them honestly', async () => {
  // The plan used to be built from every loaded agent, so it told the client to
  // "run" rn-doctor and rn-build — which need a failing build or an error log
  // that a codebase sweep does not have. Seven wasted agent loads, each ending
  // in a section with nothing in it.
  const review = agents.filter((a) => a.mode !== 'interactive');
  const interactive = agents.filter((a) => a.mode === 'interactive');
  assert(interactive.length > 0, 'fixture assumption: some agents are interactive');

  const [res] = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_audit_plan', arguments: {} } },
  ]);
  const plan = res?.result?.content?.[0]?.text ?? '';

  const listed = [...plan.matchAll(/agent_id: "([^"]+)"/g)].map((m) => m[1]);
  assert(
    listed.length === review.length,
    `plan lists ${listed.length} agents, expected the ${review.length} review agents`,
  );
  for (const a of interactive) {
    assert(!listed.includes(a.id), `${a.id} is interactive and must not be in the audit plan`);
  }
  for (const a of review) {
    assert(listed.includes(a.id), `${a.id} reviews code but is missing from the audit plan`);
  }
  // The count in the heading is derived; assert it rather than trusting it.
  assert(
    new RegExp(`## Step 2[^\\n]*\\(${review.length}\\)`).test(plan),
    'Step 2 heading should state the real review-agent count',
  );
});

await testAsync('MCP initialize instructions state the real agent counts', async () => {
  // This said "Six React Native specialist agents" while twenty-four were
  // loaded, across three releases. A literal in a handler is invisible.
  const [res] = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } },
  ]);
  const instructions = res?.result?.instructions ?? '';
  const review = agents.filter((a) => a.mode !== 'interactive').length;

  assert(
    new RegExp(`\\b${agents.length}\\b`).test(instructions),
    `instructions should state ${agents.length} agents: ${instructions.slice(0, 80)}`,
  );
  assert(
    new RegExp(`\\b${review}\\b`).test(instructions),
    `instructions should state ${review} review agents: ${instructions.slice(0, 80)}`,
  );
  assert(
    !/\b(six|seven|eight|nine|ten|eleven|twelve)\b/i.test(instructions),
    `a spelled-out count cannot be checked against the agent list: ${instructions.slice(0, 80)}`,
  );
});

await testAsync('MCP server: unknown method returns a JSON-RPC error', async () => {
  const [res] = await mcp([{ jsonrpc: '2.0', id: 1, method: 'does/notExist' }]);
  assert(res.error?.code === -32601, `got ${JSON.stringify(res)}`);
});

await testAsync('MCP server: notifications produce no response', async () => {
  const responses = await mcp([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'ping' },
  ]);
  assert(responses.length === 1 && responses[0].id === 1, `got ${responses.length} responses`);
});

/* ---------------------------------------------------------------- *
 * CLI
 * ---------------------------------------------------------------- */

await testAsync('CLI list runs and names every agent', async () => {
  const { stdout } = await run('node', [path.join(ROOT, 'scripts/cli.mjs'), 'list']);
  for (const a of agents) assert(stdout.includes(a.id), `missing ${a.id}`);
});

test('package.json declares a bin matching the package name', () => {
  // `npx <pkg>` resolves the bin named after the package. Without this entry npm
  // fails with "could not determine executable to run" when there are 2+ bins.
  // Scoped names resolve against the unscoped part, so `@user/react-native-agents`
  // still looks for a bin called `react-native-agents` — this stays correct if the
  // package is later republished under a scope.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const unscoped = pkg.name.replace(/^@[^/]+\//, '');
  assert(pkg.bin?.[unscoped], `no bin named "${unscoped}" (has: ${Object.keys(pkg.bin ?? {})})`);
});

test('scoped package is configured to publish publicly', () => {
  // Scoped packages default to "restricted", which requires a paid npm org —
  // publishing without this fails with a 402 that reads like a billing problem.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg.name.startsWith('@')) {
    assert(
      pkg.publishConfig?.access === 'public',
      `scoped package needs publishConfig.access="public" (got: ${pkg.publishConfig?.access})`,
    );
  }
});

test('publishConfig does not force provenance', () => {
  // `provenance: true` in publishConfig breaks local `npm publish` — provenance
  // can only be generated from a supported CI runner. The workflow passes
  // --provenance explicitly instead, so both paths work.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    pkg.publishConfig?.provenance !== true,
    'publishConfig.provenance=true breaks manual publish; pass --provenance in CI instead',
  );
});

test('prepublishOnly gates the release on build sync and tests', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const s = pkg.scripts?.prepublishOnly ?? '';
  assert(s.includes('--check'), 'prepublishOnly must verify dist/ is in sync');
  assert(s.includes('test'), 'prepublishOnly must run the test suite');
});

test('version is valid semver', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.version), `bad version: ${pkg.version}`);
});

test('repository metadata points at the real repo', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [field, value] of [
    ['repository.url', pkg.repository?.url],
    ['homepage', pkg.homepage],
    ['bugs.url', pkg.bugs?.url],
  ]) {
    assert(value, `${field} is unset`);
    assert(!/\bOWNER\b|example\.com/.test(value), `${field} still has a placeholder: ${value}`);
  }
});

test('docs contain no unreplaced OWNER placeholder', () => {
  for (const rel of ['README.md', 'CONTRIBUTING.md', 'scripts/cli.mjs']) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const hits = fs.readFileSync(full, 'utf8').match(/\bOWNER\b/g);
    assert(!hits, `${rel} has ${hits?.length} unreplaced OWNER placeholder(s)`);
  }
});

test('every declared bin exists and is executable ESM', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [name, rel] of Object.entries(pkg.bin ?? {})) {
    const full = path.join(ROOT, rel);
    assert(fs.existsSync(full), `bin "${name}" → missing ${rel}`);
    assert(
      fs.readFileSync(full, 'utf8').startsWith('#!/usr/bin/env node'),
      `bin "${name}" → ${rel} has no shebang`,
    );
  }
});

test('files allowlist covers everything the bins need at runtime', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const needed of ['agents', 'shared', 'scripts', 'mcp-server', 'dist']) {
    assert(pkg.files?.includes(needed), `"files" is missing ${needed}`);
  }
});

test('the published tarball contains no filesystem residue', () => {
  // npm ships everything under an allowlisted directory and does NOT consult
  // .gitignore for it. Editor swap files, FUSE residue, and stray tarballs will
  // ship to every consumer unless the allowlist excludes them explicitly.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const neg of ['!**/.fuse_hidden*', '!**/*.tgz', '!**/.DS_Store']) {
    assert(pkg.files?.includes(neg), `"files" should exclude ${neg}`);
  }

  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const junk = entry.files
    .map((f) => f.path)
    .filter((p) => /\.fuse_hidden|\.DS_Store|\.tgz$|~$|\.orig$|\.rej$|\.swp$/.test(p));
  assert(junk.length === 0, `tarball contains residue: ${junk.slice(0, 5).join(', ')}`);
});

await testAsync('CLI `mcp` subcommand starts the MCP server', async () => {
  // This is the entry point every MCP client config uses — it must route to the
  // server, not fall through to the unknown-command branch.
  const responses = await mcpVia(
    [path.join(ROOT, 'scripts/cli.mjs'), 'mcp'],
    [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }],
  );
  assert(responses[0]?.result?.serverInfo?.name === 'react-native-agents', 'did not start server');
});

await testAsync('CLI rejects an unknown subcommand', async () => {
  let failed = false;
  try {
    await run('node', [path.join(ROOT, 'scripts/cli.mjs'), 'bogus']);
  } catch {
    failed = true;
  }
  assert(failed, 'unknown command should exit non-zero');
});

/* ---------------------------------------------------------------- *
 * Installer safety — regression guards for the data-loss bug
 * ---------------------------------------------------------------- */

function scratchProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-install-'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# MY OWN INSTRUCTIONS\n');
  fs.writeFileSync(path.join(dir, '.github/copilot-instructions.md'), '# my rules\n');
  return dir;
}

test('installer: plan classifies create / conflict / identical', () => {
  const dir = scratchProject();
  const src = path.join(DIST, 'agents-md');
  const entries = plan(src, dir);
  const s = summarise(entries);
  assert(s.conflict.length >= 1, 'should detect the pre-existing AGENTS.md as a conflict');
  assert(s.create > 0, 'should also have new files to create');
});

test('installer: default mode never overwrites an existing file', () => {
  const dir = scratchProject();
  const before = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'skip' });
  eq(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), before, 'AGENTS.md must be untouched');
});

test('installer: dry run writes nothing at all', () => {
  const dir = scratchProject();
  const countBefore = fs.readdirSync(dir).length;
  apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'overwrite', dryRun: true });
  eq(fs.readdirSync(dir).length, countBefore, 'dry run must not create files');
  assert(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').startsWith('# MY OWN'), 'unchanged');
});

test('installer: --force still backs up user-authored files', () => {
  const dir = scratchProject();
  const original = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const r = apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'overwrite' });
  assert(r.backedUp.length > 0, 'should have taken a backup');
  assert(fs.existsSync(path.join(dir, 'AGENTS.md.bak')), 'AGENTS.md.bak must exist');
  eq(fs.readFileSync(path.join(dir, 'AGENTS.md.bak'), 'utf8'), original, 'backup must hold the original');
});

test('installer: a second --force run does not destroy the first backup', () => {
  // The backup path was `${dest}.bak` unconditionally. Install once and the
  // user's AGENTS.md moved to AGENTS.md.bak; install again and that same path
  // was overwritten with the *generated* file from the first run. The only copy
  // of the user's own work was gone, and both runs reported "backed up".
  const dir = scratchProject();
  const original = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert(original.startsWith('# MY OWN'), 'fixture assumption: AGENTS.md is user-authored');

  apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'overwrite' });
  // Make the second run a genuine conflict again.
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# EDITED AFTER INSTALL\n');
  const second = apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'overwrite' });

  eq(
    fs.readFileSync(path.join(dir, 'AGENTS.md.bak'), 'utf8'),
    original,
    'the first backup holds the user\'s own work and must never be overwritten',
  );
  assert(fs.existsSync(path.join(dir, 'AGENTS.md.bak.2')), 'the second backup needs its own path');
  eq(
    fs.readFileSync(path.join(dir, 'AGENTS.md.bak.2'), 'utf8'),
    '# EDITED AFTER INSTALL\n',
    'the second backup holds what was there at the time',
  );
  assert(
    second.backedUp.some((p) => p.endsWith('.bak.2')),
    `the report must name the path actually written, got ${second.backedUp}`,
  );
});

test('installer: a dry run names the backup path it would really use', () => {
  // It reports what would happen; naming an already-taken path is a lie that
  // only shows up as data loss when someone acts on it.
  const dir = scratchProject();
  apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'overwrite' });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# EDITED\n');

  const dry = apply(plan(path.join(DIST, 'agents-md'), dir), {
    onConflict: 'overwrite',
    dryRun: true,
  });
  assert(
    dry.backedUp.some((p) => p.endsWith('.bak.2')),
    `dry run should predict .bak.2, got ${dry.backedUp}`,
  );
  assert(!fs.existsSync(path.join(dir, 'AGENTS.md.bak.2')), 'a dry run must still write nothing');
});

test('installer: re-running on a clean install is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-idem-'));
  apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'skip' });
  const second = apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'skip' });
  eq(second.created, 0, 'nothing new on the second run');
  eq(second.skipped, 0, 'identical files are not conflicts');
  assert(second.identical > 0, 'should recognise files as identical');
});

test('installer: user-owned file list covers the known-dangerous paths', () => {
  for (const f of ['AGENTS.md', '.github/copilot-instructions.md', 'CLAUDE.md']) {
    assert(isUserOwned(f), `${f} should be treated as user-authored`);
  }
  assert(!isUserOwned('.claude/agents/rn-security.md'), 'generated files are ours to replace');
});

/* ---------------------------------------------------------------- *
 * Version single-source-of-truth
 * ---------------------------------------------------------------- */

test('every generated manifest uses the package.json version', () => {
  const marketplace = JSON.parse(
    fs.readFileSync(path.join(DIST, 'claude-code/.claude-plugin/marketplace.json'), 'utf8'),
  );
  const plugin = JSON.parse(
    fs.readFileSync(path.join(DIST, 'claude-code/plugins/react-native-agents/.claude-plugin/plugin.json'), 'utf8'),
  );
  const index = JSON.parse(fs.readFileSync(path.join(DIST, 'index.json'), 'utf8'));

  eq(marketplace.metadata.version, VERSION, 'marketplace metadata');
  eq(marketplace.plugins[0].version, VERSION, 'marketplace plugin entry');
  eq(plugin.version, VERSION, 'plugin.json');
  eq(index.version, VERSION, 'index.json');
});

/* ---------------------------------------------------------------- *
 * Eval suite gate
 * ---------------------------------------------------------------- */

// Minimal shapes matching what run.mjs builds for restored and fresh cases.
const dirtyCase = (id, pass, expectPassed = 0, expectTotal = 6) => ({
  tc: { id, def: {} },
  pass,
  score: { expectPassed, expectTotal, violations: [] },
});
const cleanCase = (id, pass) => ({
  tc: { id, def: { expectMaxFindings: 0 } },
  pass,
  score: { expectPassed: 1, expectTotal: 1, violations: [] },
});

test('an exception cannot be satisfied by a negation that reinforces the advice', () => {
  // Four verified bypasses across four rounds. Every one came from asking "is a
  // negation-ish word nearby?" instead of stating what is actually permitted.
  const def = {
    forbid: [
      {
        name: 'device validation',
        pattern: 'validat\\w*\\s+(the\\s+)?receipt\\s+(on|in)\\s+the\\s+(device|client|app)',
        unlessPattern:
          "\\b(do not|don't|never)\\s+\\w*\\s*validat" +
          '|validat\\w*[^.;,]{0,50}\\bis (insufficient|not sufficient|not enough)',
      },
    ],
  };
  const caught = (text) => scoreOutput(text, def).violations.length > 0;

  // Must still be caught:
  assert(caught('Validate the receipt on the device.'), 'plain forbidden advice');
  assert(
    caught('Validate the receipt on the device, which is not hard to do.'),
    'a negation qualifying something else must not excuse the advice',
  );
  assert(
    caught('Validate the receipt on the device; this is not optional.'),
    'a clause that reinforces the advice must not excuse it',
  );
  assert(
    caught('Validate the receipt on the device using a notary service.'),
    '"notary" contains "not" but is not a negation',
  );
  assert(
    caught('Do not hardcode prices. Validate the receipt on the device.'),
    'a negation in an earlier sentence is unrelated',
  );

  // Must still be excused — the rule has to be usable, not just strict:
  assert(!caught('Do not validate the receipt on the device.'), 'a real negation');
  assert(!caught('Never validate the receipt on the device.'), 'another real negation');
  assert(
    !caught('Validating the receipt on the device is insufficient.'),
    'a trailing qualifier in the same clause is a legitimate exception',
  );
});

test('a conceded qualifier does not excuse forbidden advice', () => {
  // Fourth reported bypass of this mechanism. "Even though it is insufficient,
  // do it anyway" puts the qualifier and the advice in one clause, so clause
  // scoping excused it — but conceding an objection is the opposite of
  // applying it.
  const def = {
    forbid: [
      {
        name: 'device validation',
        pattern: 'validat\\w*\\s+(the\\s+)?receipt\\s+(on|in)\\s+the\\s+(device|client|app)',
        unlessPattern:
          "\\b(do not|don't|never)\\s+\\w*\\s*validat" +
          '|validat\\w*[^.;,]{0,50}\\bis (insufficient|not sufficient|not enough)',
      },
    ],
  };
  const caught = (t) => scoreOutput(t, def).violations.length > 0;

  assert(
    caught(
      'Validate the receipt on the device even though it is insufficient and grant premium from that result anyway.',
    ),
    'the reported bypass',
  );
  assert(caught('Although it is insufficient, validate the receipt on the device.'), 'although');
  assert(caught('Validate the receipt on the device despite it not being sufficient.'), 'despite');
  assert(
    caught('Validate the receipt on the device regardless of it not being enough.'),
    'regardless',
  );
  // The legitimate exceptions must survive.
  assert(!caught('Do not validate the receipt on the device.'), 'a real negation still excuses');
  assert(
    !caught('Validating the receipt on the device is insufficient.'),
    'and so does a real trailing qualifier',
  );
});

test('unlessPattern states the permitted phrasings instead of guessing', () => {
  // The explicit mechanism. `unless` asks "is a negation-ish word nearby?",
  // which keywords cannot answer — three narrowings each left a new hole.
  const def = {
    forbid: [
      {
        name: 'device validation',
        pattern: 'validat\\w*\\s+(the\\s+)?receipt\\s+(on|in)\\s+the\\s+(device|client|app)',
        unlessPattern: "\\b(do not|don't|never)\\s+\\w*\\s*validat",
      },
    ],
  };
  const caught = (t) => scoreOutput(t, def).violations.length > 0;

  assert(!caught('Do not validate the receipt on the device.'), 'the named shape is permitted');
  assert(caught('Validate the receipt on the device.'), 'and nothing else is');
  assert(
    caught('Validate the receipt on the device, which is not hard.'),
    'a stray negation no longer counts, because the rule never said it would',
  );
});

test('a concessive construction voids unlessPattern too', () => {
  // An explicit pattern is only as careful as the regex someone wrote. While
  // building this I wrote a plausible pattern that matched the concessive
  // sentence — exactly the mistake a rule author will make.
  const def = {
    forbid: [
      {
        name: 'device validation',
        pattern: 'validat\\w*\\s+(the\\s+)?receipt\\s+(on|in)\\s+the\\s+(device|client|app)',
        unlessPattern: 'insufficient',
      },
    ],
  };
  const text =
    'Validate the receipt on the device even though it is insufficient and grant premium anyway.';
  assert(
    scoreOutput(text, def).violations.length > 0,
    'a sloppy unlessPattern must not reopen the concessive hole',
  );
});

test('question cases are framed as questions, not as files to review', () => {
  // Every case used to get "Review the following file …" plus a demand for a
  // JSON findings array — including the fifteen whose input is a developer's
  // question to an interactive agent. monorepo/quote-workspace-setup scored 0/5
  // against terms as common as "cost" and "complexity", which no genuine answer
  // to "should we adopt a monorepo?" could miss. The harness was marking its own
  // mis-framing as a model failure.
  const agents = loadAgents();
  const byId = new Map(agents.map((a) => [a.id, a]));
  const cases = loadCases();

  const questions = cases.filter((tc) => isQuestionCase(tc, byId.get(tc.def.agent)));
  assert(questions.length > 5, `expected the interactive cases to be detected, got ${questions.length}`);

  // Every interactive agent's cases must be questions — unless they cap findings.
  for (const tc of cases) {
    const agent = byId.get(tc.def.agent);
    if (agent?.mode !== 'interactive') continue;
    if (tc.def.expectMaxFindings !== undefined) continue;
    assert(
      isQuestionCase(tc, agent),
      `${tc.id} feeds an interactive agent but is framed as a file review`,
    );
  }
});

test('a clean case keeps the findings contract even as a .md fixture', () => {
  // `expectMaxFindings` is an assertion about findings, so the case must ask for
  // findings. upgrade/clean-version-bump is an .md fixture with a cap of 1;
  // treating it as prose would skip the only check it exists for.
  const byId = new Map(loadAgents().map((a) => [a.id, a]));
  for (const tc of loadCases()) {
    if (tc.def.expectMaxFindings === undefined) continue;
    assert(
      !isQuestionCase(tc, byId.get(tc.def.agent)),
      `${tc.id} caps findings at ${tc.def.expectMaxFindings} but would be asked for prose — the cap could never fail`,
    );
  }
});

test('an explicit style in case.json overrides the inference', () => {
  const agent = { mode: 'interactive' };
  eq(isQuestionCase({ def: { style: 'review' }, inputName: 'input.md' }, agent), false);
  eq(isQuestionCase({ def: { style: 'question' }, inputName: 'input.tsx' }, { mode: 'review' }), true);
});

test('the output contract forbids reporting correct behaviour as a finding', () => {
  // A local run had the model return five P3 "findings" on a clean fixture:
  // "Foreground guarantee in place", "Completion handler always called" — all
  // things the code got right. The contract said "do not invent problems" but
  // never said a finding must be a defect, so a checklist read as compliant.
  const src = fs.readFileSync(path.join(ROOT, 'action/lib/audit.mjs'), 'utf8');
  const contract = src.match(/const OUTPUT_CONTRACT = `([\s\S]*?)`;/)?.[1] ?? '';
  assert(contract, 'could not find OUTPUT_CONTRACT');
  assert(
    /wrong and needs changing/i.test(contract),
    'the contract must say a finding is a defect, not an observation',
  );
  assert(
    /not an observation|not a confirmation/i.test(contract),
    'and rule out the confirmation-as-finding shape explicitly',
  );
});

test('no eval rule uses the keyword `unless` any more', () => {
  // The ratchet. Every bypass reported against this suite came from a bare
  // keyword excusing any clause the word happened to appear in — the last one
  // needing only `id` in "store its id there". All 98 rules now state their
  // exceptions explicitly, so there is nothing to grandfather.
  const offenders = [];
  for (const c of loadCases()) {
    for (const f of c.def.forbid ?? []) {
      if (f.unless !== undefined) offenders.push(`${c.id}: ${f.name}`);
    }
  }
  eq(offenders.length, 0, `still using keyword unless:\n    ${offenders.join('\n    ')}`);
});

test('every unlessPattern is a compilable regex', () => {
  // A broken pattern would throw mid-run, after spending on model calls.
  for (const c of loadCases()) {
    for (const f of c.def.forbid ?? []) {
      if (!f.unlessPattern) continue;
      try {
        new RegExp(f.unlessPattern, 'i');
      } catch (err) {
        assert(false, `${c.id}: "${f.name}" has an invalid unlessPattern — ${err.message}`);
      }
    }
  }
});

test('the reported stale-closure bypass is closed, and legitimate useRef still passes', () => {
  // "Use useRef as the fix for the derived state and store its id there."
  // gave the forbidden recommendation and was excused because `id` was listed.
  const tc = loadCases().find((c) => c.id === 'code-quality/stale-closure');
  const rule = (tc.def.forbid ?? []).find((f) => f.name.includes('useRef as the fix'));
  assert(rule, 'rule not found');
  const caught = (t) => scoreOutput(t, { forbid: [rule] }).violations.length > 0;

  assert(
    caught('Use useRef as the fix for the derived state and store its id there.'),
    'the reported bypass must now be caught',
  );
  assert(
    !caught('Keep the interval id in a useRef so the callback sees the latest value.'),
    'the legitimate use — a timer id in a ref — must still be excused',
  );
  assert(
    !caught('A useRef holding the latest options is the right tool for the timer.'),
    'and so must the latest-value ref',
  );
});

test('a qualifier in a comma-joined preceding clause still excuses', () => {
  // Clause-only scoping flagged "Only after confirming the duplicate, remove
  // node_modules" — a correct answer. The comma matters: a preceding clause
  // ending in a full stop is a different sentence, and allowing that back would
  // reopen the first bypass ("Do not hardcode prices. Validate on the device.").
  const tc = loadCases().find((c) => c.id === 'monorepo/duplicate-react');
  const rule = (tc.def.forbid ?? []).find((f) => f.name.includes('first step'));
  const caught = (t) => scoreOutput(t, { forbid: [rule] }).violations.length > 0;

  assert(!caught('Only after confirming the duplicate, remove node_modules.'), 'comma-joined');
  assert(caught('rm -rf node_modules to start.'), 'the bare recommendation is still caught');
});

test('a preceding clause ending in a full stop does not excuse', () => {
  /**
   * The boundary the comma widening must not cross.
   *
   * A deliberately *generic* unlessPattern is used here — the kind a rule
   * author actually writes. My first attempt at this test used a pattern
   * specific enough that the sentence boundary made no difference, so widening
   * the rule to accept any preceding clause left it green. The mutation check
   * is the only reason I know that.
   */
  const def = {
    forbid: [
      {
        name: 'device validation',
        pattern: 'validat\\w*\\s+the\\s+receipt\\s+on\\s+the\\s+device',
        unlessPattern: '\\b(do not|never)\\b',
      },
    ],
  };
  const caught = (t) => scoreOutput(t, def).violations.length > 0;

  assert(
    caught('Do not hardcode prices. Validate the receipt on the device.'),
    'a negation about something else, in a previous sentence, must not excuse this',
  );
  assert(
    !caught('Do not validate the receipt on the device.'),
    'the same clause still excuses',
  );
  assert(
    !caught('Whatever else you do, never validate the receipt on the device.'),
    'and so does a comma-joined preceding clause',
  );
});

test('the highest-stakes forbid rules use explicit patterns', () => {
  // Where wrong advice costs money or creates a vulnerability, the exception
  // should be stated rather than inferred.
  const migrated = [
    ['payments/client-side-entitlement', 'recommends validating the receipt on the device'],
    ['payments/client-side-entitlement', 'recommends encrypting the AsyncStorage flag as the fix'],
    ['security/jwt-in-asyncstorage', 'suggests obfuscation as the fix for a shipped secret'],
  ];
  const cases = loadCases();
  for (const [caseId, ruleName] of migrated) {
    const tc = cases.find((c) => c.id === caseId);
    assert(tc, `${caseId} not found`);
    const rule = (tc.def.forbid ?? []).find((f) => f.name === ruleName);
    assert(rule, `${caseId}: rule "${ruleName}" not found`);
    assert(rule.unlessPattern, `${caseId}: "${ruleName}" should use unlessPattern`);
    assert(!rule.unless, `${caseId}: "${ruleName}" should not also carry a keyword list`);
  }
});

test('clause splitting is what makes the unless rule work', () => {
  // Sentence-level scoping was not enough; the boundary that matters is the
  // clause, because that is where a qualifier stops applying backwards.
  const clauses = splitClauses('validate on the device, which is not hard; really.');
  assert(clauses.length >= 3, `expected clause splitting, got ${JSON.stringify(clauses)}`);
  assert(
    clauses.some((c) => c.startsWith('validate on the device')),
    'the advice sits in its own clause',
  );
  assert(
    !clauses.find((c) => c.startsWith('validate on the device'))?.includes('not'),
    'and the trailing negation is not in it',
  );
});

test('a concessive marker must be a whole word', () => {
  // `clause.includes('though')` fires on "thoughtful", which voided a correct
  // answer. The concessive check errs toward reporting a violation, so a false
  // positive here is a wrong *failure* — the kind that gets a suite ignored.
  const def = {
    forbid: [
      {
        name: 'device validation',
        pattern: 'validat\\w*\\s+the\\s+receipt\\s+on\\s+the\\s+device',
        unlessPattern: '\\b(do not|never)\\b',
      },
    ],
  };
  const caught = (t) => scoreOutput(t, def).violations.length > 0;

  assert(
    !caught('After a thoughtful review, do not validate the receipt on the device.'),
    '"thoughtful" is not the concessive "though"',
  );
  assert(
    caught('Even though it is weak, validate the receipt on the device.'),
    'a real concessive still voids the exception',
  );
});

test('whole-term matching does not fire on substrings', () => {
  assert(!containsWholeTerm('a notary service', 'not'), '"notary" is not "not"');
  assert(!containsWholeTerm('nothing at all', 'not'), '"nothing" is not "not"');
  assert(!containsWholeTerm('another option', 'not'), '"another" is not "not"');
  assert(containsWholeTerm('do not do that', 'not'), 'a real word still matches');
  assert(containsWholeTerm('this is not the fix', 'not the fix'), 'multi-word terms still work');
});

test('results.json has exactly one writer, and it includes restored rows', () => {
  // `--json` had its own serialiser that mapped over `results` rather than the
  // merged set, so a resumed run wrote out only the cases executed in that
  // invocation and discarded everything restored.
  const src = fs.readFileSync(path.join(ROOT, 'evals/run.mjs'), 'utf8');
  const writes = [...src.matchAll(/writeFileSync\(\s*\n?\s*(?:RESULTS_FILE|path\.join\(HERE, 'results\.json'\))/g)];
  assert(
    writes.length === 1,
    `results.json should be written from one place, found ${writes.length} — a second writer is how the shapes diverged`,
  );

  // And that one writer must merge the restored rows in.
  const persistBody = src.match(/const persist = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
  assert(persistBody, 'could not locate persist()');
  assert(
    /\.\.\.previous/.test(persistBody),
    'the writer must include restored rows, or --resume loses them',
  );
});

test('the results.json shape satisfies every consumer that reads it back', () => {
  // The `--json` writer emitted {id, pass, score, sev, error} while the resume
  // path and evals/watch.mjs both expect {id, agent, clean, expectPassed, …}.
  // Cases silently lost their `clean` flag and were restored as dirty with a
  // zero score, and the watcher reported "clean cases 0/0".
  const src = fs.readFileSync(path.join(ROOT, 'evals/run.mjs'), 'utf8');
  const persistBody = src.match(/const persist = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
  const written = new Set([...persistBody.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]));
  assert(written.size > 5, `expected a full row shape, parsed: ${[...written]}`);

  // What the resume path reads off each restored row.
  const restoreBody = src.match(/const restored = previous\.map\(\(row\) => \(\{([\s\S]*?)\n  \}\)\);/)?.[1] ?? '';
  assert(restoreBody, 'could not locate the restore mapping');
  for (const [, key] of restoreBody.matchAll(/row\.(\w+)/g)) {
    assert(written.has(key), `--resume reads row.${key}, which the writer never writes`);
  }

  // What the progress viewer reads.
  const watch = fs.readFileSync(path.join(ROOT, 'evals/watch.mjs'), 'utf8');
  for (const [, key] of watch.matchAll(/\br\.(\w+)/g)) {
    assert(written.has(key), `evals/watch.mjs reads r.${key}, which the writer never writes`);
  }
});

test('dirty cases that miss most expectations fail the suite', () => {
  // The gate only counted violations, errors, clean failures, and the case
  // where *every* case scored zero. So forty-eight dirty cases could each match
  // one expectation out of eight and the suite still exited 0 — the failure it
  // exists to catch was the one shape it ignored.
  const all = [
    ...Array.from({ length: 10 }, (_, i) => dirtyCase(`d${i}`, false, 1, 8)),
    cleanCase('c0', true),
  ];
  const { reasons, dirtyRate } = gateReasons(all, DEFAULT_MIN_PASS_RATE);
  eq(dirtyRate, 0, 'no dirty case fully passed');
  assert(
    reasons.some((r) => /dirty case\(s\) fully passed/.test(r)),
    `expected a dirty-rate failure, got: ${JSON.stringify(reasons)}`,
  );
});

test('one matching expectation no longer rescues the whole suite', () => {
  // `noneMatched` required every case to score zero, so a single match anywhere
  // silenced it. That is what let a broadly-failing run report success.
  const all = [dirtyCase('d0', false, 1, 8), ...Array.from({ length: 9 }, (_, i) => dirtyCase(`x${i}`, false, 0, 8))];
  const { reasons } = gateReasons(all, DEFAULT_MIN_PASS_RATE);
  assert(reasons.length > 0, 'a suite where nothing passed must not exit clean');
});

test('a healthy run passes the gate', () => {
  // The gate has to be able to say yes, or it is just a failing build.
  const all = [
    ...Array.from({ length: 9 }, (_, i) => dirtyCase(`d${i}`, true, 6, 6)),
    dirtyCase('d9', false, 4, 6),
    cleanCase('c0', true),
  ];
  const { reasons, dirtyRate } = gateReasons(all, DEFAULT_MIN_PASS_RATE);
  eq(dirtyRate, 0.9, '9 of 10 dirty cases passed');
  eq(reasons.length, 0, `should pass, got: ${JSON.stringify(reasons)}`);
});

test('the pass-rate floor is adjustable for a deliberately weak model', () => {
  // Running the suite against a small local model is legitimate; failing it
  // outright would just mean nobody runs it there.
  const all = Array.from({ length: 10 }, (_, i) => dirtyCase(`d${i}`, i < 4, 6, 6));
  assert(gateReasons(all, 0.7).reasons.length > 0, '40% should fail the default floor');
  eq(gateReasons(all, 0.3).reasons.length, 0, '40% should clear a 30% floor');
});

test('clean failures and violations fail regardless of the dirty pass rate', () => {
  // These are unambiguous: findings invented in correct code, or advice the
  // agent must never give. Model capability does not excuse either.
  const healthy = Array.from({ length: 10 }, (_, i) => dirtyCase(`d${i}`, true, 6, 6));

  const withCleanFail = [...healthy, cleanCase('c0', false)];
  assert(
    gateReasons(withCleanFail, 0).reasons.some((r) => /clean case/.test(r)),
    'an invented finding must fail the suite even with the floor at zero',
  );

  const withViolation = [
    ...healthy,
    { tc: { id: 'v0', def: {} }, pass: false, score: { expectPassed: 6, expectTotal: 6, violations: [{ name: 'bad advice' }] } },
  ];
  assert(
    gateReasons(withViolation, 0).reasons.some((r) => /forbidden-advice/.test(r)),
    'forbidden advice must fail the suite regardless of the floor',
  );
});

test('restored --resume results count toward the gate', () => {
  // `results` held only cases run in this invocation, so resuming a run with
  // forty-eight failures and one new passing case reported 1/1 and exited 0.
  // gateReasons is given the merged view; this asserts it uses all of it.
  const restored = Array.from({ length: 48 }, (_, i) => dirtyCase(`old${i}`, false, 0, 6));
  const fresh = [dirtyCase('new0', true, 6, 6)];

  eq(gateReasons(fresh, DEFAULT_MIN_PASS_RATE).reasons.length, 0, 'the fresh case alone looks fine');
  assert(
    gateReasons([...restored, ...fresh], DEFAULT_MIN_PASS_RATE).reasons.length > 0,
    'the merged view must surface the 48 restored failures',
  );
});

test('package-manager guidance distinguishes Yarn Classic from Berry', () => {
  // "Yarn workspaces = hoisted" is true of Classic and wrong for Berry, where
  // the layout is whatever `nodeLinker` says — and under `pnp` there is no
  // node_modules at all, which no React Native toolchain can work with.
  const src = fs.readFileSync(
    path.join(ROOT, 'agents/monorepo/references/package-manager.md'),
    'utf8',
  );

  // The comparison table must not make a blanket claim about "Yarn".
  const rows = [...src.matchAll(/^\|\s*\*\*Yarn[^|]*\*\*\s*\|([^|]*)\|/gm)];
  assert(rows.length >= 2, `expected Classic and Berry rows, found ${rows.length}`);
  for (const [full] of rows) {
    assert(
      /Classic|Berry|\dx|\d\+/.test(full),
      `an unqualified Yarn row is wrong for one of the two: ${full.trim()}`,
    );
  }

  // And the three linker modes must be named, since the fix depends on which.
  for (const mode of ['pnp', 'node-modules', 'nodeLinker']) {
    assert(src.includes(mode), `package-manager.md should mention \`${mode}\``);
  }
  assert(
    /nodeLinker: node-modules/.test(src),
    'the actionable fix for a Berry + React Native workspace should appear verbatim',
  );
});

test('the duplicate-package diagnostic does not exclude nested node_modules', () => {
  // It used `-not -path '*/node_modules/*/node_modules/*'`, which skips exactly
  // where a duplicate lives: a library bundling its own React. On a pnpm layout
  // it excluded the store too and reported *zero* copies — a false clean, which
  // is the worst possible outcome for a diagnostic.
  const dir = path.join(ROOT, 'agents/monorepo/references');
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [, body] of src.matchAll(/```bash\n([\s\S]*?)```/g)) {
      if (!/node_modules\/react\/package\.json/.test(body)) continue;
      const offending = body
        .split('\n')
        .filter((l) => /-not\s+-path\s+'\*\/node_modules\/\*\/node_modules\/\*'/.test(l));
      assert(
        offending.length === 0,
        `${file}: the duplicate-package search excludes nested node_modules, where duplicates live:\n    ${offending[0]?.trim()}`,
      );
      // And it must collapse symlinked copies, or pnpm looks broken when it is not.
      assert(
        /pwd -P/.test(body) && /sort -u/.test(body),
        `${file}: the search must resolve symlinks (pwd -P) and dedupe (sort -u), or a healthy pnpm repo reports many false duplicates`,
      );
    }
  }
});

test('background guidance qualifies what survives termination', () => {
  // Apple: a background URLSession transfer survives *system* termination and
  // the app is relaunched to collect it — but a user force-quit cancels the
  // session's transfers and the system will not relaunch the app. An
  // unqualified "survives being killed" tells someone their upload is safe when
  // the most common way an app dies cancels it.
  const dir = path.join(ROOT, 'agents/background/references');
  /**
   * The exception has to be named, not gestured at. An earlier version of this
   * check also accepted "by the system", which appears in ordinary prose
   * ("continued by the system") — so the unqualified claim it was written to
   * catch sailed straight through it.
   */
  const qualifiers = /force[- ]quit|force-quitting|app switcher|swipes? the app away/i;

  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    // Paragraph-level: a survival claim needs its qualifier nearby, not three
    // sections away.
    for (const para of src.split(/\n\s*\n/)) {
      const claimsSurvival =
        /survives? (the app being )?(backgrounded or )?(being )?(killed|terminated)/i.test(para) ||
        /continues? independently of your process/i.test(para) ||
        /(real|actual|an?) guarantee/i.test(para);
      if (!claimsSurvival) continue;
      assert(
        qualifiers.test(para),
        `${file}: claims background work survives termination without naming the force-quit exception:\n    ${para.replace(/\s+/g, ' ').slice(0, 120)}`,
      );
    }
  }
});

test('payments guidance does not present removed APIs as current', () => {
  // Three review rounds found wrong platform facts in this agent. The v13 names
  // still belong in the migration table — what must not happen is a code fence
  // showing one as the way to do it. Checked structurally: prose mentions are
  // fine, fenced examples are not.
  const removed = [
    'getProducts',
    'getSubscriptions',
    'requestSubscription',
    'getPurchaseHistory',
    'clearProductsIOS',
    'E_USER_CANCELLED',
    'localizedPrice',
    'transactionReceipt',
  ];

  const dir = path.join(ROOT, 'agents/payments');
  const files = [
    path.join(dir, 'agent.md'),
    ...fs.readdirSync(path.join(dir, 'references')).map((f) => path.join(dir, 'references', f)),
  ];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // Fenced blocks only. A table row or a sentence naming the old API is the
    // migration guidance doing its job.
    for (const [, body] of src.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
      for (const api of removed) {
        if (!body.includes(api)) continue;
        // A line marked as the wrong way, or as the v13 side of a comparison,
        // is the point of the example.
        const offending = body
          .split('\n')
          .filter((l) => l.includes(api))
          .filter((l) => !/✗|v13|deprecated|rg -n|grep|no longer|removed/i.test(l));
        assert(
          offending.length === 0,
          `${path.relative(ROOT, file)}: code example uses removed API "${api}" as if current:\n    ${offending[0].trim()}`,
        );
      }
    }
  }
});

test('payments knowledge records the library version its examples target', () => {
  // The React Native version in knowledge.json was current the entire time this
  // agent documented an API that no longer existed, because the library moves
  // on its own schedule and nothing tracked it.
  const lib = KNOWLEDGE.libraries?.['react-native-iap'];
  assert(lib, 'knowledge.json should record the react-native-iap version the examples target');
  assert(/^\d+\.\d+$/.test(String(lib.verified_through)), `odd version: ${lib.verified_through}`);
  assert(lib.used_by?.includes('rn-payments'), 'the record should name the agent that depends on it');

  // The reference must state its assumed version, so a reader on v13 knows.
  const flow = fs.readFileSync(path.join(ROOT, 'agents/payments/references/purchase-flow.md'), 'utf8');
  assert(
    new RegExp(`v${String(lib.verified_through).split('.')[0]}\\b`).test(flow),
    'purchase-flow.md should state which major version its examples assume',
  );
});

test('TELEMETRY.md shows the current version in its example payload', () => {
  // It documents every field that can ship, verbatim, and is the page a
  // privacy-conscious user reads before opting in. A stale example version
  // reads as a document nobody maintains, which is the opposite of the point.
  const doc = fs.readFileSync(path.join(ROOT, 'TELEMETRY.md'), 'utf8');
  const row = doc.match(/^\|\s*`version`\s*\|\s*`([^`]+)`/m);
  assert(row, 'no `version` row found in the collected-fields table');
  eq(row[1], VERSION, 'TELEMETRY.md example version');
});

test('no hardcoded version literals remain in the generators', () => {
  for (const rel of ['scripts/lib/targets.mjs', 'mcp-server/index.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const hits = src.match(/version:\s*['"]\d+\.\d+\.\d+['"]/g);
    assert(!hits, `${rel} hardcodes a version: ${hits?.join(', ')}`);
  }
});

/* ---------------------------------------------------------------- *
 * Knowledge freshness
 * ---------------------------------------------------------------- */

test('knowledge.json declares verification metadata', () => {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(KNOWLEDGE.last_verified), 'last_verified must be a date');
  assert(KNOWLEDGE.reactNative?.verified_through, 'reactNative.verified_through required');
  assert(KNOWLEDGE.expo?.verified_through, 'expo.verified_through required');
  assert(KNOWLEDGE.reactNative?.min_supported, 'reactNative.min_supported required');
});

test('shared context states the same RN version as knowledge.json', () => {
  const rn = KNOWLEDGE.reactNative.verified_through;
  assert(shared.includes(rn), `shared/rn-context.md should mention RN ${rn}`);
});

test('shared context tells agents to trust package.json over the baseline table', () => {
  assert(
    /package\.json/i.test(shared) && /authoritative|verify|re-verify/i.test(shared),
    'context must defer to the project as ground truth',
  );
});

test('knowledge age is reported and not absurd', () => {
  const age = knowledgeAgeDays();
  assert(age >= 0, `negative age: ${age} — last_verified is in the future`);
});

/* ---------------------------------------------------------------- *
 * No invented benchmarks in the output contract
 * ---------------------------------------------------------------- */

test('the output-contract example does not model a fabricated measurement', () => {
  // The example is imitated more strongly than the rule, so it must comply.
  const contract = shared.slice(shared.indexOf('## Output contract'));
  const invented = contract.match(/\b(roughly|approximately|about|~)\s*\d+\s+(wasted|extra)\s+\w*\s*renders?/i);
  assert(!invented, `example fabricates a measurement: "${invented?.[0]}"`);
});

test('the measurement rule distinguishes standards from fabrication', () => {
  assert(/never invent a measurement/i.test(shared), 'rule must be explicit');
  assert(/wcag|4\.5:1|44/i.test(shared), 'rule must permit citing published standards');
});

/* ---------------------------------------------------------------- *
 * MCP intent routing
 * ---------------------------------------------------------------- */

const routeCases = [
  ['My large product catalogue is stuttering', 'rn-performance'],
  ['the app freezes when I open the inbox', 'rn-performance'],
  ['is it safe to keep the JWT where I am keeping it', 'rn-security'],
  // Was rn-release before rn-store-submission existed. A store rejection is
  // now a review-triage question, not a build-and-ship one.
  ['the store rejected my build again', 'rn-store-submission'],
  ['screen reader users cannot use the cart', 'rn-ui-accessibility'],
  ['my tests keep failing randomly', 'rn-testing'],
  ['can you refactor this messy component', 'rn-code-quality'],
];

for (const [task, expected] of routeCases) {
  test(`routing: "${task.slice(0, 40)}" → ${expected}`, () => {
    const ranked = scoreAgents(task, agents);
    eq(ranked[0]?.id, expected, `ranked: ${ranked.slice(0, 2).map((r) => `${r.id}(${r.score})`).join(', ')}`);
  });
}

test('routing: semantic phrasing with no jargon still routes', () => {
  // The team's example — contains no RN vocabulary at all.
  const ranked = scoreAgents('My large product catalogue is stuttering', agents);
  eq(ranked[0].id, 'rn-performance');
  eq(ranked[0].confidence, 'high', `confidence was ${ranked[0].confidence}`);
});

test('routing: crash-reporting language beats release, not ties with it', () => {
  // rn-release carried 'sentry'/'crash'/'monitoring' in its medium list, which
  // tied with rn-observability on "Sentry shows no production crashes".
  for (const task of [
    'Sentry shows no production crashes',
    'crashes are not showing up in the dashboard',
    'our stack traces are unreadable',
  ]) {
    const ranked = scoreAgents(task, agents);
    eq(ranked[0]?.id, 'rn-observability', `"${task}" ranked: ${ranked.slice(0, 2).map((r) => `${r.id}(${r.score})`).join(', ')}`);
    assert(
      ranked.length < 2 || ranked[0].score > ranked[1].score,
      `tie on "${task}": ${ranked.slice(0, 2).map((r) => `${r.id}(${r.score})`).join(' vs ')}`,
    );
  }
});

test('routing: release still wins its own vocabulary', () => {
  // rn-release ends at a signed, shipped artefact. Rejection triage moved to
  // rn-store-submission, so 'rejected' is deliberately no longer a release term.
  for (const [task, expected] of [
    ['plan the OTA rollback', 'rn-release'],
    ['code signing certificate expired', 'rn-release'],
    ['eas build then eas submit', 'rn-release'],
    ['staged rollout percentage', 'rn-release'],
  ]) {
    eq(scoreAgents(task, agents)[0]?.id, expected, task);
  }
});

test('routing: every agent is reachable from a plausible query', () => {
  // The 11 agents added in 1.2.0 had no MCP signals at all, so automatic
  // selection could never reach them — users would be silently routed to a
  // near-neighbour at low confidence. This asserts each one is the top match
  // for a query a real person would type.
  for (const [task, expected] of [
    ['debug an infinite render loop', 'rn-debug'],
    ['should I add react-native-mmkv', 'rn-dependencies'],
    ['upgrade React Native from 0.81 to 0.87', 'rn-upgrade'],
    ['App Store rejected the privacy manifest', 'rn-store-submission'],
    ['deep link opens the wrong nested screen', 'rn-navigation'],
    ['push notifications never arrive when the app is killed', 'rn-push'],
    ['the keyboard covers the submit button only on android', 'rn-platform-parity'],
    ['camera permission denied and the allow button does nothing', 'rn-permissions'],
    ['changes are lost when the user has no connection', 'rn-offline'],
    ['should we use zustand or redux toolkit', 'rn-state'],
    ['we inherited this codebase with no documentation', 'rn-onboard'],
    ['receipt validation for subscriptions', 'rn-payments'],
    ['my background fetch never runs on android', 'rn-background'],
    ['invalid hook call after adding a workspace package', 'rn-monorepo'],
  ]) {
    eq(scoreAgents(task, agents)[0]?.id, expected, task);
  }
});

test('routing: new-agent queries resolve above low confidence', () => {
  // A correct top match at 'low' confidence still prints a hedge telling the
  // user it is a guess, which defeats the point.
  for (const task of [
    'debug an infinite render loop',
    'upgrade React Native from 0.81 to 0.87',
    'deep link opens the wrong nested screen',
    'App Store rejected the privacy manifest',
  ]) {
    const top = scoreAgents(task, agents)[0];
    assert(top && top.confidence !== 'low', `${task}: ${top?.id} at ${top?.confidence}`);
  }
});

test('routing: every agent has an MCP signal block', () => {
  // Without one an agent can only be reached by its own trigger words, which
  // scores 2 and reads as a coin flip.
  const missing = agents.map((a) => a.id).filter((id) => !SIGNALS[id]);
  assert(missing.length === 0, `no MCP signals for: ${missing.join(', ')}`);
});

test('routing: terms match whole words, not substrings', () => {
  // Plain includes() matched 'list' in 'listener', 'store' in 'restore' and
  // 'npm' in 'pnpm', which ranked rn-payments above rn-offline for a NetInfo
  // subscription question.
  for (const [task, expected] of [
    ['how do I unsubscribe from a NetInfo subscription', 'rn-offline'],
    ['pnpm workspace resolution', 'rn-monorepo'],
    ['restore purchases is broken', 'rn-payments'],
  ]) {
    eq(scoreAgents(task, agents)[0]?.id, expected, task);
  }
});

test('routing: generic build errors do not outrank rn-doctor', () => {
  // 'unable to resolve module' and 'invalid hook call' were strong monorepo
  // terms, so single-project failures tied with or beat the doctor.
  eq(scoreAgents('unable to resolve module', agents)[0]?.id, 'rn-doctor');
  // ...but the same error with workspace context is monorepo territory.
  eq(scoreAgents('unable to resolve module in our pnpm workspace', agents)[0]?.id, 'rn-monorepo');
  eq(scoreAgents('invalid hook call after adding a workspace package', agents)[0]?.id, 'rn-monorepo');
});

test('routing: inflections match without matching unrelated words', () => {
  // A bare word boundary stopped 'track' matching 'tracking' and dropped an
  // obvious analytics query to low confidence.
  const tracking = scoreAgents('tracking analytics events', agents)[0];
  eq(tracking?.id, 'rn-observability');
  assert(tracking.confidence !== 'low', `should be confident, got ${tracking.confidence}`);

  // 'listener' is still not 'list' — 'ener' is not an inflection.
  eq(scoreAgents('how do I unsubscribe from a NetInfo subscription', agents)[0]?.id, 'rn-offline');
});

test('routing: stems are explicit, not guessed from suffixes', () => {
  // Applying English inflections to every short term made 'list' match
  // 'listing'; leaving multi-word terms unbounded made 'app store' match
  // 'app storefront'. Stems now declare themselves with a trailing '*'.
  const notRelease = (task) => {
    const top = scoreAgents(task, agents)[0];
    assert(top?.id !== 'rn-store-submission' && top?.id !== 'rn-release', `${task} → ${top?.id}`);
  };
  notRelease('Build an app storefront screen');
  notRelease('app stored data locally');

  const listing = scoreAgents('listing all products', agents)[0];
  assert(listing?.id !== 'rn-performance', `listing matched performance: ${listing?.id}`);

  // Declared stems still match their inflections.
  eq(scoreAgents('tracking analytics events', agents)[0]?.id, 'rn-observability');
  eq(scoreAgents('found a vulnerability in auth', agents)[0]?.id, 'rn-security');

  // Whole words and their plurals still match.
  eq(scoreAgents('the app freezes on scroll', agents)[0]?.id, 'rn-performance');
  eq(scoreAgents('rejected from the app store', agents)[0]?.id, 'rn-store-submission');
});

test('the absolutes guard has no escape hatch left', () => {
  // Every sentence below defeated an earlier generation of this guard. With no
  // negation inference and no allow-list, all of them must now fail.
  const flag = (text) => {
    const flat = text.replace(/\n+/g, ' ');
    return FORBIDDEN_ABSOLUTES.filter((rule) => rule.patterns.some((p) => p.test(flat)))
      .map((r) => r.claim);
  };

  const mustFlag = [
    ['self-negating claim', 'On-device validation is not validation.'],
    [
      'the wording it shipped as',
      'A receipt validated on the device, or trusted because the SDK returned success, is not validated.',
    ],
    [
      'unrelated preceding negation',
      'Do not trust the callback; on-device validation is not validation.',
    ],
    [
      'allowed phrase plus a contradictory clause',
      'Do not simply reject sandbox receipts; you should reject sandbox receipts in production.',
    ],
    [
      'refutation plus a contradictory clause',
      'It does not impose a blanket rule, but restore must work without an account.',
    ],
    ['the historical restore bullet', '- **A restore path**, reachable without an account.'],
    [
      'the historical price comment',
      '// ✗ wrong in every other currency, and a store rejection',
    ],
    ['claim split across a line break', 'A restore path,\nreachable without an account.'],
  ];

  for (const [why, text] of mustFlag) {
    assert(flag(text).length > 0, `should have been flagged (${why}): ${text.slice(0, 60)}`);
  }

  // And the prose actually shipped must be clean — no exemption, just wording
  // that does not repeat the forbidden claim.
  const pay = agents.find((a) => a.id === 'rn-payments');
  for (const { name, text } of [
    { name: 'agent.md', text: pay.body },
    ...pay.references.map((r) => ({ name: r.slug ?? r.name, text: r.content })),
  ]) {
    assert(flag(text).length === 0, `${name} still contains: ${flag(text).join(', ')}`);
  }
});

test('routing: intended queries resolve above low confidence', () => {
  // A correct top match at 'low' still prints a hedge telling the user it is a
  // guess — the previous test only checked the agent id.
  for (const [task, expected] of [
    ['Profiling the Hermes runtime', 'rn-performance'],
    ['Modernising our app', 'rn-upgrade'],
    ['Symbolicate this crash', 'rn-observability'],
    ['make it accessible for screen readers', 'rn-ui-accessibility'],
    ['screen orientation is wrong on device', 'rn-platform-parity'],
  ]) {
    const top = scoreAgents(task, agents)[0];
    eq(top?.id, expected, task);
    assert(top.confidence !== 'low', `${task}: ${top.id} at ${top.confidence}`);
  }
});

test('routing: no stem prefix hijacks an ordinary app-feature query', () => {
  // 'profil*' matched "edit profile avatar", 'modernis*' matched "modernist",
  // and bare 'orientation' matched "new developer orientation" — all at high
  // confidence. Explicit multi-word terms replaced all three.
  for (const task of [
    'user profile screen',
    'edit profile avatar',
    'profile picture upload',
    'update the profile page',
    'modernist UI design',
    'new developer orientation',
    'team orientation to codebase',
  ]) {
    const top = scoreAgents(task, agents)[0];
    assert(
      !top || top.confidence === 'low',
      `"${task}" should not confidently route — got ${top?.id} at ${top?.confidence}`,
    );
  }

  // The domain senses must still resolve confidently.
  for (const [task, expected] of [
    ['Profiling the Hermes runtime', 'rn-performance'],
    ['profile the app startup', 'rn-performance'],
    ['Modernising our app', 'rn-upgrade'],
    ['we want to modernize the codebase', 'rn-upgrade'],
    ['screen orientation is wrong on device', 'rn-platform-parity'],
    ['handle orientation change on android', 'rn-platform-parity'],
  ]) {
    const top = scoreAgents(task, agents)[0];
    eq(top?.id, expected, task);
    assert(top.confidence !== 'low', `${task}: ${top.id} at ${top.confidence}`);
  }
});

test('routing: every intended stem carries its marker', () => {
  // The first stem migration was hand-listed and missed profil, accessib,
  // symbolicat and modernis. This derives the list instead: a term that never
  // appears standalone in its own agent's prose, only as a prefix, is a stem.
  const missing = [];
  for (const [id, sig] of Object.entries(SIGNALS)) {
    const agent = agents.find((a) => a.id === id);
    if (!agent) continue;
    const prose = [agent.body, ...agent.references.map((r) => r.content)].join('\n').toLowerCase();
    for (const tier of ['strong', 'medium', 'weak']) {
      for (const term of sig[tier] ?? []) {
        if (term.endsWith('*') || term.includes(' ') || term.length < 4) continue;
        if (KNOWN_WHOLE_WORDS.has(term)) continue;
        const standalone = new RegExp(`(?<![\\w-])${term}(?:e?s)?(?![\\w-])`).test(prose);
        const asPrefix = new RegExp(`(?<![\\w-])${term}[a-z]{2,}`).test(prose);
        if (!standalone && asPrefix) missing.push(`${id}: "${term}" reads as a stem — mark it "${term}*"`);
      }
    }
  }
  assert(missing.length === 0, missing.join('\n    '));
});

test('routing: declared stems match their inflections', () => {
  for (const [task, expected] of [
    ['Profiling the Hermes runtime', 'rn-performance'],
    ['Symbolicate this crash', 'rn-observability'],
    ['Modernising our app', 'rn-upgrade'],
    ['make it accessible for screen readers', 'rn-ui-accessibility'],
    ['tracking analytics events', 'rn-observability'],
  ]) {
    eq(scoreAgents(task, agents)[0]?.id, expected, task);
  }
});

test('routing: unrelated text matches nothing rather than guessing', () => {
  eq(scoreAgents('how do I make a burrito', agents).length, 0);
});

test('routing: admits low confidence instead of asserting a winner', () => {
  const { text } = explainRouting('something is a bit odd', agents);
  assert(/no specialist clearly matches|guess/i.test(text), text.slice(0, 200));
});

/* ---------------------------------------------------------------- *
 * Eval suite integrity
 * ---------------------------------------------------------------- */

const evalCases = loadCases(path.join(ROOT, 'evals'));

test('every agent has at least one eval case', () => {
  const covered = new Set(evalCases.map((c) => c.def.agent));
  for (const a of agents) assert(covered.has(a.id), `no eval case for ${a.id}`);
});

test('eval cases reference real agents and have assertions', () => {
  const ids = new Set(agents.map((a) => a.id));
  for (const c of evalCases) {
    assert(ids.has(c.def.agent), `${c.id}: unknown agent ${c.def.agent}`);
    // A clean case has no `expect` entries by design — its entire assertion is
    // that the agent reported (almost) nothing.
    const asserts = c.def.expect?.length > 0 || c.def.expectMaxFindings !== undefined;
    assert(asserts, `${c.id}: no expectations`);
    assert(c.input.trim().length > 50, `${c.id}: fixture too small to be meaningful`);
  }
});

test('every agent has a clean case or more than one case', () => {
  // One case per agent is where silent quality regressions hide. This asserts
  // what its name says: either the agent is measured for noise (a clean case),
  // or it has at least two failure cases covering different modes.
  const byAgent = {};
  for (const c of evalCases) (byAgent[c.def.agent] ??= []).push(c);

  const thin = [];
  for (const a of agents) {
    const cases = byAgent[a.id] ?? [];
    assert(cases.length >= 1, `${a.id} has no eval case`);
    const hasClean = cases.some((c) => c.def.expectMaxFindings !== undefined);
    if (!hasClean && cases.length < 2) thin.push(a.id);
  }
  assert(
    thin.length === 0,
    `these agents need a clean case or a second case: ${thin.join(', ')}`,
  );
});

test('enough clean cases exist to measure noise across the collection', () => {
  const clean = evalCases.filter((c) => c.def.expectMaxFindings !== undefined);
  assert(
    clean.length >= 6,
    `only ${clean.length} clean (noise) case(s) — these are what catch false positives`,
  );
});

test('clean cases forbid the findings they are designed to catch', () => {
  for (const c of evalCases.filter((x) => x.def.expectMaxFindings !== undefined)) {
    assert(
      (c.def.forbid ?? []).length >= 3,
      `${c.id}: a clean case needs forbid rules naming the likely false positives`,
    );
    assert(c.def.expectMaxFindings <= 2, `${c.id}: a clean case with a loose cap tests nothing`);
  }
});

test('eval forbid patterns are valid regexes', () => {
  for (const c of evalCases) {
    for (const f of c.def.forbid ?? []) {
      if (f.pattern) new RegExp(f.pattern, 'i'); // throws if invalid
    }
  }
});

test('eval scoring catches premature FlashList advice', () => {
  const def = evalCases.find((c) => c.id === 'performance/unstable-render-item').def;
  const bad = scoreOutput('Just switch to FlashList, it is 3x faster.', def);
  assert(bad.violations.length >= 1, 'should flag premature FlashList');
  assert(!bad.pass, 'must not pass');
});

test('eval scoring accepts a measured answer mentioning FlashList', () => {
  const def = evalCases.find((c) => c.id === 'performance/unstable-render-item').def;
  const good = scoreOutput(
    'renderItem is an inline arrow so rows re-render. Profile with React DevTools first; consider FlashList after you measure.',
    def,
  );
  eq(good.violations.length, 0, `unexpected violations: ${good.violations.map((v) => v.name).join(', ')}`);
});

test('eval fixtures contain no scanner-triggering credential literals', () => {
  // A realistic-looking key in a public repo trips GitHub secret scanning and
  // gitleaks — and is a bad look in the repo whose own security agent forbids it.
  const patterns = [
    /sk_live_[A-Za-z0-9]{12,}/,
    /sk_test_[A-Za-z0-9]{12,}/,
    /AKIA[0-9A-Z]{16}/,
    /ghp_[A-Za-z0-9]{20,}/,
    /AIza[0-9A-Za-z_-]{30,}/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
  ];
  for (const c of evalCases) {
    for (const p of patterns) {
      const m = c.input.match(p);
      assert(!m, `${c.id} contains a scanner-triggering literal: ${m?.[0]?.slice(0, 12)}…`);
    }
  }
});

test('the security fixture still expresses a genuine P0, not a defanged placeholder', () => {
  // Redacting the literal must not quietly turn the case into one that a
  // *correct* agent fails — a transparent placeholder is not a P0, so demanding
  // P0 + "rotate" would reward over-reacting instead of good judgement.
  const c = evalCases.find((x) => x.id === 'security/jwt-in-asyncstorage');
  assert(c, 'security eval case missing');

  const defanged = /=\s*['"](EXAMPLE|PLACEHOLDER|CHANGEME|TODO|XXX)[_A-Z]*['"]/.test(c.input);
  assert(
    !defanged,
    'fixture uses a transparent placeholder — a correct agent would rate it low, ' +
      'so expectSeverity P0 would fail good behaviour. Express the P0 by mechanism instead.',
  );

  if (c.def.expectSeverity?.includes('P0')) {
    assert(
      /EXPO_PUBLIC_\w*(SECRET|KEY|TOKEN)|api\.stripe\.com|authorization/i.test(c.input),
      'case demands P0 but the fixture has no mechanism that justifies one',
    );
  }
});

test('eval scoring catches the AsyncStorage-is-encrypted claim', () => {
  const def = evalCases.find((c) => c.id === 'security/jwt-in-asyncstorage').def;
  const bad = scoreOutput('AsyncStorage is encrypted so the token is safe there.', def);
  assert(bad.violations.some((v) => /encrypted/i.test(v.name)), 'should flag the false claim');
});

/* ---------------------------------------------------------------- *
 * Repository hygiene
 * ---------------------------------------------------------------- */

test('gitignore covers FUSE artifacts and packed tarballs', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert(gi.includes('.fuse_hidden'), 'FUSE artifacts must be ignored');
  assert(gi.includes('*.tgz'), 'packed tarballs must be ignored');
});

test('third-party actions are pinned to a commit SHA, not a mutable tag', () => {
  // The repo's own security agent tells users to do this (supply-chain.md);
  // failing to follow our own advice is both a risk and a credibility problem.
  const dir = path.join(ROOT, '.github/workflows');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const [, ref] of src.matchAll(/uses:\s*([^\s#]+)/g)) {
      if (ref.startsWith('./')) continue; // local action — no pinning needed
      const [, version] = ref.split('@');
      assert(
        /^[0-9a-f]{40}$/.test(version ?? ''),
        `${f}: "${ref}" is not pinned to a full commit SHA`,
      );
    }
  }
});

test('every documented npx command resolves to this package', () => {
  /**
   * `npx <name>` resolves a **package** name from the registry, not a bin name.
   * This package is scoped, so the bare bin names point somewhere else entirely:
   *
   *   npx react-native-agents   → an unrelated package that exists at 0.0.1
   *   npx rn-agents             → an unscoped name nobody owns (squattable)
   *   npx react-native-agents-mcp → not even a bin here; the bin is rn-agents-mcp
   *
   * All three were in the docs. The first is the serious one: a copy-pasted
   * command that installs and runs a stranger's code.
   */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scoped = pkg.name;
  const bins = Object.keys(pkg.bin ?? {});

  const files = [
    'README.md',
    ...fs.readdirSync(path.join(ROOT, 'docs')).map((f) => `docs/${f}`),
    'action/size.mjs',
    'action/index.mjs',
    'scripts/cli.mjs',
    'mcp-server/index.mjs',
    'TELEMETRY.md',
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));

  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Strip trailing markdown/comment punctuation from the captured token —
    // `npx -p pkg bin\`` is the same command as `npx -p pkg bin`.
    const clean = (t) => t.replace(/[`'",.;:)\]]+$/, '');
    for (const [, raw] of src.matchAll(/npx\s+(-p\s+[^\s`'"]+\s+[^\s`'"]+|[@\w./-]+)/g)) {
      const target = clean(raw);
      // `npx -p <pkg> <bin>` is the correct way to run a named bin from a
      // scoped package.
      const withP = target.match(/^-p\s+(\S+)\s+(\S+)$/);
      if (withP) {
        eq(withP[1], scoped, `${rel}: npx -p names "${withP[1]}", not this package`);
        assert(bins.includes(withP[2]), `${rel}: "${withP[2]}" is not a bin — have ${bins.join(', ')}`);
        continue;
      }
      if (target === scoped) continue;                 // the correct plain form
      if (!/^(@?[\w.-]+\/)?[\w.-]+$/.test(target)) continue;  // prose, not a command
      // Anything that looks like one of our bins, used bare, is the bug.
      assert(
        !bins.includes(target) && target !== 'react-native-agents-mcp',
        `${rel}: "npx ${target}" resolves a registry package of that name, not ${scoped}. ` +
          `Use "npx ${scoped}" or "npx -p ${scoped} ${target}".`,
      );
    }
  }
});

test('no action.yml input is marked required when the code accepts alternatives', () => {
  // `api-key` was `required: true` while index.mjs resolves it from the input,
  // from ANTHROPIC_API_KEY/OPENAI_API_KEY, or not at all under `dry-run` and
  // `provider: mock`. GitHub does not enforce the flag on a composite action,
  // so the only thing it did was contradict the documentation beside it.
  const yml = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8');
  const inputsBlock = yml.split(/^outputs:/m)[0];
  const required = [...inputsBlock.matchAll(/^ {2}([\w-]+):\n((?: {4}.*\n|\n)*)/gm)]
    .filter((m) => /required:\s*true/.test(m[2]))
    .map((m) => m[1]);

  const src = fs.readFileSync(path.join(ROOT, 'action/index.mjs'), 'utf8');
  for (const name of required) {
    const camel = name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    // A fallback chain (`?? ...`) means the input is not the only source.
    const hasFallback = new RegExp(`\\b${camel}\\s*=[\\s\\S]{0,240}?\\?\\?`).test(src);
    assert(
      !hasFallback,
      `action.yml marks "${name}" required, but index.mjs falls back to another source for it`,
    );
  }

  assert(
    !required.includes('api-key'),
    'api-key is resolvable from env, and dry-run and mock need none — it must not be required',
  );
});

test('action.yml names every agent that can actually be forced', () => {
  // It listed the original six long after there were twenty-four, so anyone
  // reading the input documentation would not know rn-payments or rn-upgrade
  // could be requested at all. YAML cannot derive this, so it is checked.
  const src = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8');
  const described = src.match(/ {2}agents:\n(?: {4}.*\n)+/)?.[0] ?? '';
  assert(described, 'no `agents:` input found in action.yml');

  const review = agents.filter((a) => a.mode !== 'interactive');
  for (const a of review) {
    assert(
      described.includes(a.id),
      `action.yml's agents input does not mention ${a.id}, which auto-routing can select`,
    );
  }
  // Interactive agents cannot review a diff; naming them here invites a run
  // that produces nothing.
  for (const a of agents.filter((x) => x.mode === 'interactive')) {
    assert(
      !described.includes(a.id),
      `action.yml offers ${a.id}, which needs a human question rather than a diff`,
    );
  }
  assert(
    new RegExp(`\\b${review.length}\\b`).test(described),
    `action.yml should state the real count of forceable agents (${review.length})`,
  );
});

test('workflows holding id-token: write install nothing from a floating tag', () => {
  // Same reasoning as the SHA-pinning test above, applied to package installs.
  // publish.yml ran `npm install -g npm@latest` in a job with `id-token: write`,
  // so whichever npm had been published most recently executed with the OIDC
  // credential in scope. The repo's own security agent calls this out; the
  // release path should not be the one place that ignores it.
  const dir = path.join(ROOT, '.github/workflows');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/id-token:\s*write/.test(src)) continue;

    // Strip comments first: the fix is documented by naming what it replaced,
    // and that prose should not trip the check that enforces it.
    const code = src
      .split('\n')
      .map((l) => l.replace(/#.*$/, ''))
      .join('\n');

    for (const [full, spec] of code.matchAll(
      /\b(?:npm\s+(?:install|i|add)|npx|pnpm\s+add|yarn\s+add)\b[^\n]*?([\w@./-]+@(?:latest|next|canary|beta|\*))/g,
    )) {
      assert(
        false,
        `${f}: "${spec}" is a floating version installed in a job that can mint an OIDC token — ` +
          `pin it exactly (in: ${full.trim().slice(0, 60)})`,
      );
    }
  }
});

test('the release summary distinguishes a dry run from a real publish', () => {
  // It printed "### Published" whether or not the publish step ran, so the one
  // workflow input whose purpose is "do not publish" reported a release.
  const src = fs.readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
  if (!/### Published/.test(src)) return; // wording changed; nothing to guard
  assert(
    /steps\.publish\.outcome/.test(src),
    'the summary claims a publish without checking whether the publish step ran',
  );
  assert(
    /id:\s*publish/.test(src),
    'the publish step needs an `id` for its outcome to be readable',
  );
});

test('the demo workflow exercises the working tree, not a published release', () => {
  // It triggers on action/** changes, so pinning it to a published tag would
  // let a PR that breaks the action pass its own demo.
  const src = fs.readFileSync(path.join(ROOT, '.github/workflows/demo-audit.yml'), 'utf8');
  if (/paths:[\s\S]*?action\//.test(src)) {
    assert(
      /uses:\s*\.\/\s*$/m.test(src),
      'demo-audit.yml triggers on action/** but does not run `uses: ./`',
    );
  }
});

test('CI triggers on both main and master', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const m = ci.match(/branches:\s*\[([^\]]+)\]/);
  assert(m, 'no branches filter found');
  assert(/main/.test(m[1]) && /master/.test(m[1]), `branches: [${m[1]}] — must cover both`);
});

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */

console.log('\n');
if (failures.length) {
  console.log('\x1b[31mFailures:\x1b[0m\n');
  for (const f of failures) {
    console.log(`  \x1b[31m✗\x1b[0m ${f.name}`);
    console.log(`    ${f.err.message}\n`);
  }
}
console.log(
  failed === 0
    ? `\x1b[32m✓ ${passed} passed\x1b[0m\n`
    : `\x1b[31m✗ ${failed} failed\x1b[0m, ${passed} passed\n`,
);
process.exit(failed === 0 ? 0 : 1);

/* ---------------------------------------------------------------- */

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`exit ${code}: ${stderr || stdout}`)),
    );
  });
}

function mcp(messages) {
  return mcpVia([path.join(ROOT, 'mcp-server/index.mjs')], messages);
}

function mcpVia(nodeArgs, messages) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', nodeArgs, { cwd: ROOT });
    let out = '';
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error('MCP server timed out'));
    }, 15000);

    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(
          out
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l)),
        );
      } catch (e) {
        reject(new Error(`bad MCP output: ${e.message}\n${out.slice(0, 500)}`));
      }
    });

    for (const m of messages) p.stdin.write(`${JSON.stringify(m)}\n`);
    setTimeout(() => p.stdin.end(), 300);
  });
}
