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
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { DIST_DIR, ROOT, loadAgents } from './lib/source.mjs';
import { apply, isUserOwned, plan, previewDiff, summarise } from './lib/install.mjs';

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
    console.error(c.red(`Unknown command: ${cmd}. Try \`install\`, \`list\`, \`size\`, \`audit\`, or \`mcp\`.`));
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
