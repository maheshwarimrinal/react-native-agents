#!/usr/bin/env node
/**
 * Validation suite. Zero dependencies — uses node:test.
 *
 *   node scripts/test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { loadAgents, loadSharedContext, parseFrontmatter, serializeFrontmatter } = await import(
  path.join(ROOT, 'scripts/lib/source.mjs')
);

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push({ name, err });
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push({ name, err });
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

/* ---------------------------------------------------------------- *
 * Frontmatter parser
 * ---------------------------------------------------------------- */

test('parses scalars, booleans, numbers', () => {
  const { data } = parseFrontmatter('---\nid: x\nalwaysApply: true\nn: 42\n---\nbody');
  assert(data.id === 'x', 'string');
  assert(data.alwaysApply === true, 'boolean');
  assert(data.n === 42, 'number');
});

test('parses block lists', () => {
  const { data } = parseFrontmatter('---\ntools:\n  - Read\n  - Grep\n---\n');
  assert(Array.isArray(data.tools) && data.tools.length === 2, 'block list');
});

test('parses flow lists', () => {
  const { data } = parseFrontmatter('---\ntools: [Read, Grep, Bash]\n---\n');
  assert(data.tools.length === 3 && data.tools[2] === 'Bash', 'flow list');
});

test('strips quotes', () => {
  const { data } = parseFrontmatter('---\nemoji: "⚡"\n---\n');
  assert(data.emoji === '⚡', 'quoted string');
});

test('separates body from frontmatter', () => {
  const { body } = parseFrontmatter('---\nid: x\n---\n# Heading\n\ntext');
  assert(body.startsWith('# Heading'), `body was: ${JSON.stringify(body.slice(0, 40))}`);
});

test('round-trips through serialize', () => {
  const input = { id: 'a', tools: ['Read', 'Grep'], alwaysApply: false, n: 3 };
  const { data } = parseFrontmatter(`${serializeFrontmatter(input)}body`);
  assert(data.id === 'a' && data.tools.length === 2 && data.n === 3, 'round trip');
  // alwaysApply: false is preserved
  assert(data.alwaysApply === false, 'false preserved');
});

test('handles content with no frontmatter', () => {
  const { data, body } = parseFrontmatter('# Just markdown');
  assert(Object.keys(data).length === 0 && body === '# Just markdown', 'passthrough');
});

/* ---------------------------------------------------------------- *
 * Agent sources
 * ---------------------------------------------------------------- */

const agents = loadAgents();
const shared = loadSharedContext();

test('loads at least six agents', () => assert(agents.length >= 6, `got ${agents.length}`));
test('shared context is non-trivial', () => assert(shared.length > 500, `got ${shared.length} chars`));

for (const a of agents) {
  test(`${a.id}: has required frontmatter`, () => {
    for (const f of ['id', 'name', 'description', 'version']) {
      assert(a[f], `missing ${f}`);
    }
  });

  test(`${a.id}: id is kebab-case and rn-prefixed`, () =>
    assert(/^rn-[a-z0-9-]+$/.test(a.id), `bad id: ${a.id}`));

  test(`${a.id}: description is descriptive enough to route on`, () =>
    assert(a.description.length >= 60, `description too short (${a.description.length})`));

  test(`${a.id}: body is substantial`, () =>
    assert(a.body.length > 1200, `body only ${a.body.length} chars`));

  test(`${a.id}: declares tools`, () =>
    assert(Array.isArray(a.tools) && a.tools.length > 0, 'no tools'));

  test(`${a.id}: has reference files`, () =>
    assert(a.references.length >= 3, `only ${a.references.length} references`));

  test(`${a.id}: declared references all exist on disk`, () => {
    const actual = a.references.map((r) => r.slug);
    for (const d of a.references.length ? (a.references, []) : []) void d;
    for (const declared of Array.isArray(a.referencesDeclared) ? a.referencesDeclared : []) {
      assert(actual.includes(declared), `missing ${declared}`);
    }
  });

  for (const r of a.references) {
    test(`${a.id}/${r.slug}: reference has a heading and content`, () => {
      assert(r.content.startsWith('#'), 'no top-level heading');
      assert(r.content.length > 800, `only ${r.content.length} chars`);
    });
  }

  test(`${a.id}: no unresolved authoring placeholders`, () => {
    // Note: `{{count}}` style braces are legitimate here (i18n interpolation
    // examples), so only genuine authoring markers are flagged.
    const all = [a.body, ...a.references.map((r) => r.content)].join('\n');
    const m = all.match(/\b(TODO|FIXME|XXX|TBD)\b|<placeholder>/i);
    assert(!m, `contains: ${m?.[0]}`);
  });

  test(`${a.id}: no non-ASCII stray characters in prose`, () => {
    // Allow common typography and the agent emoji; catch accidental CJK etc.
    const all = [a.body, ...a.references.map((r) => r.content)].join('\n');
    const stray = all.match(/[　-鿿가-힯]/g);
    assert(!stray, `found: ${stray?.slice(0, 5).join(' ')}`);
  });
}

