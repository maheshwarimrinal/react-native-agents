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

    // `unless` is the escape hatch: mentioning FlashList is fine if the answer
    // also says "measure first". Without this the forbid rules are too blunt.
    if (triggered && f.unless?.length) {
      const excused = f.unless.some((t) => haystack.includes(String(t).toLowerCase()));
      if (excused) triggered = false;
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

  if (args.agent) cases = cases.filter((tc) => tc.def.agent === args.agent);
  if (args.case) cases = cases.filter((tc) => tc.id === args.case || tc.id.endsWith(args.case));

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
    console.log();
    return;
  }

  // ---- Real run ----------------------------------------------------------
  const provider = args.provider ?? 'anthropic';
  const apiKey = args['api-key'] ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  const model = args.model ?? (provider === 'openai' ? 'gpt-5' : 'claude-sonnet-5');

  // A local runtime (Ollama, LM Studio) needs no key. Only demand one when
  // talking to a hosted endpoint.
  const needsKey =
    provider !== 'mock' && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(args['base-url'] ?? process.env.OPENAI_BASE_URL ?? '');
  if (needsKey && !apiKey) {
    console.error(
      c.red('\n  No API key. Set ANTHROPIC_API_KEY, or run with --validate for structural checks only.\n'),
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
    const user = [
      'Review the following file and report what a competent React Native engineer would flag.',
      '',
      `## Project context`,
      ...Object.entries(tc.def.context ?? {}).map(([k, v]) => `- ${k}: ${v}`),
      '',
      `## ${tc.inputName}`,
      '',
      '```',
      tc.input,
      '```',
      '',
      'Respond with a JSON object: {"findings":[{"severity","title","file","line","why","fix","verify"}],"summary"}.',
      'Return only the JSON.',
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

    const parsed = parseFindings(raw);
    const score = scoreOutput(raw, tc.def);
    const sev = checkSeverity(parsed.findings, tc.def);
    const cap = checkMaxFindings(parsed.findings, tc.def);
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
  const passed = results.filter((r) => r.pass).length;
  const violated = results.filter((r) => r.score?.violations.length).length;

  console.log(c.bold('\n  Summary\n'));
  console.log(`  ${passed}/${results.length} passed`);
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
  const cleanResults = results.filter((r) => r.tc.def.expectMaxFindings !== undefined);
  const cleanFailed = cleanResults.filter((r) => !r.pass);
  const dirtyFailed = results.filter((r) => r.tc.def.expectMaxFindings === undefined && !r.pass);

  console.log(c.bold('\n  Read this first — failures that mean something\n'));

  if (violated) {
    console.log(c.red(`  ${violated} forbidden-advice violation(s)`));
    for (const r of results.filter((x) => x.score?.violations.length)) {
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
      c.yellow(`\n  ${dirtyFailed.length} case(s) missed expected findings`) +
        c.dim(' — ambiguous on a small model; check whether the finding is genuinely absent'),
    );
    for (const r of dirtyFailed) {
      console.log(c.dim(`    ${r.tc.id}  ${r.score?.expectPassed ?? 0}/${r.score?.expectTotal ?? 0}`));
    }
  }

  console.log(c.dim(`\n  Results: evals/results.json  ·  re-run with --resume to continue\n`));

  if (args.json) {
    fs.writeFileSync(
      path.join(HERE, 'results.json'),
      JSON.stringify(
        results.map((r) => ({ id: r.tc.id, pass: r.pass, score: r.score, sev: r.sev, error: r.error })),
        null,
        2,
      ),
    );
    console.log(c.dim('  Wrote evals/results.json\n'));
  }

  process.exit(violated > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(c.red(`\n  ✗ ${err.message}\n`));
    process.exit(1);
  });
}
