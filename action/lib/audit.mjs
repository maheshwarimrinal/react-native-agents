/**
 * The audit engine: changed files + diff → structured, deduplicated findings.
 *
 * Each selected agent gets one call, with its own playbook as the system prompt
 * and the annotated diff as the user message. Agents run against the same diff
 * independently, so identical issues can surface more than once — dedupe runs
 * at the end rather than trying to coordinate the agents.
 */
import { renderForPrompt } from './diff.mjs';
import { BudgetExceededError } from './llm.mjs';

export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
export const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

const OUTPUT_CONTRACT = `
## Output format — read carefully

Respond with a single JSON object and nothing else. No prose before or after, no
markdown code fence around it.

{
  "findings": [
    {
      "severity": "P0" | "P1" | "P2" | "P3",
      "title": "One line, specific. Name the actual problem, not the category.",
      "file": "exact path as shown in the diff header",
      "line": <integer line number from the left gutter of the diff>,
      "why": "What goes wrong, concretely, for this codebase. 1-3 sentences.",
      "fix": "The change to make. Include a code snippet or diff when useful.",
      "verify": "How the author confirms it is fixed."
    }
  ],
  "summary": "One or two sentences on the overall state of this change."
}

Rules that matter:

- **Only report on lines present in the diff.** You are reviewing a change, not
  the whole repository. If something is wrong in unchanged code, ignore it.
- **The line number must come from the left gutter of the diff.** Do not guess.
  A finding pointing at the wrong line is worse than no finding.
- **Do not invent problems to seem useful.** An empty findings array is a
  perfectly good answer for a clean diff, and is far better than noise.
- **Do not inflate severity.** Reserve P0 for things that genuinely must block
  a release. A console.log is P3.
- **No duplicates.** One finding per distinct problem.
- Maximum 10 findings. If there are more, report the 10 highest-impact ones.
`;

/**
 * @param {object} opts
 * @param {object[]} opts.agents     agents selected by the router
 * @param {string} opts.sharedContext
 * @param {object[]} opts.diffFiles  parsed by diff.mjs
 * @param {import('./llm.mjs').LLM} opts.llm
 * @param {object} [opts.projectContext] detected RN/Expo versions etc.
 * @param {(m:string)=>void} [opts.log]
 */