test('agent ids are unique', () => {
  const ids = agents.map((a) => a.id);
  assert(new Set(ids).size === ids.length, 'duplicate ids');
});

test('slash commands are unique', () => {
  const cmds = agents.map((a) => a.command).filter(Boolean);
  assert(new Set(cmds).size === cmds.length, 'duplicate commands');
});

/* ---------------------------------------------------------------- *
 * Build output
 * ---------------------------------------------------------------- */

const DIST = path.join(ROOT, 'dist');

await testAsync('build produces dist/', async () => {
  await run('node', [path.join(ROOT, 'scripts/build.mjs')]);
  assert(fs.existsSync(DIST), 'no dist/');
});

const expectedPaths = [
  'index.json',
  'claude-code/.claude-plugin/marketplace.json',
  'claude-code/plugins/react-native-agents/.claude-plugin/plugin.json',
  'claude-code/plugins/react-native-agents/commands/rn-audit.md',
  'cursor/.cursor/rules/react-native-context.mdc',
  'windsurf/.windsurf/rules/react-native-context.md',
  'copilot/.github/copilot-instructions.md',
  'agents-md/AGENTS.md',
];

for (const p of expectedPaths) {
  test(`emits ${p}`, () => assert(fs.existsSync(path.join(DIST, p)), 'missing'));
}

for (const a of agents) {
  test(`${a.id}: emitted for every target`, () => {
    const targets = [
      `claude-code/.claude/agents/${a.id}.md`,
      `claude-code/plugins/react-native-agents/agents/${a.id}.md`,
      `cursor/.cursor/rules/${a.id}.mdc`,
      `windsurf/.windsurf/rules/${a.id}.md`,
      `copilot/.github/instructions/${a.id}.instructions.md`,
      `copilot/.github/chatmodes/${a.id}.chatmode.md`,
      `agents-md/.agents/react-native/${a.id}.md`,
    ];
    for (const t of targets) assert(fs.existsSync(path.join(DIST, t)), `missing ${t}`);
  });

  test(`${a.id}: Claude Code frontmatter is valid`, () => {
    const raw = fs.readFileSync(path.join(DIST, `claude-code/.claude/agents/${a.id}.md`), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    assert(data.name === a.id, `name mismatch: ${data.name}`);
    assert(typeof data.description === 'string' && data.description.length > 0, 'no description');
    assert(typeof data.tools === 'string' && data.tools.includes('Read'), `tools: ${data.tools}`);
    assert(body.length > 1000, 'body too short');
  });

  test(`${a.id}: Cursor .mdc frontmatter is valid`, () => {
    const raw = fs.readFileSync(path.join(DIST, `cursor/.cursor/rules/${a.id}.mdc`), 'utf8');
    const { data } = parseFrontmatter(raw);
    assert(typeof data.description === 'string', 'no description');
    assert(typeof data.globs === 'string' && data.globs.length > 0, 'no globs');
    assert(typeof data.alwaysApply === 'boolean', `alwaysApply: ${typeof data.alwaysApply}`);
  });

  test(`${a.id}: Windsurf rules respect the 12k char limit`, () => {
    const dir = path.join(DIST, 'windsurf/.windsurf/rules');
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(a.id));
    for (const f of files) {
      const size = fs.statSync(path.join(dir, f)).size;
      assert(size <= 12000, `${f} is ${size} bytes`);
    }
  });

  test(`${a.id}: Windsurf trigger is a valid mode`, () => {
    const raw = fs.readFileSync(path.join(DIST, `windsurf/.windsurf/rules/${a.id}.md`), 'utf8');
    const { data } = parseFrontmatter(raw);
    assert(
      ['always_on', 'model_decision', 'glob', 'manual'].includes(data.trigger),
      `trigger: ${data.trigger}`,
    );
  });
}

