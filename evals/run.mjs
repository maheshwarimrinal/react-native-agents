#!/usr/bin/env node
/**
 * Agent evaluation runner.
 *
 * Scores real agent output against expectations. Unlike the structural test
 * suites, this measures whether the advice is any good.
 *
 *   node evals/run.mjs --validate                  # no API key, no cost
 *   ANTHROPIC_API_KEY=... node evals/run.mjs
 *   node evals/run.mjs --agent rn-security --verbose
 *   node evals/run.mjs --case security/jwt-in-asyncstorage
 *   node evals/run.mjs --agent rn-payments,rn-background   # comma-separated
 *   node evals/run.mjs --clean                     # correct-code cases only
 *   node evals/run.mjs --resume                    # continue an interrupted run
 *   node evals/run.mjs --min-pass-rate 0.4         # expect a weak local model
 *
 * For a free run against Ollama or LM Studio, see evals/LOCAL-MODEL.md.
 *
 * Exit code: 0 only if none of these happened —
 *   - an agent gave advice its case forbids
 *   - a case errored
 *   - a *clean* case failed (findings invented in correct code)
 *   - fewer than --min-pass-rate of *dirty* cases fully passed (default 0.7)
 *
 * Under --resume, restored results count toward all of the above. They did not
 * used to, so resuming a broadly-failing run reported success.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgents, loadSharedContext } from '../scripts/lib/source.mjs';
import { LLM } from '../action/lib/llm.mjs';
import { parseFindings } from '../action/lib/audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
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

/* ------------------------------------------------------------------ *
 * Loading cases
 * ------------------------------------------------------------------ */

