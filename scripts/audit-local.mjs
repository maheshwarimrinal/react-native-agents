#!/usr/bin/env node
/**
 * Run the audit against a locally-hosted model (Ollama, LM Studio, llama.cpp —
 * anything exposing an OpenAI-compatible `/v1/chat/completions`).
 *
 * The audit already speaks OpenAI's wire format, so this script adds no
 * capability. What it adds is the preflight nobody remembers to do by hand:
 *
 *   1. Is the server actually up? (Otherwise you get a bare ECONNREFUSED
 *      halfway through the first agent, after routing has already printed.)
 *   2. Is the model pulled? A typo'd tag reaches Ollama and comes back as a
 *      404 per agent, which reads like a code failure rather than a typo.
 *   3. **Is the context window big enough?** This is the one that matters.
 *      Ollama defaults `num_ctx` to 4096 for most models regardless of what the
 *      model supports. The audit sends whole changed files, so a real diff
 *      overflows that instantly — and Ollama does not error, it silently drops
 *      the front of the prompt. That front is the agent instructions. You get a
 *      confident, well-formatted, entirely ungrounded review, and a green
 *      "✓ Passed" that means nothing. This script measures the prompt and
 *      refuses to run when it will not fit.
 *
 * Usage:
 *   node scripts/audit-local.mjs                      # uncommitted changes
 *   node scripts/audit-local.mjs --base main          # this branch vs main
 *   node scripts/audit-local.mjs --diff-file pr.diff  # a saved diff
 *   node scripts/audit-local.mjs --model qwen2.5-coder:32b
 *   node scripts/audit-local.mjs --repo ~/my-app --base main
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
  else if (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) args[a.slice(2)] = process.argv[++i];
  else args[a.slice(2)] = 'true';
}

const BASE_URL = (args['base-url'] ?? process.env.OPENAI_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/+$/, '');
const MODEL = args.model ?? process.env.RN_AGENTS_LOCAL_MODEL ?? 'qwen2.5-coder:14b';
const REPO = path.resolve(args.repo ?? process.cwd());

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};
const die = (msg) => {
  console.error(`\n  ${c.red('✗')} ${msg}\n`);
  process.exit(1);
};

/* ---------------------------------------------------------------- 1. diff */

function getDiff() {
  if (args['diff-file']) {
    const p = path.resolve(args['diff-file']);
    if (!fs.existsSync(p)) die(`No such diff file: ${p}`);
    return fs.readFileSync(p, 'utf8');
  }

  const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  try {
    git('rev-parse', '--git-dir');
  } catch {
    die(`Not a git repository: ${REPO}\n    Pass --repo <path> or --diff-file <file>.`);
  }

  if (args.base) {
    // Compare against the merge base, not the branch tip, so commits that
    // landed on the base after you branched are not reported as your changes.
    let mergeBase;
    try {
      mergeBase = git('merge-base', 'HEAD', args.base).trim();
    } catch {
      die(`Cannot resolve base "${args.base}". Is it a branch that exists locally?`);
    }
    return git('diff', `${mergeBase}...HEAD`);
  }

  // Uncommitted work: staged and unstaged, plus untracked files, since a
  // brand-new component is exactly what you want reviewed.
  const tracked = git('diff', 'HEAD');
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
  const extra = untracked
    .filter((f) => /\.(ts|tsx|js|jsx|json|plist|xml|gradle|podspec)$/.test(f))
    .map((f) => {
      try {
        return git('diff', '--no-index', '--', '/dev/null', f);
      } catch (e) {
        // --no-index exits 1 when files differ, which is the normal case here.
        return e.stdout ?? '';
      }
    })
    .join('\n');

  return [tracked, extra].filter(Boolean).join('\n');
}

/* ------------------------------------------------------- 2. server preflight */

async function preflight() {
  const origin = BASE_URL.replace(/\/v1$/, '');

  let tags;
  try {
    const r = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) tags = await r.json();
  } catch {
    /* Not Ollama, or not up — fall through to the generic probe below. */
  }

  if (!tags) {
    try {
      await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(4000) });
      return null; // Reachable, but not Ollama — skip the model checks.
    } catch {
      die(
        `Cannot reach a model server at ${BASE_URL}\n` +
          `    Start Ollama with:  ollama serve\n` +
          `    Or point elsewhere: --base-url http://host:port/v1`,
      );
    }
  }

  const available = (tags.models ?? []).map((m) => m.name);
  if (!available.includes(MODEL)) {
    const near = available.filter((m) => m.split(':')[0] === MODEL.split(':')[0]);
    die(
      `Model "${MODEL}" is not pulled.\n` +
        (near.length ? `    Same family available: ${near.join(', ')}\n` : '') +
        `    Pull it with:  ollama pull ${MODEL}\n` +
        (available.length ? `    Or use one of: ${available.slice(0, 8).join(', ')}` : ''),
    );
  }
  return origin;
}

