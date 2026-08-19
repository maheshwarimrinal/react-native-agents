#!/usr/bin/env node
/**
 * React Native Agents — MCP server.
 *
 * Exposes the agent playbooks and their reference libraries to any MCP client
 * (Claude Desktop, Cursor, Windsurf, Zed, Continue, custom hosts).
 *
 * Deliberately zero-dependency: implements MCP's JSON-RPC 2.0 over stdio
 * directly, so `npx react-native-agents-mcp` works with no install step.
 *
 * Transport: newline-delimited JSON on stdin/stdout (the stdio transport).
 * Never write anything but protocol frames to stdout — logs go to stderr.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KNOWLEDGE,
  VERSION,
  composeFullPrompt,
  composePrompt,
  loadAgents,
  loadSharedContext,
} from '../scripts/lib/source.mjs';
import { explainRouting } from './routing.mjs';
import { captureDetached } from '../scripts/lib/telemetry.mjs';

const PROTOCOL_VERSION = '2024-11-05';
// Version comes from package.json so it can't drift from the published package.
const SERVER = { name: 'react-native-agents', version: VERSION };

const log = (...a) => process.stderr.write(`[rn-agents-mcp] ${a.join(' ')}\n`);

let AGENTS = [];
let SHARED = '';
try {
  AGENTS = loadAgents();
  SHARED = loadSharedContext();
  log(`loaded ${AGENTS.length} agents`);
} catch (err) {
  log(`fatal: ${err.message}`);
  process.exit(1);
}

const byId = new Map(AGENTS.map((a) => [a.id, a]));
const agentIds = AGENTS.map((a) => a.id);

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'list_react_native_agents',
    description:
      'List every available React Native specialist agent with its focus area, trigger keywords, and reference library. Call this first to discover which agent fits the task.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_react_native_agent',
    description:
      'Fetch a specialist React Native agent playbook — the full system prompt defining how that expert works. Use it to answer performance, security, code-quality, accessibility, testing, or release questions with expert methodology instead of general knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', enum: agentIds, description: 'Which specialist to load.' },
        include_references: {
          type: 'boolean',
          default: false,
          description:
            'Inline the entire reference library. Large. Prefer false, then fetch specific references with get_reference.',
        },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_reference',
    description:
      'Fetch one deep-dive reference document from an agent\'s library — for example the list-performance playbook, the OWASP MASVS checklist, or the accessibility checklist. These contain the concrete patterns, anti-patterns, code examples, and audit greps.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', enum: agentIds },
        reference: {
          type: 'string',
          description: 'Reference slug, e.g. "lists", "masvs-checklist". See list_react_native_agents.',
        },
      },
      required: ['agent_id', 'reference'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_agent',
    description:
      'Given a free-text description of a React Native problem, suggest which specialist agent(s) to use and why. Useful when the right expert is not obvious.',
    inputSchema: {
      type: 'object',
      properties: { task: { type: 'string', description: 'What the user is trying to do or fix.' } },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_audit_plan',
    description:
      'Return a structured, ordered plan for a full React Native audit across every review specialist, including the project-detection step and how to consolidate findings.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Optional path or area to scope the audit to.' },
      },
      additionalProperties: false,
    },
  },
];

function text(s) {
  return { content: [{ type: 'text', text: s }] };
}

function error(s) {
  return { content: [{ type: 'text', text: s }], isError: true };
}

function callTool(name, args = {}) {
  switch (name) {
    case 'list_react_native_agents': {
      const lines = AGENTS.map((a) =>
        [
          `## ${a.emoji ?? ''} ${a.title ?? a.name}  \`${a.id}\``,
          '',
          a.description,
          '',
          `**Triggers:** ${(a.triggers ?? []).join(', ') || '—'}`,
          `**References:** ${a.references.map((r) => r.slug).join(', ') || '—'}`,
        ].join('\n'),
      );
      return text(
        [
          '# React Native specialist agents',
          '',
          'Load one with `get_react_native_agent`, then pull specific references with `get_reference`.',
          '',
          ...lines,
        ].join('\n\n'),
      );
    }

    case 'get_react_native_agent': {
      // Which specialists people actually reach for. `agent_id` is validated
      // against this repo's own ids below, so a caller cannot smuggle a string
      // into the payload. No-op unless the user opted in.
      captureDetached('mcp_agent_loaded', { surface: 'mcp', agent_id: args?.agent_id });
      const agent = byId.get(args.agent_id);
      if (!agent) return error(`Unknown agent "${args.agent_id}". Available: ${agentIds.join(', ')}`);
      const body = args.include_references
        ? composeFullPrompt(agent, SHARED)
        : composePrompt(agent, SHARED);
      return text(
        [
          `# ${agent.title ?? agent.name} (v${agent.version})`,
          '',
          'Adopt the following operating instructions for this task.',
          '',
          '---',
          '',
          body,
        ].join('\n'),
      );
    }

    case 'get_reference': {
      const agent = byId.get(args.agent_id);
      if (!agent) return error(`Unknown agent "${args.agent_id}". Available: ${agentIds.join(', ')}`);
      const ref = agent.references.find((r) => r.slug === args.reference);
      if (!ref) {
        return error(
          `Unknown reference "${args.reference}" for ${agent.id}. Available: ${agent.references
            .map((r) => r.slug)
            .join(', ')}`,
        );
      }
      return text(ref.content);
    }

    case 'suggest_agent':
      // Weighted vocabulary scoring — see routing.mjs. Handles descriptions that
      // never name a React Native concept ("my catalogue is stuttering").
      return text(explainRouting(args.task, AGENTS).text);

    case 'get_audit_plan': {
      const scope = args.scope ? `\n\n**Scope:** ${args.scope}` : '';
      return text(
        [
          '# Full React Native audit plan' + scope,
          '',
          '## Step 1 — Establish context (do this first, always)',
          '',
          'Read `package.json`, `app.json` / `app.config.*`, and check whether `ios/` and `android/`',
          'exist. Determine and state: React Native version, Expo SDK, managed vs bare workflow,',
          'TypeScript or JavaScript, router, state library. Every finding below depends on these.',
          '',
          '## Step 2 — Run each specialist',
          '',
          ...AGENTS.map(
            (a, i) =>
              `${i + 1}. **${a.title ?? a.name}** — \`get_react_native_agent({ agent_id: "${a.id}" })\`\n   ${a.description}`,
          ),
          '',
          'Pull the relevant reference documents with `get_reference` as each area comes up — do not',
          'work from memory on specifics.',
          '',
          '## Step 3 — Consolidate',
          '',
          '1. One-paragraph health summary: is this shippable, and what is the single biggest risk?',
          '2. Severity table (P0/P1/P2/P3 by area).',
          '3. All P0 and P1 findings in full, deduplicated across agents.',
          '4. P2/P3 grouped by theme.',
          '5. **Top 5 actions** ranked by impact per unit of effort.',
          '',
          'Do not pad. If an area is clean, say so in one line.',
        ].join('\n'),
      );
    }

    default:
      return error(`Unknown tool: ${name}`);
  }
}

/* ------------------------------------------------------------------ *
 * Prompts — one per agent, plus the full audit
 * ------------------------------------------------------------------ */

