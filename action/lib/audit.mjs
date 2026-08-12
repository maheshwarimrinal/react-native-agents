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
export async function runAudit({ agents, sharedContext, diffFiles, llm, projectContext = {}, log = () => {} }) {
  const rendered = renderForPrompt(diffFiles);
  const findings = [];
  const errors = [];
  const perAgent = {};
  let budgetHit = false;

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

    const user = [
      `You are reviewing a pull request.`,
      '',
      contextBlock,
      '',
      '## Changed files',
      '',
      diffFiles.map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`).join('\n'),
      '',
      '## Diff',
      '',
      'Each line is prefixed with its line number in the new file, then the diff marker.',
      '',
      rendered.text,
      '',
      OUTPUT_CONTRACT,
    ].join('\n');

    log(`▸ ${agent.title ?? agent.name}`);

    try {
      const raw = await llm.complete({ system, user });
      const parsed = parseFindings(raw);
      for (const f of parsed.findings) {
        findings.push({ ...f, agent: agent.id, agentTitle: agent.title ?? agent.name });
      }
      perAgent[agent.id] = { findings: parsed.findings.length, summary: parsed.summary };
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
    truncatedFiles: rendered.truncatedFiles,
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
  const byLocation = new Map();

  for (const f of findings) {
    const key = `${f.file ?? '?'}:${f.line ?? '?'}:${normalizeTitle(f.title)}`;
    const existing = byLocation.get(key);
    if (!existing) {
      byLocation.set(key, { ...f, alsoFlaggedBy: [] });
      continue;
    }
    const keep = SEVERITY_RANK[f.severity] < SEVERITY_RANK[existing.severity] ? f : existing;
    const drop = keep === f ? existing : f;
    byLocation.set(key, {
      ...keep,
      alsoFlaggedBy: [...new Set([...(existing.alsoFlaggedBy ?? []), drop.agent])].filter(
        (a) => a !== keep.agent,
      ),
    });
  }

  return [...byLocation.values()];
}

function normalizeTitle(t) {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
    .sort()
    .join(' ');
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