/**
 * The context check.
 *
 * `ollama show` reports the model's architectural limit, which is NOT the limit
 * it will run at — `num_ctx` in the loaded parameters is. When the two disagree
 * the smaller one wins, silently, by discarding the oldest tokens.
 */
async function contextWindow(origin) {
  try {
    const r = await fetch(`${origin}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const info = await r.json();

    const architectural = Object.entries(info.model_info ?? {}).find(([k]) =>
      k.endsWith('.context_length'),
    )?.[1];

    // An explicit num_ctx in the Modelfile parameters overrides the default.
    const explicit = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(info.parameters ?? '')?.[1];

    return {
      architectural: architectural ? Number(architectural) : null,
      configured: explicit ? Number(explicit) : null,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 3. run */

const diff = getDiff();
if (!diff.trim()) {
  console.log(`\n  ${c.dim('No changes to audit.')}`);
  console.log(`  ${c.dim('Try --base main, or --diff-file <file>.')}\n`);
  process.exit(0);
}

const files = [...diff.matchAll(/^diff --git .* b\/(.+)$/gm)].map((m) => m[1]);
console.log(`\n  ${c.bold('Local audit')}`);
console.log(`  ${c.dim(`model  ${MODEL}`)}`);
console.log(`  ${c.dim(`server ${BASE_URL}`)}`);
console.log(`  ${c.dim(`repo   ${REPO}`)}`);
console.log(`  ${c.dim(`diff   ${files.length} file(s), ${(diff.length / 1024).toFixed(1)} KB`)}`);

const origin = await preflight();

if (origin) {
  const ctx = await contextWindow(origin);
  // ~3.5 chars per token for source code, plus the agent instructions and
  // reference material the audit prepends. Deliberately conservative: being
  // wrong in this direction costs a warning, being wrong the other way costs
  // a review that looks fine and checked nothing.
  const estimate = Math.ceil(diff.length / 3.5) + 4000;
  const effective = ctx?.configured ?? ctx?.architectural ?? null;

  if (effective) {
    const detail = ctx.configured
      ? `num_ctx ${ctx.configured}`
      : `default; model supports ${ctx.architectural}`;
    console.log(`  ${c.dim(`context ~${estimate} tokens needed, ${effective} available (${detail})`)}`);

    if (estimate > effective) {
      console.error(
        `\n  ${c.red('✗')} This diff will not fit in the context window.\n\n` +
          `    Ollama does not error on overflow — it silently drops the oldest\n` +
          `    tokens, which are the agent's instructions. The review would still\n` +
          `    print findings and still say "Passed". It would mean nothing.\n\n` +
          `    Fix it with one of:\n` +
          `      • Raise the window:  OLLAMA_CONTEXT_LENGTH=32768 ollama serve\n` +
          `      • Audit less at once: --base <branch> on a smaller range\n` +
          `      • Use a hosted model for this one:\n` +
          `          node action/index.mjs --diff-file <f> --provider anthropic\n`,
      );
      process.exit(1);
    }
    if (!ctx.configured && ctx.architectural >= 32768) {
      console.log(
        `  ${c.yellow('!')} ${c.dim(
          'Ollama may still cap this at its own default. If findings look ' +
            'ungrounded, set OLLAMA_CONTEXT_LENGTH and restart the server.',
        )}`,
      );
    }
  }
}

const tmp = path.join(os.tmpdir(), `rn-agents-local-${Date.now()}.diff`);
fs.writeFileSync(tmp, diff);

const passthrough = [];
for (const k of ['fail-on', 'only', 'max-files', 'budget']) {
  if (args[k]) passthrough.push(`--${k}`, args[k]);
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'action', 'index.mjs'), '--diff-file', tmp, '--provider', 'openai', '--model', MODEL, ...passthrough],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENAI_BASE_URL: BASE_URL,
      // Any non-empty value satisfies the key check; a local server ignores it.
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'local',
      // Budgeting is already disabled for localhost, but be explicit: a local
      // model costs nothing and a dollar cap here is meaningless.
      RN_AGENTS_TELEMETRY: process.env.RN_AGENTS_TELEMETRY ?? 'off',
    },
  },
);

child.on('exit', (code) => {
  fs.rmSync(tmp, { force: true });
  process.exit(code ?? 0);
});
