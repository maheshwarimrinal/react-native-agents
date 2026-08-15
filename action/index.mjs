#!/usr/bin/env node
/**
 * React Native audit — GitHub Action entrypoint.
 *
 * Runs in the consumer's CI with the consumer's own API key, so there is no
 * hosted infrastructure and no inference cost to us. Zero dependencies.
 *
 * Also runnable locally against a diff file, which is how it is tested:
 *   node action/index.mjs --diff-file /tmp/pr.diff --provider mock --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgents, loadSharedContext } from '../scripts/lib/source.mjs';
import { route } from './lib/router.mjs';
import { changedFilePaths, parseDiff } from './lib/diff.mjs';
import { LLM } from './lib/llm.mjs';
import { countBySeverity, gateFails, runAudit } from './lib/audit.mjs';
import { GitHub, renderSummary } from './lib/github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ *
 * Inputs — GitHub Action env vars, with CLI flags for local runs
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const [k, v] = argv[i].slice(2).split('=');
    out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return out;
}

function input(name, fallback = '') {
  // Composite actions expose inputs as INPUT_<NAME> with dashes turned to underscores.
  const env = process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`];
  return env !== undefined && env !== '' ? env : fallback;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const v = String(value).replace(/\n/g, '%0A');
  fs.appendFileSync(file, `${name}=${v}\n`);
}

function summaryFile(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, `${md}\n`);
}

/* ------------------------------------------------------------------ *
 * Project detection — every agent's advice depends on this
 * ------------------------------------------------------------------ */

