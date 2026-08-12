/**
 * Emitters — one per supported tool.
 *
 * Each emitter takes ({ agents, shared, distDir }) and returns
 * { name, files: string[], warnings: string[] }.
 */
import path from 'node:path';
import {
  KNOWLEDGE,
  VERSION,
  composeFullPrompt,
  composePrompt,
  copyReferences,
  serializeFrontmatter,
  writeFile,
} from './source.mjs';

const GENERATED_NOTE =
  '<!-- GENERATED FILE — do not edit. Source: agents/<id>/agent.md. Run `npm run build`. -->';

/* ------------------------------------------------------------------ *
 * Claude Code — plugin + marketplace + plain subagents
 * ------------------------------------------------------------------ */

export function emitClaudeCode({ agents, shared, distDir }) {
  const files = [];
  const out = path.join(distDir, 'claude-code');
  const pluginDir = path.join(out, 'plugins', 'react-native-agents');

  // --- Marketplace manifest, so users can `/plugin marketplace add <repo>` ---
  files.push(
    writeFile(
      path.join(out, '.claude-plugin', 'marketplace.json'),
      JSON.stringify(
        {
          name: 'react-native-agents',
          owner: { name: 'React Native Agents contributors' },
          metadata: {
            description: 'Expert React Native agents for performance, security, quality, a11y, testing, and release.',
            version: VERSION,
          },
          plugins: [
            {
              name: 'react-native-agents',
              source: './plugins/react-native-agents',
              description:
                'Six specialist React Native agents: performance, security, code quality, UI/accessibility, testing, and release.',
              version: VERSION,
              category: 'development',
              keywords: ['react-native', 'expo', 'mobile', 'performance', 'security', 'accessibility'],
            },
          ],
        },
        null,
        2,
      ),
    ),
  );

  files.push(
    writeFile(
      path.join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: 'react-native-agents',
          description:
            'Six specialist React Native agents: performance, security, code quality, UI/accessibility, testing, and release.',
          version: VERSION,
          license: 'MIT',
          keywords: ['react-native', 'expo', 'mobile'],
        },
        null,
        2,
      ),
    ),
  );

  for (const agent of agents) {
    const fm = {
      name: agent.id,
      description: agent.description,
      ...(agent.tools?.length ? { tools: agent.tools.join(', ') } : {}),
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.color ? { color: agent.color } : {}),
    };

    const prompt = composePrompt(agent, shared);
    const doc = `${serializeFrontmatter(fm)}\n${GENERATED_NOTE}\n\n${prompt}\n`;

    // Plugin-scoped agent + its references (agents Read these on demand).
    files.push(writeFile(path.join(pluginDir, 'agents', `${agent.id}.md`), doc));
    files.push(...copyReferences(agent, path.join(pluginDir, 'agents', agent.id)));

    // Standalone .claude/agents drop-in for users who don't want the plugin.
    files.push(writeFile(path.join(out, '.claude', 'agents', `${agent.id}.md`), doc));
    files.push(...copyReferences(agent, path.join(out, '.claude', 'agents', agent.id)));

    // Slash command that invokes the agent.
    if (agent.command) {
      const cmd = [
        serializeFrontmatter({
          description: agent.description,
          'argument-hint': '[path or question]',
        }),
        '',
        `Use the **${agent.id}** subagent to handle the following React Native request.`,
        '',
        'If no target is given, scope the review to the files changed on the current branch',
        '(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at',
        'rather than scanning the entire repository.',
        '',
        'Request: $ARGUMENTS',
        '',
      ].join('\n');
      files.push(writeFile(path.join(pluginDir, 'commands', `${agent.command}.md`), cmd));
      files.push(writeFile(path.join(out, '.claude', 'commands', `${agent.command}.md`), cmd));
    }
  }

  // Orchestrator command that runs the whole suite.
  const auditCmd = [
    serializeFrontmatter({
      description: 'Run a full React Native audit across all specialist agents.',
      'argument-hint': '[path or scope]',
    }),
    '',
    '# Full React Native audit',
    '',
    'Run a complete review of this React Native project using the specialist subagents.',
    '',
    '## Step 1 — Establish context',
    '',
    'Read `package.json`, `app.json` / `app.config.*`, and check for `ios/` and `android/`',
    'directories. Determine: React Native version, Expo SDK (if any), managed vs bare workflow,',
    'TypeScript or JavaScript, router, and state library. State these findings before proceeding —',
    'every agent depends on them.',
    '',
    '## Step 2 — Dispatch the specialists',
    '',
    'Run these subagents in parallel where possible:',
    '',
    ...agents.map((a) => `- **${a.id}** — ${a.title ?? a.name}`),
    '',
    'Scope: $ARGUMENTS (if empty, scope to `src/` and the app entry points, and say so).',
    '',
    '## Step 3 — Consolidate',
    '',
    'Merge the findings into one report:',
    '',
    '1. A one-paragraph health summary — is this shippable, and what is the single biggest risk?',
    '2. A severity table (P0/P1/P2/P3 counts by agent).',
    '3. All P0 and P1 findings in full, deduplicated where two agents found the same thing.',
    '4. P2/P3 grouped by theme, summarised.',
    '5. **Top 5 actions** ranked by impact per unit of effort — this is what the team will do.',
    '',
    'Do not pad the report. If an area is clean, say so in one line and move on.',
    '',
  ].join('\n');

  files.push(writeFile(path.join(pluginDir, 'commands', 'rn-audit.md'), auditCmd));
  files.push(writeFile(path.join(out, '.claude', 'commands', 'rn-audit.md'), auditCmd));

  return { name: 'claude-code', files, warnings: [] };
}