export async function runAudit({
  agents,
  sharedContext,
  diffFiles,
  llm,
  projectContext = {},
  matchedFiles = {},
  log = () => {},
}) {
  const findings = [];
  const errors = [];
  const perAgent = {};
  let budgetHit = false;
  let anyTruncated = 0;

  const contextBlock = [
    '## Project context',
    '',
    ...Object.entries(projectContext).map(([k, v]) => `- ${k}: ${v}`),
    projectContext.reactNative ? '' : '- (versions could not be detected — do not assume)',
  ].join('\n');

  for (const agent of agents) {
    if (budgetHit) {
      perAgent[agent.id] = { skipped: 'budget exhausted' };
      continue;
    }

    // Include the agent's references so it reviews with full depth rather than
    // from memory. This is the bulk of the token spend and the bulk of the value.
    const references = agent.references
      .map((r) => `<reference name="${r.slug}">\n${r.content}\n</reference>`)
      .join('\n\n');

    const system = [
      agent.body,
      '',
      '---',
      '',
      sharedContext,
      '',
      '---',
      '',
      '# Reference library',
      '',
      'Apply this material. It is the detail behind your playbook.',
      '',
      references,
    ].join('\n');

    // Send this agent only the files that routed it.
    //
    // Previously every agent received one shared diff truncated to a global
    // character budget. On a large pull request that silently dropped whole
    // files in arbitrary order — the native-modules agent could be handed a
    // diff containing no native code and would correctly report nothing, which
    // is indistinguishable from a clean review. Per-agent slicing removes that
    // failure entirely and makes each prompt smaller and cheaper.
    const own = matchedFiles[agent.id];
    const scoped =
      own?.length ? diffFiles.filter((f) => own.includes(f.path)) : diffFiles;
    const rendered = renderForPrompt(scoped);
    anyTruncated += rendered.truncatedFiles;

    const user = [
      `You are reviewing a pull request.`,
      '',
      contextBlock,
      '',
      '## Files routed to you',
      '',
      scoped.map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`).join('\n'),
      '',
      scoped.length < diffFiles.length
        ? `_${diffFiles.length - scoped.length} other file(s) changed in this pull request are ` +
          'outside your area and were routed to other specialists. Review only what is below._\n'
        : '',
      '## Diff',
      '',
      'Each line is prefixed with its line number in the new file, then the diff marker.',
      '',
      rendered.text,
      '',
      OUTPUT_CONTRACT,
    ].join('\n');

    log(`▸ ${agent.title ?? agent.name} ${scoped.length} file(s)`);

    try {
      const raw = await llm.complete({ system, user });
      const parsed = parseFindings(raw);
      for (const f of parsed.findings) {
        findings.push({ ...f, agent: agent.id, agentTitle: agent.title ?? agent.name });
      }
      perAgent[agent.id] = {
        findings: parsed.findings.length,
        summary: parsed.summary,
        files: scoped.length,
      };
      log(`  ${parsed.findings.length} finding(s)`);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        budgetHit = true;
        perAgent[agent.id] = { skipped: 'budget exhausted' };
        log(`  ⚠ ${err.message}`);
        continue;
      }
      // One agent failing must not lose the findings from the others.
      errors.push({ agent: agent.id, message: err.message });
      perAgent[agent.id] = { error: err.message };
      log(`  ✗ ${err.message}`);
    }
  }

  return {
    findings: dedupe(findings).sort(bySeverityThenFile),
    perAgent,
    errors,
    budgetHit,
    truncatedFiles: anyTruncated,
    usage: { calls: llm.calls, inTokens: llm.inTokens, outTokens: llm.outTokens, costUsd: llm.spentUsd },
  };
}

/**
 * Models sometimes wrap JSON in a fence or add a sentence of preamble despite
 * instructions. Recover rather than discarding a whole agent's work.
 */
export function parseFindings(raw) {
  const empty = { findings: [], summary: '' };
  if (!raw || typeof raw !== 'string') return empty;

  let text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenced) text = fenced[1].trim();

  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return empty;
    text = text.slice(start, end + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empty;
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    findings: findings
      .filter((f) => f && typeof f.title === 'string' && f.title.trim())
      .map((f) => ({
        severity: SEVERITIES.includes(f.severity) ? f.severity : 'P2',
        title: String(f.title).trim(),
        file: typeof f.file === 'string' ? f.file.replace(/^\.?\//, '') : null,
        line: Number.isInteger(f.line) && f.line > 0 ? f.line : null,
        why: typeof f.why === 'string' ? f.why.trim() : '',
        fix: typeof f.fix === 'string' ? f.fix.trim() : '',
        verify: typeof f.verify === 'string' ? f.verify.trim() : '',
      })),
  };
}

/**
 * Two agents flagging the same line is common and correct — an unencrypted
 * token write is both a security and a code-quality issue. Keep the
 * higher-severity one and note the corroboration.
 */
export function dedupe(findings) {
  /** @type {any[]} */
  const kept = [];

  for (const f of findings) {
    // Exact-key matching is too brittle in practice: two agents describing the
    // same defect rarely word the title identically, and they often cite lines a
    // few apart. Compare by similarity instead, or the same issue is reported
    // twice at different severities — which reads as noise and erodes trust.
    const match = kept.find((k) => isSameIssue(k, f));

    if (!match) {
      kept.push({ ...f, alsoFlaggedBy: [] });
      continue;
    }

    const keep = SEVERITY_RANK[f.severity] < SEVERITY_RANK[match.severity] ? f : match;
    const drop = keep === f ? match : f;

    Object.assign(match, {
      ...keep,
      alsoFlaggedBy: [...new Set([...(match.alsoFlaggedBy ?? []), drop.agent])].filter(
        (a) => a && a !== keep.agent,
      ),
    });
  }

  return kept;
}

/**
 * Two findings describe the same issue when they sit in the same file, close
 * enough together, and share most of their meaningful vocabulary.
 */
export function isSameIssue(a, b, { lineWindow = 12, overlap = 0.5 } = {}) {
  if ((a.file ?? null) !== (b.file ?? null)) return false;

  // Both unplaced: fall back to title similarity alone.
  if (a.line != null && b.line != null && Math.abs(a.line - b.line) > lineWindow) return false;

  const wa = significantWords(a.title);
  const wb = significantWords(b.title);
  if (wa.size === 0 || wb.size === 0) return false;

  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;

  // Jaccard-ish: measured against the smaller set so a terse title still matches
  // a verbose one describing the same thing.
  return shared / Math.min(wa.size, wb.size) >= overlap;
}

const STOPWORDS = new Set([
  'the', 'and', 'but', 'not', 'this', 'that', 'with', 'from', 'into', 'for', 'are', 'was',
  'has', 'have', 'been', 'its', 'your', 'you', 'they', 'them', 'their', 'when', 'where',
  'which', 'while', 'should', 'could', 'would', 'does', 'here', 'there', 'than', 'then',
  'action', 'file', 'code', 'used', 'using', 'use', 'set', 'sets', 'add', 'adds',
]);

function significantWords(title) {
  return new Set(
    String(title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function bySeverityThenFile(a, b) {
  const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (s !== 0) return s;
  return (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0);
}

export function countBySeverity(findings) {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

/** Should this run fail the check? */
export function gateFails(findings, failOn) {
  if (!failOn || failOn === 'never') return false;
  const threshold = SEVERITY_RANK[failOn];
  if (threshold === undefined) return false;
  return findings.some((f) => SEVERITY_RANK[f.severity] <= threshold);
}