test('marketplace.json is valid JSON with one plugin', () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIST, 'claude-code/.claude-plugin/marketplace.json'), 'utf8'));
  assert(j.name && Array.isArray(j.plugins) && j.plugins.length === 1, 'bad marketplace');
  assert(j.plugins[0].source.startsWith('./'), 'plugin source must be a relative path');
});

test('index.json lists every agent', () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIST, 'index.json'), 'utf8'));
  assert(j.agents.length === agents.length, `index has ${j.agents.length}`);
});

await testAsync('--check passes against a fresh build', async () => {
  await run('node', [path.join(ROOT, 'scripts/build.mjs'), '--check']);
});

/* ---------------------------------------------------------------- *
 * MCP server smoke test over stdio
 * ---------------------------------------------------------------- */

await testAsync('MCP server: initialize, tools, prompts, resources', async () => {
  const responses = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_react_native_agents', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_react_native_agent', arguments: { agent_id: 'rn-performance' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_reference', arguments: { agent_id: 'rn-security', reference: 'masvs-checklist' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'suggest_agent', arguments: { task: 'my FlatList is janky and drops frames' } } },
    { jsonrpc: '2.0', id: 7, method: 'prompts/list' },
    { jsonrpc: '2.0', id: 8, method: 'resources/list' },
    { jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'rn-agents://rn-testing/playbook' } },
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_reference', arguments: { agent_id: 'rn-security', reference: 'nope' } } },
  ]);

  const r = (id) => responses.find((x) => x.id === id);

  assert(r(1)?.result?.serverInfo?.name === 'react-native-agents', 'initialize');
  assert(r(2)?.result?.tools?.length >= 5, 'tools/list');
  assert(r(3)?.result?.content?.[0]?.text?.includes('rn-performance'), 'list agents');
  assert(r(4)?.result?.content?.[0]?.text?.includes('performance engineer'), 'get agent');
  assert(r(5)?.result?.content?.[0]?.text?.includes('MASVS'), 'get reference');
  assert(r(6)?.result?.content?.[0]?.text?.includes('rn-performance'), 'suggest agent');
  assert(r(7)?.result?.prompts?.length >= 7, 'prompts/list');
  assert(r(8)?.result?.resources?.length > 20, 'resources/list');
  assert(r(9)?.result?.contents?.[0]?.text?.includes('test engineer'), 'resources/read');
  assert(r(10)?.result?.isError === true, 'unknown reference should be an error result');
});

await testAsync('MCP server: unknown method returns a JSON-RPC error', async () => {
  const [res] = await mcp([{ jsonrpc: '2.0', id: 1, method: 'does/notExist' }]);
  assert(res.error?.code === -32601, `got ${JSON.stringify(res)}`);
});

await testAsync('MCP server: notifications produce no response', async () => {
  const responses = await mcp([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'ping' },
  ]);
  assert(responses.length === 1 && responses[0].id === 1, `got ${responses.length} responses`);
});

/* ---------------------------------------------------------------- *
 * CLI
 * ---------------------------------------------------------------- */

await testAsync('CLI list runs and names every agent', async () => {
  const { stdout } = await run('node', [path.join(ROOT, 'scripts/cli.mjs'), 'list']);
  for (const a of agents) assert(stdout.includes(a.id), `missing ${a.id}`);
});

test('package.json declares a bin matching the package name', () => {
  // `npx <pkg>` resolves the bin named after the package. Without this entry npm
  // fails with "could not determine executable to run" when there are 2+ bins.
  // Scoped names resolve against the unscoped part, so `@user/react-native-agents`
  // still looks for a bin called `react-native-agents` — this stays correct if the
  // package is later republished under a scope.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const unscoped = pkg.name.replace(/^@[^/]+\//, '');
  assert(pkg.bin?.[unscoped], `no bin named "${unscoped}" (has: ${Object.keys(pkg.bin ?? {})})`);
});

test('scoped package is configured to publish publicly', () => {
  // Scoped packages default to "restricted", which requires a paid npm org —
  // publishing without this fails with a 402 that reads like a billing problem.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg.name.startsWith('@')) {
    assert(
      pkg.publishConfig?.access === 'public',
      `scoped package needs publishConfig.access="public" (got: ${pkg.publishConfig?.access})`,
    );
  }
});