/* ------------------------------------------------------------------ *
 * Cursor — .cursor/rules/*.mdc
 * ------------------------------------------------------------------ */

export function emitCursor({ agents, shared, distDir }) {
  const files = [];
  const warnings = [];
  const rulesDir = path.join(distDir, 'cursor', '.cursor', 'rules');

  // One always-on rule carrying the shared project context.
  files.push(
    writeFile(
      path.join(rulesDir, 'react-native-context.mdc'),
      `${serializeFrontmatter({
        description: 'Baseline React Native ecosystem context and operating rules for all agents.',
        globs: '**/*.{ts,tsx,js,jsx}',
        alwaysApply: true,
      })}\n${GENERATED_NOTE}\n\n${shared}\n`,
    ),
  );

  for (const agent of agents) {
    const fm = {
      description: agent.description,
      globs: (agent.globs ?? ['**/*.{ts,tsx,js,jsx}']).join(','),
      alwaysApply: Boolean(agent.alwaysApply),
    };

    // Cursor rules are agent-requested; reference files ship alongside and are
    // @-mentionable, so we point at them rather than inlining everything.
    const refNote = agent.references.length
      ? [
          '',
          '## Reference library',
          '',
          'Deeper material lives beside this rule. Read the relevant file before advising on that area:',
          '',
          ...agent.references.map((r) => `- \`.cursor/rules/${agent.id}/${r.slug}.md\` — ${r.title}`),
        ].join('\n')
      : '';

    files.push(
      writeFile(
        path.join(rulesDir, `${agent.id}.mdc`),
        `${serializeFrontmatter(fm)}\n${GENERATED_NOTE}\n\n${agent.body}\n${refNote}\n`,
      ),
    );

    for (const ref of agent.references) {
      files.push(writeFile(path.join(rulesDir, agent.id, `${ref.slug}.md`), ref.content));
    }
  }

  return { name: 'cursor', files, warnings };
}

/* ------------------------------------------------------------------ *
 * Windsurf — .windsurf/rules/*.md  (12,000 char hard limit per file)
 * ------------------------------------------------------------------ */

const WINDSURF_LIMIT = 12000;

export function emitWindsurf({ agents, shared, distDir }) {
  const files = [];
  const warnings = [];
  const rulesDir = path.join(distDir, 'windsurf', '.windsurf', 'rules');

  const push = (name, frontmatter, content) => {
    const doc = `${serializeFrontmatter(frontmatter)}\n${content}\n`;
    if (doc.length > WINDSURF_LIMIT) {
      warnings.push(
        `windsurf: ${name} is ${doc.length} chars, over the ${WINDSURF_LIMIT} limit — Cascade will truncate it.`,
      );
    }
    files.push(writeFile(path.join(rulesDir, name), doc));
  };

  push(
    'react-native-context.md',
    { trigger: 'always_on' },
    trimForWindsurf(shared, WINDSURF_LIMIT - 200),
  );

  for (const agent of agents) {
    push(
      `${agent.id}.md`,
      {
        trigger: agent.alwaysApply ? 'always_on' : 'model_decision',
        description: agent.description,
        ...(agent.globs?.length && !agent.alwaysApply ? { globs: agent.globs.join(',') } : {}),
      },
      trimForWindsurf(agent.body, WINDSURF_LIMIT - 400),
    );

    // References ship as manual (@-mentionable) rules.
    for (const ref of agent.references) {
      push(
        `${agent.id}-${ref.slug}.md`,
        { trigger: 'manual', description: `${agent.title ?? agent.name}: ${ref.title}` },
        trimForWindsurf(ref.content, WINDSURF_LIMIT - 300),
      );
    }
  }

  return { name: 'windsurf', files, warnings };
}

