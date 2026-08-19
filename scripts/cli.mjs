#!/usr/bin/env node
/**
 * rn-agents — install React Native agents into a project, for any supported tool.
 *
 *   npx @maheshwarimrinal/react-native-agents install                 auto-detect and install
 *   npx @maheshwarimrinal/react-native-agents install --tool cursor   install for a specific tool
 *   npx @maheshwarimrinal/react-native-agents install --agents rn-performance,rn-security
 *   npx @maheshwarimrinal/react-native-agents list
 *   npx @maheshwarimrinal/react-native-agents mcp                     run the MCP server on stdio
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { DIST_DIR, ROOT, loadAgents } from './lib/source.mjs';
import { apply, isUserOwned, plan, previewDiff, summarise } from './lib/install.mjs';
import {
  CONFIG_FILE,
  captureDetached,
  readConfig,
  setTelemetry,
  telemetryState,
  writeNoticeShown,
} from './lib/telemetry.mjs';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const TOOLS = {
  'claude-code': { label: 'Claude Code', from: 'claude-code', detect: ['.claude', 'CLAUDE.md'] },
  cursor: { label: 'Cursor', from: 'cursor', detect: ['.cursor', '.cursorrules'] },
  windsurf: { label: 'Windsurf', from: 'windsurf', detect: ['.windsurf', '.windsurfrules'] },
  copilot: { label: 'GitHub Copilot', from: 'copilot', detect: ['.github/copilot-instructions.md'] },
  codex: { label: 'Codex / Zed / Aider (AGENTS.md)', from: 'agents-md', detect: ['AGENTS.md'] },
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    } else out._.push(a);
  }
  return out;
}

function detectTools(cwd) {
  return Object.entries(TOOLS)
    .filter(([, t]) => t.detect.some((p) => fs.existsSync(path.join(cwd, p))))
    .map(([k]) => k);
}

function resolveConflictMode(args) {
  if (args.force) return 'overwrite';
  if (args.backup) return 'backup';
  return 'skip'; // safe default: never destroy anything the user wrote
}

/**
 * Download counts from the public npm registry.
 *
 * This is the honest answer to "how many people use this". It is real reach
 * rather than a sample of consenting users, it works for every release already
 * published, and it requires collecting nothing from anybody.
 */
const PKG_NAME = '@maheshwarimrinal/react-native-agents';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode === 404) {
        res.resume();
        resolve(null);
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timed out'));
    });
    req.on('error', reject);
  });
}

async function printDownloadStats(pkg = PKG_NAME) {
  const encoded = encodeURIComponent(pkg);
  console.log(c.bold(`\n  ${pkg}\n`));

  try {
    const [week, month, range] = await Promise.all([
      fetchJson(`https://api.npmjs.org/downloads/point/last-week/${encoded}`),
      fetchJson(`https://api.npmjs.org/downloads/point/last-month/${encoded}`),
      fetchJson(`https://api.npmjs.org/downloads/range/last-month/${encoded}`),
    ]);

    if (!week && !month) {
      console.log(c.dim('  No download data yet — the registry needs a day or so after first publish.\n'));
      return;
    }

    console.log(`  last 7 days    ${c.cyan(String(week?.downloads ?? 0))}`);
    console.log(`  last 30 days   ${c.cyan(String(month?.downloads ?? 0))}`);

    if (range?.downloads?.length) {
      const days = range.downloads;
      const peak = days.reduce((a, b) => (b.downloads > a.downloads ? b : a));
      const active = days.filter((d) => d.downloads > 0).length;
      console.log(`  busiest day    ${c.cyan(String(peak.downloads))} ${c.dim(`on ${peak.day}`)}`);
      console.log(`  days with any  ${c.dim(`${active} of ${days.length}`)}`);
    }

    console.log(c.dim('\n  Source: the public npm registry. No telemetry, no consent needed,'));
    console.log(c.dim('  and it counts everyone rather than only users who opted in.\n'));
  } catch (error) {
    console.log(c.red(`  Could not reach the npm registry: ${error.message}\n`));
  }
}

/**
 * A one-time, informational notice. Deliberately not a consent prompt: there is
 * nothing to consent to, because telemetry is already off. It exists so people
 * who *want* to help know the option is there.
 */