test('publishConfig does not force provenance', () => {
  // `provenance: true` in publishConfig breaks local `npm publish` — provenance
  // can only be generated from a supported CI runner. The workflow passes
  // --provenance explicitly instead, so both paths work.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    pkg.publishConfig?.provenance !== true,
    'publishConfig.provenance=true breaks manual publish; pass --provenance in CI instead',
  );
});

test('prepublishOnly gates the release on build sync and tests', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const s = pkg.scripts?.prepublishOnly ?? '';
  assert(s.includes('--check'), 'prepublishOnly must verify dist/ is in sync');
  assert(s.includes('test'), 'prepublishOnly must run the test suite');
});

test('version is valid semver', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.version), `bad version: ${pkg.version}`);
});

test('repository metadata points at the real repo', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [field, value] of [
    ['repository.url', pkg.repository?.url],
    ['homepage', pkg.homepage],
    ['bugs.url', pkg.bugs?.url],
  ]) {
    assert(value, `${field} is unset`);
    assert(!/\bOWNER\b|example\.com/.test(value), `${field} still has a placeholder: ${value}`);
  }
});

test('docs contain no unreplaced OWNER placeholder', () => {
  for (const rel of ['README.md', 'CONTRIBUTING.md', 'scripts/cli.mjs']) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const hits = fs.readFileSync(full, 'utf8').match(/\bOWNER\b/g);
    assert(!hits, `${rel} has ${hits?.length} unreplaced OWNER placeholder(s)`);
  }
});

test('every declared bin exists and is executable ESM', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [name, rel] of Object.entries(pkg.bin ?? {})) {
    const full = path.join(ROOT, rel);
    assert(fs.existsSync(full), `bin "${name}" → missing ${rel}`);
    assert(
      fs.readFileSync(full, 'utf8').startsWith('#!/usr/bin/env node'),
      `bin "${name}" → ${rel} has no shebang`,
    );
  }
});

test('files allowlist covers everything the bins need at runtime', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const needed of ['agents', 'shared', 'scripts', 'mcp-server', 'dist']) {
    assert(pkg.files?.includes(needed), `"files" is missing ${needed}`);
  }
});

await testAsync('CLI `mcp` subcommand starts the MCP server', async () => {
  // This is the entry point every MCP client config uses — it must route to the
  // server, not fall through to the unknown-command branch.
  const responses = await mcpVia(
    [path.join(ROOT, 'scripts/cli.mjs'), 'mcp'],
    [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }],
  );
  assert(responses[0]?.result?.serverInfo?.name === 'react-native-agents', 'did not start server');
});

await testAsync('CLI rejects an unknown subcommand', async () => {
  let failed = false;
  try {
    await run('node', [path.join(ROOT, 'scripts/cli.mjs'), 'bogus']);
  } catch {
    failed = true;
  }
  assert(failed, 'unknown command should exit non-zero');
});

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */

console.log('\n');
if (failures.length) {
  console.log('\x1b[31mFailures:\x1b[0m\n');
  for (const f of failures) {
    console.log(`  \x1b[31m✗\x1b[0m ${f.name}`);
    console.log(`    ${f.err.message}\n`);
  }
}
console.log(
  failed === 0
    ? `\x1b[32m✓ ${passed} passed\x1b[0m\n`
    : `\x1b[31m✗ ${failed} failed\x1b[0m, ${passed} passed\n`,
);
process.exit(failed === 0 ? 0 : 1);

/* ---------------------------------------------------------------- */

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`exit ${code}: ${stderr || stdout}`)),
    );
  });
}

function mcp(messages) {
  return mcpVia([path.join(ROOT, 'mcp-server/index.mjs')], messages);
}

function mcpVia(nodeArgs, messages) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', nodeArgs, { cwd: ROOT });
    let out = '';
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error('MCP server timed out'));
    }, 15000);

    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(
          out
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l)),
        );
      } catch (e) {
        reject(new Error(`bad MCP output: ${e.message}\n${out.slice(0, 500)}`));
      }
    });

    for (const m of messages) p.stdin.write(`${JSON.stringify(m)}\n`);
    setTimeout(() => p.stdin.end(), 300);
  });
}