/** Trim on a section boundary rather than mid-sentence. */
function trimForWindsurf(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSection = cut.lastIndexOf('\n## ');
  const boundary = lastSection > limit * 0.6 ? lastSection : cut.lastIndexOf('\n\n');
  return `${cut.slice(0, boundary > 0 ? boundary : limit)}\n\n_(Truncated to fit Windsurf's 12,000-character rule limit. Full text: \`agents/\` in the source repo.)_`;
}

/* ------------------------------------------------------------------ *
 * GitHub Copilot — .github/copilot-instructions.md + per-agent chatmodes
 * ------------------------------------------------------------------ */

export function emitCopilot({ agents, shared, distDir }) {
  const files = [];
  const out = path.join(distDir, 'copilot');

  const index = [
    GENERATED_NOTE,
    '',
    '# React Native — Copilot Instructions',
    '',
    'This project is a React Native application. Apply the following expertise when suggesting,',
    'reviewing, or writing code.',
    '',
    shared,
    '',
    '---',
    '',
    '# Specialist playbooks',
    '',
    'Detailed guidance by area. Apply the relevant one to the task at hand.',
    '',
    ...agents.map((a) => `- **${a.title ?? a.name}** — ${a.description}`),
    '',
    'Full playbooks are in `.github/instructions/`. Each is scoped with `applyTo` globs.',
    '',
  ].join('\n');

  files.push(writeFile(path.join(out, '.github', 'copilot-instructions.md'), index));

  for (const agent of agents) {
    // Path-scoped instruction files.
    files.push(
      writeFile(
        path.join(out, '.github', 'instructions', `${agent.id}.instructions.md`),
        `${serializeFrontmatter({
          applyTo: (agent.globs ?? ['**/*.{ts,tsx,js,jsx}']).join(','),
          description: agent.description,
        })}\n${GENERATED_NOTE}\n\n${composeFullPrompt(agent, '')}\n`,
      ),
    );

    // Chat modes — selectable personas in VS Code.
    files.push(
      writeFile(
        path.join(out, '.github', 'chatmodes', `${agent.id}.chatmode.md`),
        `${serializeFrontmatter({
          description: agent.description,
          tools: ['codebase', 'search', 'terminalLastCommand', 'problems', 'changes'],
        })}\n${GENERATED_NOTE}\n\n${composePrompt(agent, shared)}\n`,
      ),
    );
  }

  return { name: 'copilot', files, warnings: [] };
}

/* ------------------------------------------------------------------ *
 * AGENTS.md — the cross-tool convention (Codex, Zed, Jules, Aider, …)
 * ------------------------------------------------------------------ */

export function emitAgentsMd({ agents, shared, distDir }) {
  const files = [];
  const out = path.join(distDir, 'agents-md');

  const doc = [
    GENERATED_NOTE,
    '',
    '# AGENTS.md — React Native',
    '',
    'Guidance for AI coding agents working in this React Native repository.',
    '',
    '## How to use this file',
    '',
    'Read the baseline context below, then load the specialist playbook that matches the task from',
    '`.agents/react-native/`. Do not work from memory on version-specific details — verify against',
    "the project's own `package.json`.",
    '',
    '## Specialists',
    '',
    ...agents.map(
      (a) => `- **${a.title ?? a.name}** (\`.agents/react-native/${a.id}.md\`) — ${a.description}`,
    ),
    '',
    '---',
    '',
    shared,
    '',
  ].join('\n');

  files.push(writeFile(path.join(out, 'AGENTS.md'), doc));

  for (const agent of agents) {
    files.push(
      writeFile(
        path.join(out, '.agents', 'react-native', `${agent.id}.md`),
        `${GENERATED_NOTE}\n\n${composeFullPrompt(agent, '')}\n`,
      ),
    );
  }

  return { name: 'agents-md', files, warnings: [] };
}

/* ------------------------------------------------------------------ *
 * Machine-readable index, consumed by the MCP server and the CLI
 * ------------------------------------------------------------------ */

export function emitIndex({ agents, shared, distDir }) {
  const index = {
    generatedAt: null, // intentionally omitted so --check diffs are stable
    version: VERSION, // from package.json — single source of truth
    knowledge: KNOWLEDGE,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      title: a.title ?? a.name,
      description: a.description,
      version: a.version,
      emoji: a.emoji ?? null,
      color: a.color ?? null,
      command: a.command ?? null,
      triggers: a.triggers ?? [],
      globs: a.globs ?? [],
      references: a.references.map((r) => ({ slug: r.slug, title: r.title })),
    })),
    sharedContextChars: shared.length,
  };
  return {
    name: 'index',
    files: [writeFile(path.join(distDir, 'index.json'), JSON.stringify(index, null, 2))],
    warnings: [],
  };
}

export const TARGETS = {
  'claude-code': emitClaudeCode,
  cursor: emitCursor,
  windsurf: emitWindsurf,
  copilot: emitCopilot,
  'agents-md': emitAgentsMd,
  index: emitIndex,
};