export function detectProject(root) {
  const ctx = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['react-native']) ctx.reactNative = deps['react-native'];
    if (deps.expo) ctx.expo = deps.expo;
    if (deps.react) ctx.react = deps.react;
    if (deps['expo-router']) ctx.router = 'expo-router';
    else if (deps['@react-navigation/native']) ctx.router = 'react-navigation';
    const state = ['zustand', 'jotai', '@reduxjs/toolkit', 'mobx'].filter((d) => deps[d]);
    if (state.length) ctx.stateManagement = state.join(', ');
    if (deps['@tanstack/react-query']) ctx.serverState = 'tanstack-query';
    if (deps['react-native-reanimated']) ctx.reanimated = deps['react-native-reanimated'];
  } catch {
    /* no package.json — leave context empty rather than guessing */
  }

  const hasIos = fs.existsSync(path.join(root, 'ios'));
  const hasAndroid = fs.existsSync(path.join(root, 'android'));
  if (ctx.expo) ctx.workflow = hasIos || hasAndroid ? 'expo (bare / prebuilt)' : 'expo (managed)';
  else if (hasIos || hasAndroid) ctx.workflow = 'bare react-native';

  ctx.language = fs.existsSync(path.join(root, 'tsconfig.json')) ? 'TypeScript' : 'JavaScript';
  return ctx;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const provider = args.provider ?? input('provider', 'anthropic');
  const apiKey =
    args['api-key'] ??
    input('api-key') ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY ??
    '';
  const model =
    args.model ??
    input('model', provider === 'openai' ? 'gpt-5' : 'claude-sonnet-5');
  const budgetUsd = Number(args.budget ?? input('budget-usd', '2'));
  const failOn = args['fail-on'] ?? input('fail-on', 'never');
  // Default true: an audit where agents errored produced no signal, and a green
  // check that means "we didn't actually look" is worse than a red one.
  const failOnError = String(args['fail-on-error'] ?? input('fail-on-error', 'true')) !== 'false';
  const only = (args.agents ?? input('agents', '')).split(',').map((s) => s.trim()).filter(Boolean);
  const maxAgents = Number(args['max-agents'] ?? input('max-agents', '6'));
  const dryRun = args['dry-run'] === 'true' || input('dry-run') === 'true';
  const workspace = args.workspace ?? process.env.GITHUB_WORKSPACE ?? process.cwd();

  if (provider !== 'mock' && !apiKey) {
    fail('No API key. Set the `api-key` input (or ANTHROPIC_API_KEY / OPENAI_API_KEY).');
  }

  // --- Get the diff -------------------------------------------------
  const token = args.token ?? input('github-token', process.env.GITHUB_TOKEN ?? '');
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? '';
  let prNumber = Number(args.pr ?? 0);
  let sha = args.sha ?? process.env.GITHUB_SHA ?? '';

  if (!prNumber && process.env.GITHUB_EVENT_PATH && fs.existsSync(process.env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      prNumber = event.pull_request?.number ?? 0;
      sha = event.pull_request?.head?.sha ?? sha;
    } catch {
      /* not a PR event */
    }
  }

  let diffText;
  let gh = null;

  if (args['diff-file']) {
    diffText = fs.readFileSync(args['diff-file'], 'utf8');
  } else {
    if (!token || !repo || !prNumber) {
      fail(
        'Not running on a pull request, and no --diff-file given.\n' +
          'This action only runs on `pull_request` events.',
      );
    }
    gh = new GitHub({ token, repo, prNumber, sha, log });
    diffText = await gh.getDiff();
  }

  const diffFiles = parseDiff(diffText);
  const changed = changedFilePaths(diffFiles);

  log(c.bold('\n  React Native audit\n'));
  log(`  ${changed.length} changed file(s)`);

  if (changed.length === 0) {
    log(c.dim('  Nothing to review.'));
    setOutput('total', 0);
    return;
  }

  // --- Detect project ------------------------------------------------
  const projectContext = detectProject(workspace);
  if (Object.keys(projectContext).length) {
    log(c.dim(`  ${Object.entries(projectContext).map(([k, v]) => `${k}=${v}`).join('  ')}`));
  }

  // --- Route ----------------------------------------------------------
  const agents = loadAgents();
  const sharedContext = loadSharedContext();
  const { selected, skipped, reasons, matchedFiles } = route(changed, agents, {
    only: only.length ? only : undefined,
    maxAgents,
    diffText,
  });

  log('');
  if (selected.length === 0) {
    log(c.dim('  No agent matched these changes — nothing to audit.'));
    setOutput('total', 0);
    return;
  }
  log(`  Routing to ${selected.length}/${agents.length} agent(s):`);
  for (const a of selected) log(`    ${a.emoji ?? '•'} ${a.id} ${c.dim(`— ${reasons[a.id]?.[0] ?? ''}`)}`);
  if (skipped.length) log(c.dim(`    skipped: ${skipped.map((a) => a.id).join(', ')}`));

  if (dryRun) {
    log(c.yellow('\n  Dry run — no model calls made.\n'));
    setOutput('agents', selected.map((a) => a.id).join(','));
    return;
  }

  // --- Audit -----------------------------------------------------------
  log('');
  const llm = new LLM({ provider, apiKey, model, budgetUsd, log });
  const result = await runAudit({
    agents: selected,
    sharedContext,
    diffFiles,
    llm,
    projectContext,
    matchedFiles,
    log,
  });

  // --- Report ------------------------------------------------------------
  let unplaceable = result.findings;
  if (gh) {
    const posted = await gh.postInlineComments(result.findings, diffFiles);
    unplaceable = posted.unplaceable;
  }

  const gateFailed = gateFails(result.findings, failOn);
  const summary = renderSummary({
    ...result,
    skippedAgents: skipped,
    reasons,
    gateFailed,
    failOn,
    unplaceable,
    projectContext,
  });

  if (gh) await gh.upsertSummary(summary);
  summaryFile(summary);

  const counts = countBySeverity(result.findings);
  setOutput('total', result.findings.length);
  for (const s of ['P0', 'P1', 'P2', 'P3']) setOutput(s.toLowerCase(), counts[s]);
  setOutput('cost-usd', result.usage.costUsd.toFixed(4));
  setOutput('agents', selected.map((a) => a.id).join(','));
  setOutput('findings-json', JSON.stringify(result.findings));

  log(c.bold('\n  Result\n'));
  log(`  P0 ${counts.P0}  P1 ${counts.P1}  P2 ${counts.P2}  P3 ${counts.P3}  (${result.findings.length} total)`);
  log(`  ${result.usage.calls} call(s), ~$${result.usage.costUsd.toFixed(3)}`);

  setOutput('errors', result.errors.length);
  setOutput('agents-failed', result.errors.map((e) => e.agent).join(','));
  setOutput('budget-hit', String(result.budgetHit));

  if (result.errors.length) {
    log(c.red(`\n  ${result.errors.length} agent(s) errored:`));
    for (const e of result.errors) log(c.red(`    ${e.agent}: ${e.message}`));
  }

  // An audit where every agent failed reports zero findings, which is
  // indistinguishable from a clean diff unless we say otherwise. This is how a
  // "no credits remaining" error ends up wearing a green tick.
  const allAgentsFailed = result.errors.length > 0 && result.errors.length === selected.length;

  if (gateFailed) {
    log(c.red(`\n  ✗ Failing: fail-on=${failOn} threshold met.\n`));
    process.exit(1);
  }

  if (allAgentsFailed) {
    log(c.red('\n  ✗ Every agent failed — this run reviewed nothing.\n'));
    process.exit(1);
  }

  if (result.errors.length && failOnError) {
    log(
      c.red(
        `\n  ✗ ${result.errors.length} of ${selected.length} agent(s) failed, so this review is incomplete.` +
          '\n    Set fail-on-error: false to treat partial results as a pass.\n',
      ),
    );
    process.exit(1);
  }

  if (result.budgetHit && failOnError) {
    log(
      c.red(
        '\n  ✗ Budget cap reached before every agent ran, so this review is incomplete.' +
          '\n    Raise budget-usd, or set fail-on-error: false to accept partial coverage.\n',
      ),
    );
    process.exit(1);
  }

  if (result.errors.length || result.budgetHit) {
    log(c.yellow('\n  ⚠ Passed, but coverage was incomplete (fail-on-error is off).\n'));
    return;
  }

  log(c.green('\n  ✓ Passed.\n'));
}

function fail(msg) {
  console.error(c.red(`\n  ✗ ${msg}\n`));
  process.exit(1);
}

// Only run when invoked directly, so tests can import the helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(c.red(`\n  ✗ ${err.message}\n`));
    if (process.env.RUNNER_DEBUG || process.env.DEBUG) console.error(err);
    process.exit(1);
  });
}