const PROMPTS = [
  ...AGENTS.map((a) => ({
    name: a.id,
    description: a.description,
    arguments: [
      { name: 'task', description: 'What you want reviewed or built.', required: false },
    ],
  })),
  {
    name: 'rn-audit',
    description: 'Run a full React Native audit across every specialist agent.',
    arguments: [{ name: 'scope', description: 'Optional path or area.', required: false }],
  },
];

function getPrompt(name, args = {}) {
  if (name === 'rn-audit') {
    const plan = callTool('get_audit_plan', { scope: args.scope });
    return {
      description: 'Full React Native audit',
      messages: [{ role: 'user', content: { type: 'text', text: plan.content[0].text } }],
    };
  }
  const agent = byId.get(name);
  if (!agent) throw { code: -32602, message: `Unknown prompt: ${name}` };
  const body = composePrompt(agent, SHARED);
  const task = args.task ? `\n\n---\n\n**Task:** ${args.task}` : '';
  return {
    description: agent.description,
    messages: [
      { role: 'user', content: { type: 'text', text: `${body}${task}` } },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Resources — every playbook and reference, addressable by URI
 * ------------------------------------------------------------------ */

const RESOURCES = [
  { uri: 'rn-agents://shared/context', name: 'Shared React Native context', mimeType: 'text/markdown' },
  ...AGENTS.flatMap((a) => [
    {
      uri: `rn-agents://${a.id}/playbook`,
      name: `${a.title ?? a.name} — playbook`,
      description: a.description,
      mimeType: 'text/markdown',
    },
    ...a.references.map((r) => ({
      uri: `rn-agents://${a.id}/reference/${r.slug}`,
      name: `${a.title ?? a.name} — ${r.title}`,
      mimeType: 'text/markdown',
    })),
  ]),
];

function readResource(uri) {
  if (uri === 'rn-agents://shared/context') {
    return { contents: [{ uri, mimeType: 'text/markdown', text: SHARED }] };
  }
  const m = uri.match(/^rn-agents:\/\/([^/]+)\/(playbook|reference\/(.+))$/);
  if (!m) throw { code: -32602, message: `Unknown resource URI: ${uri}` };
  const agent = byId.get(m[1]);
  if (!agent) throw { code: -32602, message: `Unknown agent in URI: ${m[1]}` };

  const text =
    m[2] === 'playbook'
      ? composePrompt(agent, SHARED)
      : agent.references.find((r) => r.slug === m[3])?.content;

  if (text === undefined) throw { code: -32602, message: `Unknown reference: ${m[3]}` };
  return { contents: [{ uri, mimeType: 'text/markdown', text }] };
}

/* ------------------------------------------------------------------ *
 * JSON-RPC plumbing
 * ------------------------------------------------------------------ */

function handle(msg) {
  const { id, method, params = {} } = msg;

  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, prompts: {}, resources: {} },
        serverInfo: SERVER,
        instructions:
          'Six React Native specialist agents (performance, security, code quality, UI/accessibility, testing, release). ' +
          'Call list_react_native_agents to see them, get_react_native_agent to adopt one, and get_reference for deep-dive material.',
      };

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call':
      return callTool(params.name, params.arguments ?? {});

    case 'prompts/list':
      return { prompts: PROMPTS };

    case 'prompts/get':
      return getPrompt(params.name, params.arguments ?? {});

    case 'resources/list':
      return { resources: RESOURCES };

    case 'resources/read':
      return readResource(params.uri);

    case 'ping':
      return {};

    default:
      if (method?.startsWith('notifications/')) return null; // no response for notifications
      throw { code: -32601, message: `Method not found: ${method}` };
  }
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }

    // Notifications have no id and expect no response.
    const isNotification = msg.id === undefined || msg.id === null;

    try {
      const result = handle(msg);
      if (!isNotification && result !== null) {
        send({ jsonrpc: '2.0', id: msg.id, result });
      }
    } catch (err) {
      if (isNotification) continue;
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: typeof err?.code === 'number' ? err.code : -32603,
          message: err?.message ?? String(err),
        },
      });
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

log('ready on stdio');
