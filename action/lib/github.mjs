/**
 * GitHub reporting — inline review comments plus a sticky summary.
 *
 * Two behaviours matter for this to be tolerable in a real repo:
 *
 * 1. The summary comment is *updated in place* across re-runs, rather than
 *    posting a new wall of text on every push. Nothing kills adoption faster
 *    than a bot that spams a PR.
 * 2. Inline comments are only posted for lines actually in the diff. GitHub
 *    rejects positions outside the diff, and a rejected comment shouldn't take
 *    the whole run down with it.
 */
import { findPosition, nearestChangedLine } from './diff.mjs';
import { countBySeverity } from './audit.mjs';
import { isIgnored } from './router.mjs';

const STICKY_MARKER = '<!-- rn-agents-audit -->';

const SEVERITY_LABEL = {
  P0: '🔴 **P0 — Critical**',
  P1: '🟠 **P1 — High**',
  P2: '🟡 **P2 — Medium**',
  P3: '⚪ **P3 — Low**',
};

export class GitHub {
  constructor({ token, repo, prNumber, sha, apiUrl = 'https://api.github.com', log = () => {} }) {
    this.token = token;
    this.repo = repo; // "owner/name"
    this.prNumber = prNumber;
    this.sha = sha;
    this.apiUrl = apiUrl;
    this.log = log;
  }