function maybeShowTelemetryNotice() {
  try {
    const config = readConfig();
    if (config.telemetryNoticeShown || config.telemetry !== undefined) return;
    if (process.env.CI) return; // nobody reads CI output for this

    console.log(
      c.dim('\n  Telemetry is off. If you would like to help by sharing anonymous') +
        c.dim('\n  adoption data (version, OS, which tool — never paths or code):') +
        `\n    ${c.cyan('npx @maheshwarimrinal/react-native-agents telemetry enable')}`,
    );

    writeNoticeShown(config);
  } catch {
    /* never let a notice break an install */
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] ?? 'install';
  const cwd = process.cwd();

  // `npx <this-package> mcp` — hand off to the MCP server in this same process.
  // MCP clients spawn a single command, so routing through the CLI keeps their
  // config to one entry point rather than a second binary name.
  if (cmd === 'mcp') {
    await import(path.join(ROOT, 'mcp-server', 'index.mjs'));
    return;
  }

  // Deterministic bundle analysis — no API key, no model call, no cost.
  if (cmd === 'size') {
    process.argv = [process.argv[0], path.join(ROOT, 'action', 'size.mjs'), ...process.argv.slice(3)];
    await import(path.join(ROOT, 'action', 'size.mjs'));
    return;
  }

  if (cmd === 'audit') {
    process.argv = [process.argv[0], path.join(ROOT, 'action', 'index.mjs'), ...process.argv.slice(3)];
    await import(path.join(ROOT, 'action', 'index.mjs'));
    return;
  }

  // Consent controls. Deliberately its own command rather than a flag, so
  // `telemetry status` can state plainly what is on and why.
  if (cmd === 'telemetry') {
    const action = args._[1];
    const state = telemetryState();

    if (action === 'enable') {
      const ok = setTelemetry(true);
      console.log(
        ok
          ? c.green('\n  Telemetry enabled.') +
              c.dim(`\n  Anonymous adoption events only. See TELEMETRY.md for the exact fields.\n  Config: ${CONFIG_FILE}\n`)
          : c.red('\n  Could not write the config file. Telemetry stays off.\n'),
      );
      return;
    }

    if (action === 'disable') {
      const ok = setTelemetry(false);
      console.log(
        ok
          ? c.green('\n  Telemetry disabled.\n')
          : c.red('\n  Could not write the config file.') +
              c.dim('\n  Set RN_AGENTS_TELEMETRY=0 in your environment instead.\n'),
      );
      return;
    }

    console.log(c.bold('\n  Telemetry'));
    console.log(`  status   ${state.enabled ? c.green('on') : c.dim('off')} ${c.dim(`(${state.reason})`)}`);
    console.log(c.dim(`  config   ${CONFIG_FILE}`));
    console.log(c.dim('\n  Off by default. Nothing is sent unless you turn it on.'));
    console.log(c.dim('  When on, it sends anonymous adoption events only — package version,'));
    console.log(c.dim('  Node major, OS, and which tool you installed for. Never paths, project'));
    console.log(c.dim('  names, repository names, code, or IP address.\n'));
    console.log(`  ${c.cyan('npx @maheshwarimrinal/react-native-agents telemetry enable')}`);
    console.log(`  ${c.cyan('npx @maheshwarimrinal/react-native-agents telemetry disable')}`);
    console.log(c.dim('\n  Also honoured: DO_NOT_TRACK=1, RN_AGENTS_TELEMETRY=0\n'));
    console.log(c.dim('  Full field list: TELEMETRY.md\n'));
    return;
  }

  // Public npm download counts. No telemetry involved — this reads the same
  // registry API that npmjs.com uses, works retroactively, and collects
  // nothing from anyone.
  if (cmd === 'stats') {
    await printDownloadStats(args._[1]);
    return;
  }

  if (cmd === 'list' || args.help || args.h) {
    const agents = loadAgents();
    console.log(c.bold('\n  React Native Agents\n'));
    for (const a of agents) {
      console.log(`  ${a.emoji ?? '•'}  ${c.cyan(a.id.padEnd(22))} ${a.title ?? a.name}`);
      console.log(`     ${c.dim(a.description)}`);
      console.log(
        c.dim(`     ${a.references.length} reference files${a.command ? ` · /${a.command}` : ''}\n`),
      );
    }
    console.log(c.bold('  Supported tools\n'));
    for (const [k, t] of Object.entries(TOOLS)) console.log(`  ${c.cyan(k.padEnd(14))} ${t.label}`);
    console.log(`
  ${c.bold('Usage')}
    npx @maheshwarimrinal/react-native-agents install                 auto-detect your tool
    npx @maheshwarimrinal/react-native-agents install --tool cursor   install for one tool
    npx @maheshwarimrinal/react-native-agents install --tool all      install for every tool
    npx @maheshwarimrinal/react-native-agents install --agents rn-security,rn-performance
    npx @maheshwarimrinal/react-native-agents list
    npx @maheshwarimrinal/react-native-agents mcp                     run the MCP server (stdio)

  ${c.bold('Analysis')}
    npx @maheshwarimrinal/react-native-agents size                    bundle composition ${c.dim('(free — no API key)')}
    npx @maheshwarimrinal/react-native-agents size --base main        regression vs a base branch
    npx @maheshwarimrinal/react-native-agents audit --diff-file d.diff  agent review of a diff

  ${c.bold('Existing files')}
    Conflicts are ${c.bold('skipped by default')} — nothing you wrote is ever replaced silently.

    --dry-run      show exactly what would be created, skipped, or conflict
    --verbose      with --dry-run, also show a diff of each conflict
    --backup       replace conflicts, keeping the original as <file>.bak
    --force        replace conflicts (files you authored are still backed up)
`);
    return;
  }

  if (cmd !== 'install') {
    console.error(c.red(`Unknown command: ${cmd}. Try \`install\`, \`list\`, \`size\`, \`audit\`, \`mcp\`, \`stats\`, or \`telemetry\`.`));
    process.exit(1);
  }

  let tools;
  if (args.tool === 'all') tools = Object.keys(TOOLS);
  else if (typeof args.tool === 'string') tools = args.tool.split(',').map((s) => s.trim());
  else {
    tools = detectTools(cwd);
    if (tools.length === 0) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log(c.yellow('\n  No AI coding tool detected in this directory.\n'));
      Object.entries(TOOLS).forEach(([k, t], i) => console.log(`    ${i + 1}. ${t.label} ${c.dim(`(${k})`)}`));
      const answer = await rl.question('\n  Which tool? (number, name, or "all") ');
      rl.close();
      const keys = Object.keys(TOOLS);
      const byIndex = keys[Number(answer) - 1];
      tools = answer.trim() === 'all' ? keys : [byIndex ?? answer.trim()];
    } else {
      console.log(c.dim(`\n  Detected: ${tools.map((t) => TOOLS[t].label).join(', ')}`));
    }
  }

  const unknown = tools.filter((t) => !TOOLS[t]);
  if (unknown.length) {
    console.error(c.red(`\n  Unknown tool(s): ${unknown.join(', ')}`));
    console.error(c.dim(`  Known: ${Object.keys(TOOLS).join(', ')}\n`));
    process.exit(1);
  }

  const selected =
    typeof args.agents === 'string' ? args.agents.split(',').map((s) => s.trim()) : null;
  const filter = selected
    ? (file) => selected.some((id) => file.includes(id)) || /context|marketplace|plugin\.json|AGENTS\.md|copilot-instructions/.test(file)
    : undefined;

  // ---- Plan everything before touching the filesystem -------------------
  const dryRun = Boolean(args['dry-run']);
  const onConflict = resolveConflictMode(args);

  const plans = [];
  for (const tool of tools) {
    const src = path.join(DIST_DIR, TOOLS[tool].from);
    if (!fs.existsSync(src)) {
      console.error(c.red(`\n  ✗ ${TOOLS[tool].label}: dist/ not built. Run \`npm run build\`.\n`));
      process.exit(1);
    }
    plans.push({ tool, entries: plan(src, cwd, { filter }) });
  }

  const allEntries = plans.flatMap((p) => p.entries);
  const stats = summarise(allEntries);

  console.log(
    c.bold(dryRun ? '\n  Installation preview (no files will be changed)\n' : '\n  Installing React Native agents\n'),
  );

  // ---- Show conflicts before doing anything ------------------------------
  if (stats.conflict.length) {
    console.log(c.yellow(`  ${stats.conflict.length} file(s) already exist and differ:\n`));
    for (const e of stats.conflict.slice(0, 12)) {
      const tag = isUserOwned(e.rel) ? c.red(' (your file)') : '';
      console.log(`    ${c.yellow('!')} ${e.rel}${tag}`);
      if (args.verbose) {
        console.log(c.dim(previewDiff(e).split('\n').map((l) => `        ${l}`).join('\n')));
      }
    }
    if (stats.conflict.length > 12) console.log(c.dim(`    …and ${stats.conflict.length - 12} more`));

    const verb = onConflict === 'skip' ? 'left untouched' : onConflict === 'backup' ? 'backed up then replaced' : 'REPLACED';
    console.log(
      c.dim(`\n  These will be ${verb}.`) +
        (onConflict === 'skip'
          ? c.dim('  Use --force to replace, or --backup to keep a .bak copy.\n')
          : '\n'),
    );
  }

  if (dryRun) {
    for (const { tool, entries } of plans) {
      const s = summarise(entries);
      console.log(
        `  ${TOOLS[tool].label.padEnd(32)} ${c.green(`+${s.create} new`)}` +
          (s.conflict.length ? c.yellow(`  !${s.conflict.length} conflict`) : '') +
          (s.identical ? c.dim(`  =${s.identical} unchanged`) : ''),
      );
    }
    console.log(c.dim(`\n  ${stats.total} file(s) evaluated. Nothing was written.\n`));
    return;
  }

  // ---- Apply ---------------------------------------------------------------
  let created = 0;
  let skipped = 0;
  let overwritten = 0;
  const backedUp = [];

  for (const { tool, entries } of plans) {
    const r = apply(entries, { onConflict });
    created += r.created;
    skipped += r.skipped;
    overwritten += r.overwritten;
    backedUp.push(...r.backedUp);
    console.log(
      `  ${c.green('✓')} ${TOOLS[tool].label.padEnd(32)} ${c.dim(`${r.created} written`)}` +
        (r.skipped ? c.yellow(` · ${r.skipped} skipped`) : '') +
        (r.overwritten ? c.yellow(` · ${r.overwritten} replaced`) : ''),
    );
  }

  // Adoption event. `tool` is one of a fixed vocabulary defined in this repo —
  // never a path, a project name, or anything the user typed. No-op unless the
  // user has explicitly opted in.
  for (const { tool } of plans) {
    captureDetached('cli_install', { surface: 'cli', command: 'install', tool });
  }

  // First-run notice, shown once, only when telemetry is OFF and unconfigured.
  // It tells people the feature exists rather than asking them to consent to
  // something already happening.
  maybeShowTelemetryNotice();

  console.log(c.dim(`\n  ${created} file(s) written to ${cwd}`));
  if (skipped) {
    console.log(
      c.yellow(`  ${skipped} existing file(s) left untouched.`) +
        c.dim(' Re-run with --force or --backup to replace them.'),
    );
  }
  if (backedUp.length) console.log(c.dim(`  Backups: ${backedUp.slice(0, 5).join(', ')}${backedUp.length > 5 ? ', …' : ''}`));
  console.log();

  console.log(`  ${c.bold('Next:')}`);
  if (tools.includes('claude-code')) console.log(`    Claude Code  ${c.dim('restart, then run /rn-audit')}`);
  if (tools.includes('cursor')) console.log(`    Cursor       ${c.dim('rules load automatically; @-mention a rule to force it')}`);
  if (tools.includes('windsurf')) console.log(`    Windsurf     ${c.dim('rules load automatically; @-mention for reference files')}`);
  if (tools.includes('copilot')) console.log(`    Copilot      ${c.dim('pick a chat mode in the VS Code chat panel')}`);
  console.log();
}

main().catch((err) => {
  console.error(c.red(`\n  ✗ ${err.message}\n`));
  process.exit(1);
});