export function loadCases(root = HERE) {
  let cases = [];
  for (const agentDir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!agentDir.isDirectory()) continue;
    const agentPath = path.join(root, agentDir.name);

    for (const caseDir of fs.readdirSync(agentPath, { withFileTypes: true })) {
      if (!caseDir.isDirectory()) continue;
      const casePath = path.join(agentPath, caseDir.name);
      const defFile = path.join(casePath, 'case.json');
      if (!fs.existsSync(defFile)) continue;

      const def = JSON.parse(fs.readFileSync(defFile, 'utf8'));
      const inputFile = fs
        .readdirSync(casePath)
        .find((f) => f.startsWith('input.'));
      if (!inputFile) throw new Error(`${agentDir.name}/${caseDir.name} has no input.* file`);

      cases.push({
        id: `${agentDir.name}/${caseDir.name}`,
        dir: casePath,
        def,
        inputName: inputFile,
        input: fs.readFileSync(path.join(casePath, inputFile), 'utf8'),
      });
    }
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/**
 * Assertions are keyword-based on purpose: LLM output is non-deterministic, and
 * a suite that asserts exact wording fails constantly and gets switched off.
 * We check that the substance is present.
 */
/**
 * Split on clause boundaries, not just sentence enders.
 *
 * A qualifier after a comma or semicolon attaches to its own clause, not to the
 * one before it — which is exactly the difference between "do not validate on
 * the device" and "validate on the device, which is not hard".
 */
export function splitClauses(text) {
  return text
    .split(/(?<=[.!?;:,\n])\s+|\s+[—–]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Concessive constructions, which void an `unlessPattern` exception.
 *
 * These are the grammar of "I acknowledge the objection and am doing it
 * anyway" — the shape of:
 *
 *   "Validate the receipt on the device even though it is insufficient,
 *    and grant premium from that result anyway."
 *
 * which the clause rule excused because `insufficient` sat in the same clause.
 * A closed list of markers is not more semantic guessing: these words have one
 * job, and their presence means the qualifier is being conceded rather than
 * applied. Anything subtler than this belongs in `unlessPattern`.
 */
export const CONCESSIVE_MARKERS = [
  'even though',
  'even so',
  'even if',
  'although',
  'though',
  'despite',
  'in spite of',
  'regardless',
  'nonetheless',
  'nevertheless',
  'anyway',
  'anyhow',
  'all the same',
  'still fine',
  'but still',
];

/**
 * Whole-term containment, so `not` does not match inside `notary`, `another`
 * or `nothing`. Multi-word terms ("do not", "not the fix") work unchanged.
 */
export function containsWholeTerm(haystack, term) {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const left = /^[\w]/.test(term) ? '(?<![\\w-])' : '';
  const right = /[\w]$/.test(term) ? '(?![\\w-])' : '';
  return new RegExp(`${left}${escaped}${right}`, 'i').test(haystack);
}

/**
 * Is this case a question to answer, or a file to review?
 *
 * Exported so the decision can be tested. It used to be no decision at all —
 * every case got "Review the following file …" plus a demand for JSON findings,
 * including the fifteen whose input is a developer's question to an interactive
 * agent. Those scored near zero against expectations no real answer could miss,
 * and the harness recorded its own mis-framing as a model failure.
 *
 * `style: "question" | "review"` in case.json overrides the inference.
 */
export function isQuestionCase(tc, agent) {
  if (tc.def.style) return tc.def.style === 'question';
  /**
   * A case that caps findings is asserting *about findings*, so it needs the
   * structured contract whatever its file extension.
   * `upgrade/clean-version-bump` is an .md fixture with `expectMaxFindings: 1`;
   * framing it as prose would skip the only check it exists for, and a clean
   * case that can no longer fail is worse than no clean case at all.
   */
  if (tc.def.expectMaxFindings !== undefined) return false;
  return agent?.mode === 'interactive' || /\.(md|txt)$/.test(tc.inputName);
}

export function scoreOutput(text, def) {
  const haystack = text.toLowerCase();
  const expected = [];
  const forbidden = [];

  for (const e of def.expect ?? []) {
    const terms = e.any ?? [e.term].filter(Boolean);
    const hit = terms.find((t) => haystack.includes(String(t).toLowerCase()));
    expected.push({ name: e.name, pass: Boolean(hit), matched: hit ?? null });
  }

  for (const f of def.forbid ?? []) {
    let triggered = false;
    let evidence = null;

    if (f.pattern) {
      const m = haystack.match(new RegExp(f.pattern, 'i'));
      if (m) {
        triggered = true;
        evidence = m[0];
      }
    }

    if (!triggered && f.all) {
      const allPresent = f.all.every((t) => haystack.includes(String(t).toLowerCase()));
      if (allPresent) {
        triggered = true;
        evidence = f.all.join(' + ');
      }
    }

    if (!triggered && f.any) {
      const hit = f.any.find((t) => haystack.includes(String(t).toLowerCase()));
      if (hit) {
        triggered = true;
        evidence = hit;
      }
    }

    /**
     * `unlessPattern` excuses a forbidden phrase only within the CLAUSE holding
     * the evidence.
     *
     * Clause boundaries (`, ; : —` as well as `. ! ?`) are where a qualifier
     * stops applying to what came before it. "Do not validate …" keeps its
     * negation in the same clause; "…, which is not hard" does not. That also
     * preserves the legitimate trailing form, "Validating the receipt on the
     * device is insufficient", which sits in one clause with its qualifier.
     *
     * The scope narrowed three times before landing here, each time after a
     * reported bypass — whole response, then sentence, then clause. See
     * evals/README.md for the table; the short version is that the keyword form
     * this replaced was asking a question keywords cannot answer.
     */
    if (triggered && evidence && f.unlessPattern) {
      const ev = String(evidence).toLowerCase();
      const clauses = splitClauses(haystack);
      const at = clauses.findIndex((part) => part.includes(ev));

      /**
       * The evidence clause, plus a comma-joined clause immediately before it.
       *
       * "Only after confirming the duplicate, remove node_modules" puts the
       * qualifier in its own clause, and it plainly governs what follows —
       * clause-only scoping flagged that legitimate answer.
       *
       * The comma is doing real work here and is not a softening of the rule.
       * A preceding clause ending in a full stop is a *different sentence*:
       * allowing that back would reopen the very first bypass, where
       * "Do not hardcode prices. Validate the receipt on the device." was
       * excused by a negation about something else entirely.
       */
      const prev = at > 0 ? clauses[at - 1] : '';
      const clause =
        at === -1 ? '' : /,$/.test(prev) ? `${prev} ${clauses[at]}` : clauses[at];

      /**
       * A conceded qualifier is not an applied one, whichever mechanism found
       * it. "Even though it is insufficient, do it anyway" acknowledges the
       * objection and proceeds — it is the *opposite* of an exception.
       *
       * Checked before either matcher rather than inside the keyword branch,
       * because an explicit `unlessPattern` is only as careful as the regex
       * someone wrote. While testing this I wrote a plausible-looking pattern
       * that matched the concessive sentence, which is exactly the mistake a
       * rule author will make.
       */
      /**
       * Whole-word, for the same reason `not` must not match inside `notary`:
       * `clause.includes('though')` fires on "thoughtful", so
       * "After a thoughtful review, do not validate on the device" had its
       * perfectly correct exception voided. The concessive check errs toward
       * reporting a violation, so a false positive here is a *wrong failure* —
       * the kind that teaches people to ignore the suite.
       */
      const conceded = CONCESSIVE_MARKERS.some((m) => containsWholeTerm(clause, m));

      /**
       * `unlessPattern` is now the only mechanism.
       *
       * The keyword form asked "does a word suggesting negation appear
       * nearby?", which is a semantic question keywords cannot answer. Three
       * narrowings — whole response, sentence, clause — each left a new bypass,
       * and the last needed only a legitimate word in an unrelated role:
       *
       *   "Use useRef as the fix for the derived state and store its id there."
       *
       * excused by `id`. All 98 rules now state their exceptions outright, so
       * the branch is gone rather than deprecated: a code path nothing uses is
       * how the old behaviour comes back.
       */
      triggered = conceded || !new RegExp(f.unlessPattern, 'i').test(clause);
    }

    forbidden.push({ name: f.name, violated: triggered, evidence });
  }

  const expectPassed = expected.filter((e) => e.pass).length;
  const violations = forbidden.filter((f) => f.violated);

  return {
    expected,
    forbidden,
    expectPassed,
    expectTotal: expected.length,
    violations,
    // A single violation fails the case: confident bad advice is worse than
    // missing a point, because users act on it.
    pass: violations.length === 0 && expectPassed === expected.length,
  };
}

/**
 * A clean fixture must produce (nearly) nothing.
 *
 * This is the most important assertion in the suite and the one most easily
 * forgotten: an agent that invents problems to look useful is worse than one
 * that misses some, because every false positive costs a human the time to
 * dismiss it and erodes trust in the real findings.
 */
/** The default share of dirty cases that must fully pass for the suite to pass. */
export const DEFAULT_MIN_PASS_RATE = 0.7;

/**
 * Decide whether a suite run failed, and say why.
 *
 * Pure and exported so the gate itself can be tested. It previously lived
 * inline in `main()`, which is part of why two holes sat in it unnoticed: a
 * decision nothing can call is a decision nothing can check.
 *
 * @param {Array} all  every case in the run — restored *and* freshly executed
 * @param {number} minPassRate
 * @returns {{ reasons: string[], dirtyRate: number, totalMatched: number, totalExpected: number }}
 */
export function gateReasons(all, minPassRate = DEFAULT_MIN_PASS_RATE) {
  const isClean = (r) => r.tc?.def?.expectMaxFindings !== undefined;
  const dirty = all.filter((r) => !isClean(r));
  const dirtyFailed = dirty.filter((r) => !r.pass);

  const violated = all.filter((r) => r.score?.violations?.length).length;
  const errored = all.filter((r) => r.error).length;
  const cleanFailures = all.filter((r) => isClean(r) && !r.pass).length;
  const noneMatched = all.length > 0 && all.every((r) => (r.score?.expectPassed ?? 0) === 0);

  const dirtyRate = dirty.length ? (dirty.length - dirtyFailed.length) / dirty.length : 1;
  const totalExpected = dirty.reduce((n, r) => n + (r.score?.expectTotal ?? 0), 0);
  const totalMatched = dirty.reduce((n, r) => n + (r.score?.expectPassed ?? 0), 0);

  const reasons = [];
  if (violated) reasons.push(`${violated} forbidden-advice violation(s)`);
  if (errored) reasons.push(`${errored} case(s) errored`);
  if (cleanFailures) reasons.push(`${cleanFailures} clean case(s) failed`);
  if (noneMatched) reasons.push('no case matched any expectation — likely a provider failure');
  if (dirty.length && dirtyRate < minPassRate) {
    /**
     * Report cases, not just a percentage.
     *
     * On a filtered run the rate is coarse: with four dirty cases the only
     * achievable values are 0, 25, 50, 75 and 100, so "25% against a floor of
     * 30%" reads as a five-point near-miss when it is actually a whole case
     * short. Naming the counts, and the number needed, stops the number being
     * more precise than the measurement.
     */
    const passedCount = dirty.length - dirtyFailed.length;
    const needed = Math.ceil(minPassRate * dirty.length);
    reasons.push(
      `${passedCount} of ${dirty.length} dirty case(s) fully passed — ` +
        `need ${needed} for the ${(minPassRate * 100) | 0}% floor. ` +
        `Lower it with --min-pass-rate if this model is expected to be weak`,
    );
  }

  return { reasons, dirtyRate, totalMatched, totalExpected, dirtyCount: dirty.length };
}

export function checkMaxFindings(findings, def) {
  if (def.expectMaxFindings === undefined) return { ok: true, note: 'no cap' };
  const ok = findings.length <= def.expectMaxFindings;
  return {
    ok,
    note: `expected at most ${def.expectMaxFindings} finding(s), got ${findings.length}` +
      (ok ? '' : `: ${findings.map((f) => `${f.severity} ${f.title}`).join(' | ')}`),
  };
}

/** P0 is most severe. Used for `atLeast` comparisons. */
const SEVERITY_ORDER = ['P0', 'P1', 'P2', 'P3'];
const rank = (s) => {
  const i = SEVERITY_ORDER.indexOf(String(s).toUpperCase());
  return i === -1 ? Number.POSITIVE_INFINITY : i;
};

/**
 * Two accepted shapes:
 *
 *   "expectSeverity": ["P1", "P2"]        at least one finding is exactly P1 or P2
 *   "expectSeverity": [{ "atLeast": "P1" }]  at least one finding is P1 or more severe
 *
 * The second form was written into twelve cases and silently never matched,
 * because the old implementation compared an object against severity strings
 * with `includes()`. Those cases reported a failure no model could avoid, and
 * the message rendered as "expected one of [object Object]" — which is the only
 * reason it was ever noticed.
 */
/**
 * Identifiers a fixture calls but never defines or imports.
 *
 * Heuristic by necessity — this package has no dependencies, so there is no
 * parser. It is tuned to have no false positives on the current suite rather
 * than to be exhaustive: keywords, destructuring, object shorthand and callback
 * parameters are all accounted for.
 */
const JS_GLOBALS = new Set([
  'console','setTimeout','clearTimeout','setInterval','clearInterval','fetch','Promise','JSON',
  'Object','Array','String','Number','Boolean','Date','Math','Error','RegExp','Map','Set','Symbol',
  'require','process','parseInt','parseFloat','isNaN','encodeURIComponent','decodeURIComponent',
  'Buffer','structuredClone','queueMicrotask','AbortController','URL','TextEncoder','alert',
  'useState','useEffect','useCallback','useMemo','useRef','useLayoutEffect','useContext','useReducer',
  'describe','it','test','expect','beforeEach','afterEach','beforeAll','afterAll','jest',
  'async','else','do','try','finally','yield','delete','void','in','of','if','for','while',
  'switch','catch','return','function','typeof','await','new','super','import',
]);

export function undefinedCalls(src, inputName = '') {
  if (!/\.(ts|tsx|js|jsx)$/.test(inputName)) return [];

  const known = new Set(JS_GLOBALS);
  const add = (n) => { if (/^[\w$]+$/.test(n)) known.add(n); };

  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g))
    for (const part of m[1].split(',')) add(part.trim().split(/\s+as\s+/).pop().replace(/^type\s+/, '').trim());
  for (const m of src.matchAll(/import\s+(?:type\s+)?([\w$]+)\s*(?:,|from)/g)) add(m[1]);
  for (const m of src.matchAll(/(?:function|class)\s+([\w$]+)/g)) add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([\w$]+)\s*[=:]/g)) add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g))
    for (const part of m[1].split(',')) add(part.trim().split(':').pop().trim());
  for (const m of src.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g))
    for (const part of m[1].split(',')) add(part.trim());
  for (const m of src.matchAll(/([\w$]+)\s*[(:]\s*(?:async\s*)?\(?[^)]*\)?\s*(?:=>|\{)/g)) add(m[1]);
  for (const m of src.matchAll(/\(([^)]*)\)\s*(?:=>|\{)/g))
    for (const part of m[1].split(',')) add(part.trim().split(':')[0].replace(/[{}[\].]/g, '').trim());

  const missing = new Set();
  for (const m of src.matchAll(/(^|[^.\w$])\b([a-z_$][\w$]*)\s*\(/gm))
    if (!known.has(m[2])) missing.add(m[2]);
  return [...missing];
}

export function checkSeverity(findings, def) {
  if (!def.expectSeverity?.length) return { ok: true, note: 'no severity expectation' };
  if (!findings.length) return { ok: false, note: 'no structured findings emitted' };

  const got = [...new Set(findings.map((f) => String(f.severity).toUpperCase()))];

  const ok = def.expectSeverity.some((want) => {
    if (typeof want === 'string') return got.includes(want.toUpperCase());
    if (want && typeof want === 'object' && want.atLeast) {
      return got.some((g) => rank(g) <= rank(want.atLeast));
    }
    return false;
  });

  const describe = def.expectSeverity
    .map((w) => (typeof w === 'string' ? w : w?.atLeast ? `${w.atLeast} or worse` : JSON.stringify(w)))
    .join(' / ');

  return { ok, note: `expected ${describe}, got ${got.join('/') || 'none'}` };
}

/* ------------------------------------------------------------------ *
 * Validation — structural checks, no API key, no spend
 * ------------------------------------------------------------------ */

function validate(cases, agents) {
  const agentIds = new Set(agents.map((a) => a.id));
  const problems = [];

  for (const tc of cases) {
    const { def, id } = tc;
    if (!def.agent) problems.push(`${id}: missing "agent"`);
    else if (!agentIds.has(def.agent)) problems.push(`${id}: unknown agent "${def.agent}"`);
    if (!def.title) problems.push(`${id}: missing "title"`);
    // A clean case legitimately has no `expect` entries — its whole assertion is
    // that nothing was reported.
    if (!def.expect?.length && def.expectMaxFindings === undefined) {
      problems.push(`${id}: no expectations — the case asserts nothing`);
    }
    if (!tc.input.trim()) problems.push(`${id}: empty input fixture`);

    // A fixture that calls an identifier it never defines or imports is
    // usually an editing accident, not a deliberate excerpt — the clean
    // payments fixture shipped calling handlePurchase(), which did not exist,
    // and structural validation passed it. Deliberate elisions must be named
    // in `elidedHelpers` so an accident stands out from a choice.
    for (const name of undefinedCalls(tc.input, tc.inputName)) {
      if ((def.elidedHelpers ?? []).includes(name)) continue;
      problems.push(
        `${id}: fixture calls "${name}" which is never defined or imported — ` +
          `fix it, or add it to "elidedHelpers" if the omission is deliberate`,
      );
    }

    /**
     * An expectation that cannot match is worse than no expectation: it reports
     * a failure the model has no way to avoid. Twelve cases shipped with
     * `[{ atLeast: 'P1' }]` while the checker only understood plain strings, and
     * --validate passed all twelve because it never looked at the shape.
     */
    for (const want of def.expectSeverity ?? []) {
      const valid =
        (typeof want === 'string' && SEVERITY_ORDER.includes(want.toUpperCase())) ||
        (want && typeof want === 'object' && typeof want.atLeast === 'string' &&
          SEVERITY_ORDER.includes(want.atLeast.toUpperCase()));
      if (!valid) {
        problems.push(
          `${id}: expectSeverity entry ${JSON.stringify(want)} is not a severity ` +
            `("P0".."P3") or an { atLeast } object — it can never match`,
        );
      }
    }

    for (const e of def.expect ?? []) {
      if (!e.name) problems.push(`${id}: an expectation has no name`);
      if (!e.any?.length && !e.term) problems.push(`${id}: expectation "${e.name}" has no terms`);
    }
    for (const f of def.forbid ?? []) {
      if (!f.name) problems.push(`${id}: a forbid rule has no name`);
      if (!f.pattern && !f.all?.length && !f.any?.length) {
        problems.push(`${id}: forbid "${f.name}" has no matcher`);
      }
      if (f.pattern) {
        try {
          new RegExp(f.pattern, 'i');
        } catch (err) {
          problems.push(`${id}: forbid "${f.name}" has an invalid regex — ${err.message}`);
        }
      }
      if (f.unlessPattern) {
        try {
          new RegExp(f.unlessPattern, 'i');
        } catch (err) {
          problems.push(
            `${id}: forbid "${f.name}" has an invalid unlessPattern — ${err.message}`,
          );
        }
      }
      /**
       * `unless` is gone, and reintroducing it is an error.
       *
       * It asked "does a negation-ish word appear nearby?", which keywords
       * cannot answer. Four bypasses were reported against it, each after a
       * narrowing — whole response, then sentence, then clause — and the last
       * one only needed a legitimate word in an unrelated role:
       *
       *   "Use useRef as the fix for the derived state and store its id there."
       *
       * excused by `id`. All 98 rules now state their exceptions explicitly, so
       * this is a ratchet rather than a warning: there is nothing left to
       * grandfather.
       */
      if (f.unless !== undefined) {
        problems.push(
          `${id}: forbid "${f.name}" uses "unless", which is no longer supported — ` +
            'state the permitted phrasings in "unlessPattern" instead. ' +
            'A bare keyword excuses any clause the word happens to appear in.',
        );
      }
    }
  }

  return problems;
}



/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agents = loadAgents();
  const shared = loadSharedContext();
  let cases = loadCases();

  /**
   * `--agent` and `--case` accept comma-separated lists.
   *
   * The full suite is ~542,000 prompt tokens across 49 cases — several hours
   * against a local model, which is most of a working day of a laptop at full
   * tilt. Running the subset a change actually touched is the difference
   * between "we ran the evals" and "we meant to".
   */
  const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (args.agent) {
    const want = new Set(list(args.agent));
    cases = cases.filter((tc) => want.has(tc.def.agent));
  }
  if (args.case) {
    const want = list(args.case);
    cases = cases.filter((tc) => want.some((w) => tc.id === w || tc.id.endsWith(w)));
  }
  /**
   * Clean cases only: correct code that must produce no findings.
   *
   * The cheapest meaningful signal there is. A model inventing problems in
   * correct code is unambiguous — no amount of model weakness excuses it — and
   * these cases fail the gate at any `--min-pass-rate`.
   */
  if (args.clean) cases = cases.filter((tc) => tc.def.expectMaxFindings !== undefined);

  if (cases.length === 0) {
    console.error(c.red('\n  No matching eval cases.\n'));
    process.exit(1);
  }

  // ---- Validate always runs first; it's free and catches authoring errors ----
  const problems = validate(cases, agents);
  if (problems.length) {
    console.error(c.red(`\n  ${problems.length} problem(s) in eval definitions:\n`));
    for (const p of problems) console.error(`    ${p}`);
    console.error();
    process.exit(1);
  }

  if (args.validate) {
    console.log(c.green(`\n  ✓ ${cases.length} eval case(s) are well-formed\n`));
    for (const tc of cases) {
      const kind = tc.def.expectMaxFindings !== undefined ? c.green(`  clean (max ${tc.def.expectMaxFindings})`) : '';
      console.log(
        `    ${c.cyan(tc.id.padEnd(46))} ${(tc.def.expect ?? []).length} expect · ${(tc.def.forbid ?? []).length} forbid${kind}`,
      );
    }
    return;
  }

  // ---- Real run ----------------------------------------------------------
  const provider = args.provider ?? 'anthropic';
  if (!['anthropic', 'openai', 'mock'].includes(provider)) {
    console.error(
      c.red(`\n  Unknown provider "${provider}". Expected: anthropic, openai, or mock.\n`),
    );
    process.exit(1);
  }
  // Pick the key that belongs to the chosen provider. Preferring ANTHROPIC_API_KEY
  // unconditionally sent an Anthropic key to OpenAI whenever both were set — an
  // auth error that reads like a bad key rather than a wiring bug.
  const providerKey =
    provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const apiKey = args['api-key'] ?? providerKey ?? '';
  const model = args.model ?? (provider === 'openai' ? 'gpt-5' : 'claude-sonnet-5');

  // A local runtime (Ollama, LM Studio) needs no key. Only demand one when
  // talking to a hosted endpoint.
  const needsKey =
    provider !== 'mock' && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(args['base-url'] ?? process.env.OPENAI_BASE_URL ?? '');
  if (needsKey && !apiKey) {
    console.error(
      c.red(
        `\n  No API key for provider "${provider}". Set ` +
          `${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}, pass --api-key, ` +
          `or run with --validate for structural checks only.\n`,
      ),
    );
    process.exit(1);
  }

  console.log(c.bold(`\n  Running ${cases.length} eval case(s) against ${model}\n`));

  const baseUrl = args['base-url'] ?? process.env.OPENAI_BASE_URL;
  if (baseUrl) console.log(c.dim(`  endpoint: ${baseUrl}\n`));

  const llm = new LLM({
    provider,
    apiKey,
    model,
    baseUrl,
    budgetUsd: Number(args.budget ?? 5),
  });
  const results = [];

  /**
   * Results were written once, at the end, only with --json. A full sweep
   * against a local model takes tens of minutes, so a crash or a Ctrl-C at
   * case 40 threw away everything. Now every case is persisted as it
   * finishes, and --resume skips what is already recorded.
   */
  const RESULTS_FILE = path.join(HERE, 'results.json');

  let previous = [];
  if (args.resume && fs.existsSync(RESULTS_FILE)) {
    try {
      previous = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
      const done = new Set(previous.map((r) => r.id));
      const before = cases.length;
      cases = cases.filter((tc) => !done.has(tc.id));
      console.log(c.dim(`  resuming: ${before - cases.length} already done, ${cases.length} to go\n`));
    } catch {
      console.log(c.yellow('  results.json unreadable — starting fresh\n'));
    }
  }

  const persist = () => {
    const rows = [
      ...previous,
      ...results.map((r) => ({
        id: r.tc.id,
        agent: r.tc.def.agent,
        clean: r.tc.def.expectMaxFindings !== undefined,
        pass: r.pass ?? false,
        expectPassed: r.score?.expectPassed ?? 0,
        expectTotal: r.score?.expectTotal ?? 0,
        violations: r.score?.violations?.map((v) => v.name) ?? [],
        severity: r.sev?.ok ?? null,
        noise: r.cap?.ok ?? null,
        error: r.error ?? null,
      })),
    ];
    try {
      fs.writeFileSync(RESULTS_FILE, `${JSON.stringify(rows, null, 2)}\n`);
    } catch {
      /* a failed write must not kill a long run */
    }
  };

  for (const tc of cases) {
    const agent = agents.find((a) => a.id === tc.def.agent);
    const references = agent.references.map((r) => `<reference name="${r.slug}">\n${r.content}\n</reference>`).join('\n\n');

    const system = [agent.body, '---', shared, '---', '# Reference library', references].join('\n\n');

    /**
     * Frame the case as what it actually is.
     *
     * Every case used to get "Review the following file …" plus a demand for a
     * JSON findings array. That is right for a code fixture, and wrong for the
     * fifteen cases — a third of the suite — whose input is a *question* to an
     * interactive agent:
     *
     *   "We're a 4-person team with one React Native app … Should we do it now?"
     *
     * Asked to "review the file" and return findings, a model produces findings
     * *about a markdown document*, and the expectations ("not yet", "ongoing
     * cost", "revisit when") match nothing. `monorepo/quote-workspace-setup`
     * scored 0/5 against terms as common as "cost" and "complexity", which no
     * genuine answer to that question could miss. That was the harness marking
     * its own mis-framing as a model failure.
     */
    const isQuestion = isQuestionCase(tc, agent);

    const user = isQuestion
      ? [
          'Answer the following, as the specialist described above.',
          '',
          '## Project context',
          ...Object.entries(tc.def.context ?? {}).map(([k, v]) => `- ${k}: ${v}`),
          '',
          `## From the developer (${tc.inputName})`,
          '',
          tc.input,
          '',
          'Answer in prose. Give a recommendation and the reasoning behind it —',
          'do not return JSON, and do not pad the answer to look thorough.',
        ].join('\n')
      : [
          'Review the following file and report what a competent React Native engineer would flag.',
          '',
          '## Project context',
          ...Object.entries(tc.def.context ?? {}).map(([k, v]) => `- ${k}: ${v}`),
          '',
          `## ${tc.inputName}`,
          '',
          '```',
          tc.input,
          '```',
          '',
          'Respond with a JSON object: {"findings":[{"severity","title","file","line","why","fix","verify"}],"summary"}.',
          'Every entry in "findings" must be something that is wrong and needs changing.',
          'Do not list things the code does correctly — an empty array is the right',
          'answer for a clean file. Return only the JSON.',
        ].join('\n');

    process.stdout.write(`  ${tc.id.padEnd(46)}`);

    let raw = '';
    try {
      raw = await llm.complete({ system, user });
    } catch (err) {
      console.log(c.red(`ERROR — ${err.message}`));
      results.push({ tc, error: err.message, score: null });
      persist();
      continue;
    }

    /**
     * A prose answer has no findings array, and demanding one would fail every
     * interactive case on a technicality. Severity and noise caps are checks on
     * *findings*, so they only apply where findings were asked for.
     */
    let parsed = { findings: [], summary: '' };
    if (!isQuestion) {
      try {
        parsed = parseFindings(raw);
      } catch (err) {
        console.log(c.red(`ERROR — ${err.message}`));
        results.push({ tc, error: err.message, score: null });
        persist();
        continue;
      }
    }
    const score = scoreOutput(raw, tc.def);
    const sev = isQuestion ? { ok: true } : checkSeverity(parsed.findings, tc.def);
    const cap = isQuestion ? { ok: true } : checkMaxFindings(parsed.findings, tc.def);
    const pass = score.pass && sev.ok && cap.ok;

    results.push({ tc, raw, parsed, score, sev, cap, pass });
    persist();

    const label = pass
      ? c.green('PASS')
      : score.violations.length
        ? c.red('FAIL')
        : c.yellow('PARTIAL');
    console.log(
      `${label}  ${score.expectPassed}/${score.expectTotal} expected` +
        (score.violations.length ? c.red(`  ${score.violations.length} violation(s)`) : '') +
        (sev.ok ? '' : c.yellow(`  severity: ${sev.note}`)) +
        (cap.ok ? '' : c.red(`  noise: ${cap.note}`)),
    );

    if (args.verbose || !pass) {
      for (const e of score.expected.filter((x) => !x.pass)) {
        console.log(c.dim(`      missed: ${e.name}`));
      }
      for (const v of score.violations) {
        console.log(c.red(`      VIOLATION: ${v.name}`) + c.dim(` — matched "${v.evidence}"`));
      }
    }
    if (args.verbose) {
      console.log(c.dim(`      ${parsed.findings.length} finding(s): ${parsed.findings.map((f) => f.severity).join(', ')}`));
    }
  }

  // ---- Report -------------------------------------------------------------

  /**
   * Every case in this suite run, restored and fresh together.
   *
   * `results` holds only cases run in *this* invocation. Under `--resume` the
   * restored rows were written back to results.json but never considered again,
   * so the summary and the exit code both judged whatever happened to be left
   * over. Resuming a run with forty failures and one new passing case reported
   * one of one passing, and exited 0.
   *
   * Restored rows are already flat, so they are lifted into the same shape the
   * reporting below expects rather than being special-cased at each use.
   */
  const restored = previous.map((row) => ({
    tc: { id: row.id, def: { agent: row.agent, ...(row.clean ? { expectMaxFindings: 0 } : {}) } },
    pass: row.pass,
    score: {
      expectPassed: row.expectPassed ?? 0,
      expectTotal: row.expectTotal ?? 0,
      violations: (row.violations ?? []).map((name) => ({ name })),
    },
    sev: { ok: row.severity },
    cap: { ok: row.noise },
    error: row.error,
    restored: true,
  }));
  const all = [...restored, ...results];

  const passed = all.filter((r) => r.pass).length;
  const violated = all.filter((r) => r.score?.violations.length).length;

  console.log(c.bold('\n  Summary\n'));
  console.log(
    `  ${passed}/${all.length} passed` +
      (restored.length ? c.dim(`  (${restored.length} restored, ${results.length} run now)`) : ''),
  );
  if (violated) console.log(c.red(`  ${violated} case(s) produced forbidden advice — these matter most`));
  console.log(c.dim(`  ~$${llm.spentUsd.toFixed(3)} spent`));

  /**
   * Split the report by what the failure actually tells you.
   *
   * A weak or small model misses findings for capability reasons, so a failed
   * *dirty* case is ambiguous — it may be the prompt, it may be the model. A
   * failed *clean* case is not ambiguous: the model invented findings on
   * correct code, and no amount of model capability makes that acceptable.
   * Same for a forbidden-advice violation.
   */
  const cleanResults = all.filter((r) => r.tc.def.expectMaxFindings !== undefined);
  const cleanFailed = cleanResults.filter((r) => !r.pass);
  const dirtyResults = all.filter((r) => r.tc.def.expectMaxFindings === undefined);
  const dirtyFailed = dirtyResults.filter((r) => !r.pass);

  console.log(c.bold('\n  Read this first — failures that mean something\n'));

  if (violated) {
    console.log(c.red(`  ${violated} forbidden-advice violation(s)`));
    for (const r of all.filter((x) => x.score?.violations.length)) {
      for (const v of r.score.violations) console.log(c.red(`    ${r.tc.id} — ${v.name}`));
    }
  }

  if (cleanFailed.length) {
    console.log(c.red(`\n  ${cleanFailed.length}/${cleanResults.length} clean case(s) failed — the model reported problems in correct code`));
    for (const r of cleanFailed) {
      console.log(c.red(`    ${r.tc.id}`) + c.dim(`  ${r.cap?.note ?? r.sev?.note ?? ''}`));
    }
  } else if (cleanResults.length) {
    console.log(c.green(`  all ${cleanResults.length} clean case(s) passed — no invented findings`));
  }

  if (dirtyFailed.length) {
    console.log(
      c.yellow(`\n  ${dirtyFailed.length}/${dirtyResults.length} case(s) missed expected findings`) +
        c.dim(' — ambiguous on a small model; check whether the finding is genuinely absent'),
    );
    // Sorted worst-first: a case matching 1 of 8 is a different problem from one
    // matching 7 of 8, and the flat list gave no way to tell them apart.
    for (const r of [...dirtyFailed].sort(
      (a, b) => (a.score?.expectPassed ?? 0) / Math.max(1, a.score?.expectTotal ?? 1)
        - (b.score?.expectPassed ?? 0) / Math.max(1, b.score?.expectTotal ?? 1),
    )) {
      const got = r.score?.expectPassed ?? 0;
      const want = r.score?.expectTotal ?? 0;
      const line = `    ${r.tc.id}  ${got}/${want}`;
      // Missing most of what was expected is a signal, not noise.
      console.log(want && got / want < 0.5 ? c.yellow(line) : c.dim(line));
    }
  }

  console.log(c.dim(`\n  Results: evals/results.json  ·  re-run with --resume to continue\n`));

  if (args.json) {
    /**
     * One writer, not two.
     *
     * This used to serialise `results` itself, which was wrong twice over.
     * It dropped every restored row under `--resume`, and it emitted a
     * *different shape* — `{id, pass, score, sev, error}` against the
     * `{id, agent, clean, expectPassed, …}` that `persist()` writes and that
     * `--resume` and `evals/watch.mjs` both read back. So `--json` silently
     * corrupted its own resume file: cases lost their `clean` flag and were
     * all restored as dirty with a zero score.
     *
     * `persist()` already merges restored and fresh rows in the canonical
     * shape, and runs incrementally during the loop. Calling it here just
     * guarantees a final write.
     */
    persist();
    console.log(c.dim('  Wrote evals/results.json\n'));
  }

  /**
   * The gate.
   *
   * Two holes were here. It exited 0 unless a forbidden-advice violation
   * occurred — so a run where every call errored, or every clean case failed,
   * reported success. Those were closed. The remaining one: *dirty* failures
   * never reached this at all. `noneMatched` required every case in the suite
   * to score zero, so a single expectation matching anywhere kept the exit code
   * green while forty-eight cases missed most of what they were written to
   * catch.
   *
   * Dirty failures cannot simply be fatal, though: they are genuinely ambiguous
   * on a weak model, and a suite that always fails is one nobody runs. So they
   * gate on a *rate* — explicit, printed, and tunable with --min-pass-rate —
   * rather than being either ignored or absolute.
   */
  const MIN_PASS_RATE =
    args['min-pass-rate'] !== undefined ? Number(args['min-pass-rate']) : DEFAULT_MIN_PASS_RATE;
  if (!Number.isFinite(MIN_PASS_RATE) || MIN_PASS_RATE < 0 || MIN_PASS_RATE > 1) {
    console.log(c.red(`\n  Invalid --min-pass-rate "${args['min-pass-rate']}". Expected 0 to 1.\n`));
    process.exit(1);
  }

  const { reasons, dirtyRate, totalMatched, totalExpected, dirtyCount } = gateReasons(
    all,
    MIN_PASS_RATE,
  );

  if (dirtyCount) {
    // Expectations matched is what distinguishes a case that found 7 of 8 from
    // one that found 1 of 8 — both are a single failure in the rate above.
    console.log(
      c.dim(
        `  Dirty cases: ${(dirtyRate * 100) | 0}% fully passed, ` +
          `${totalMatched}/${totalExpected} expectations matched ` +
          `(floor ${(MIN_PASS_RATE * 100) | 0}%)\n`,
      ),
    );
  }

  if (reasons.length) {
    console.log(c.red(`  Failing: ${reasons.join('; ')}\n`));
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(c.red(`\n  ✗ ${err.message}\n`));
    process.exit(1);
  });
}