  async #api(path, init = {}) {
    const r = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`GitHub ${init.method ?? 'GET'} ${path} → ${r.status}: ${body.slice(0, 400)}`);
    }
    return r.status === 204 ? null : r.json();
  }

  /**
   * Fetch the pull request diff.
   *
   * The `.diff` media type is one request and gives a real unified diff, but
   * GitHub refuses it with **406 (`too_large`)** past roughly 300 files or
   * 20,000 lines. That is not rare — any PR that regenerates build output or
   * touches a lockfile crosses it easily.
   *
   * So on 406 we fall back to the paginated files API and rebuild a unified
   * diff from the per-file patches. That path is strictly better in one way:
   * we can drop ignored files (node_modules, dist, lockfiles) *before*
   * requesting their content, which is usually what made the diff oversized.
   */
  async getDiff() {
    const r = await fetch(`${this.apiUrl}/repos/${this.repo}/pulls/${this.prNumber}`, {
      headers: {
        accept: 'application/vnd.github.v3.diff',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
      },
    });

    if (r.ok) return r.text();

    if (r.status === 406) {
      this.log('  Diff too large for the diff endpoint — rebuilding from the files API…');
      return this.getDiffFromFiles();
    }

    const body = await r.text().catch(() => '');
    throw new Error(
      `Could not fetch PR diff: ${r.status}${describeStatus(r.status)}` +
        (body ? `\n    ${body.slice(0, 300)}` : ''),
    );
  }

  /**
   * Rebuild a unified diff from `GET /pulls/{n}/files`.
   *
   * Paginated at 100 per page, up to 3000 files. Each entry carries a `patch`
   * — absent for binary files and for individual files GitHub considers too
   * large, which we surface rather than silently dropping.
   */
  async getDiffFromFiles() {
    const files = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await this.#api(
        `/repos/${this.repo}/pulls/${this.prNumber}/files?per_page=100&page=${page}`,
      );
      files.push(...batch);
      if (batch.length < 100) break;
    }

    // Drop files no agent would review before reassembling. This is what makes
    // an oversized PR tractable — generated output is usually the bulk of it.
    const relevant = files.filter((f) => !isIgnored(f.filename));
    const skipped = files.length - relevant.length;
    const noPatch = relevant.filter((f) => !f.patch);

    this.log(
      `  ${files.length} changed file(s): ${relevant.length} reviewable` +
        (skipped ? `, ${skipped} ignored` : '') +
        (noPatch.length ? `, ${noPatch.length} without a patch (binary or too large)` : ''),
    );

    if (relevant.length === 0) {
      return '';
    }

    // The files API gives hunks without the `diff --git` framing our parser
    // expects, so rebuild the headers around each patch.
    return relevant
      .filter((f) => f.patch)
      .map((f) => {
        const from = f.status === 'added' ? '/dev/null' : `a/${f.previous_filename ?? f.filename}`;
        const to = f.status === 'removed' ? '/dev/null' : `b/${f.filename}`;
        const mode =
          f.status === 'added' ? 'new file mode 100644\n'
          : f.status === 'removed' ? 'deleted file mode 100644\n'
          : '';
        return (
          `diff --git a/${f.previous_filename ?? f.filename} b/${f.filename}\n` +
          mode +
          `--- ${from}\n+++ ${to}\n${f.patch}\n`
        );
      })
      .join('');
  }

  /**
   * Post findings as inline review comments in a single review, so the author
   * gets one notification rather than N.
   */
  async postInlineComments(findings, diffFiles) {
    const comments = [];
    const unplaceable = [];

    for (const f of findings) {
      if (!f.file || !f.line) {
        unplaceable.push(f);
        continue;
      }
      let position = findPosition(diffFiles, f.file, f.line);
      if (position === null) {
        // The model was close but not exact — snap onto the nearest changed line
        // rather than dropping a legitimate finding.
        const near = nearestChangedLine(diffFiles, f.file, f.line);
        position = near?.position ?? null;
      }
      if (position === null) {
        unplaceable.push(f);
        continue;
      }
      comments.push({ path: f.file, position, body: renderInline(f) });
    }

    if (comments.length) {
      try {
        await this.#api(`/repos/${this.repo}/pulls/${this.prNumber}/reviews`, {
          method: 'POST',
          body: JSON.stringify({
            commit_id: this.sha,
            event: 'COMMENT',
            comments: comments.slice(0, 50), // GitHub caps review comments per request
          }),
        });
        this.log(`  posted ${comments.length} inline comment(s)`);
      } catch (err) {
        // Inline placement is best-effort; the summary always carries everything.
        this.log(`  ⚠ inline comments failed, falling back to summary only: ${err.message}`);
        return { inline: 0, unplaceable: findings };
      }
    }

    return { inline: comments.length, unplaceable };
  }

  /** Create or update the single sticky summary comment. */
  async upsertSummary(body) {
    const withMarker = `${STICKY_MARKER}\n${body}`;
    const existing = await this.#findStickyComment();

    if (existing) {
      await this.#api(`/repos/${this.repo}/issues/comments/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: withMarker }),
      });
      this.log('  updated summary comment');
      return existing.id;
    }

    const created = await this.#api(`/repos/${this.repo}/issues/${this.prNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: withMarker }),
    });
    this.log('  created summary comment');
    return created.id;
  }

  async #findStickyComment() {
    const comments = await this.#api(
      `/repos/${this.repo}/issues/${this.prNumber}/comments?per_page=100`,
    );
    return comments.find((c) => c.body?.includes(STICKY_MARKER)) ?? null;
  }
}

/** Turn a bare status code into something actionable. */
function describeStatus(status) {
  switch (status) {
    case 401: return ' — the token is invalid or expired.';
    case 403: return ' — the token lacks permission. The workflow needs `pull-requests: write`.';
    case 404: return ' — pull request not found, or the token cannot see this repository.';
    case 406: return ' — GitHub considers this diff too large (over ~300 files or ~20,000 lines).';
    case 422: return ' — the request was rejected as unprocessable.';
    default: return status >= 500 ? ' — GitHub server error; retrying later may help.' : '';
  }
}

function renderInline(f) {
  const parts = [`${SEVERITY_LABEL[f.severity] ?? f.severity} — ${f.title}`, ''];
  if (f.why) parts.push(f.why, '');
  if (f.fix) parts.push('**Fix**', '', f.fix, '');
  if (f.verify && f.verify !== 'n/a') parts.push(`**Verify:** ${f.verify}`, '');
  const credits = [f.agentTitle, ...(f.alsoFlaggedBy ?? [])].filter(Boolean).join(', ');
  parts.push(`<sub>🤖 ${credits}</sub>`);
  return parts.join('\n');
}

/**
 * The summary comment. Ordered so the most important thing is visible without
 * expanding anything — people read the first two lines and skim the rest.
 */
export function renderSummary({
  findings,
  perAgent,
  usage,
  errors = [],
  budgetHit = false,
  truncatedFiles = 0,
  skippedAgents = [],
  reasons = {},
  gateFailed = false,
  failOn,
  unplaceable = [],
  projectContext = {},
}) {
  const counts = countBySeverity(findings);
  const total = findings.length;
  const out = [];

  out.push('## 🤖 React Native audit', '');

  if (total === 0) {
    out.push(
      errors.length
        ? '⚠️ No findings, but one or more agents errored — see details below.'
        : '✅ **No issues found in this diff.**',
      '',
    );
  } else {
    const headline =
      counts.P0 > 0
        ? `🔴 **${counts.P0} critical issue${counts.P0 === 1 ? '' : 's'}** must be fixed before merge.`
        : counts.P1 > 0
          ? `🟠 **${counts.P1} high-severity issue${counts.P1 === 1 ? '' : 's'}** found.`
          : `Found ${total} lower-severity item${total === 1 ? '' : 's'}.`;
    out.push(headline, '');
    out.push(
      '| P0 | P1 | P2 | P3 | Total |',
      '|---:|---:|---:|---:|------:|',
      `| ${counts.P0} | ${counts.P1} | ${counts.P2} | ${counts.P3} | ${total} |`,
      '',
    );
  }

  if (gateFailed) {
    out.push(`> ❌ This check failed because \`fail-on: ${failOn}\` was met.`, '');
  }

  // Findings that couldn't be attached to a diff line still need to be seen.
  if (unplaceable.length) {
    out.push('### Findings not attached to a line', '');
    for (const f of unplaceable) {
      out.push(
        `- ${SEVERITY_LABEL[f.severity] ?? f.severity} **${f.title}**` +
          (f.file ? ` — \`${f.file}${f.line ? `:${f.line}` : ''}\`` : ''),
      );
      if (f.why) out.push(`  ${f.why}`);
      if (f.fix) out.push(`  <details><summary>Fix</summary>\n\n${indent(f.fix)}\n\n  </details>`);
    }
    out.push('');
  }

  out.push('<details>', '<summary>Agents run</summary>', '');
  out.push('| Agent | Findings | Notes |', '|---|---:|---|');
  for (const [id, info] of Object.entries(perAgent)) {
    const note = info.error
      ? `⚠️ ${truncate(info.error, 60)}`
      : info.skipped
        ? `skipped — ${info.skipped}`
        : truncate(info.summary ?? '', 80);
    out.push(`| \`${id}\` | ${info.findings ?? '—'} | ${note} |`);
  }
  if (skippedAgents.length) {
    out.push('', `Not run (nothing in this diff matched): ${skippedAgents.map((a) => `\`${a.id}\``).join(', ')}`);
  }
  out.push('', '</details>', '');

  if (Object.keys(projectContext).length) {
    out.push('<details>', '<summary>Detected project</summary>', '');
    for (const [k, v] of Object.entries(projectContext)) out.push(`- **${k}**: ${v}`);
    out.push('', '</details>', '');
  }

  const notes = [];
  if (budgetHit) notes.push('⚠️ Budget cap reached — some agents did not run.');
  if (truncatedFiles) notes.push(`⚠️ ${truncatedFiles} large file(s) truncated in the diff sent for review.`);
  if (errors.length) notes.push(`⚠️ ${errors.length} agent(s) errored.`);
  if (notes.length) out.push(...notes, '');

  out.push(
    '<sub>',
    `${usage.calls} model call${usage.calls === 1 ? '' : 's'} · ` +
      `${fmt(usage.inTokens)} in / ${fmt(usage.outTokens)} out tokens · ` +
      `~$${usage.costUsd.toFixed(3)} · ` +
      '[react-native-agents](https://github.com/maheshwarimrinal/react-native-agents)',
    '</sub>',
  );

  return out.join('\n');
}

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const indent = (s) => s.split('\n').map((l) => `  ${l}`).join('\n');
