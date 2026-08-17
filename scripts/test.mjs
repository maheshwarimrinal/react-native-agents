#!/usr/bin/env node
/**
 * Validation suite. Zero dependencies — uses node:test.
 *
 *   node scripts/test.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { loadAgents, loadSharedContext, parseFrontmatter, serializeFrontmatter, KNOWLEDGE, VERSION, knowledgeAgeDays } =
  await import(path.join(ROOT, 'scripts/lib/source.mjs'));
const { plan, apply, isUserOwned, summarise } = await import(path.join(ROOT, 'scripts/lib/install.mjs'));
const { scoreAgents, explainRouting } = await import(path.join(ROOT, 'mcp-server/routing.mjs'));
const { loadCases, scoreOutput } = await import(path.join(ROOT, 'evals/run.mjs'));
const os = await import('node:os');

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

function eq(a, b, msg) {
  if (a !== b) {
    throw new Error(`${msg ?? 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
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

test('the published tarball contains no filesystem residue', () => {
  // npm ships everything under an allowlisted directory and does NOT consult
  // .gitignore for it. Editor swap files, FUSE residue, and stray tarballs will
  // ship to every consumer unless the allowlist excludes them explicitly.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const neg of ['!**/.fuse_hidden*', '!**/*.tgz', '!**/.DS_Store']) {
    assert(pkg.files?.includes(neg), `"files" should exclude ${neg}`);
  }

  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const junk = entry.files
    .map((f) => f.path)
    .filter((p) => /\.fuse_hidden|\.DS_Store|\.tgz$|~$|\.orig$|\.rej$|\.swp$/.test(p));
  assert(junk.length === 0, `tarball contains residue: ${junk.slice(0, 5).join(', ')}`);
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
 * Installer safety — regression guards for the data-loss bug
 * ---------------------------------------------------------------- */

function scratchProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-install-'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# MY OWN INSTRUCTIONS\n');
  fs.writeFileSync(path.join(dir, '.github/copilot-instructions.md'), '# my rules\n');
  return dir;
}

test('installer: plan classifies create / conflict / identical', () => {
  const dir = scratchProject();
  const src = path.join(DIST, 'agents-md');
  const entries = plan(src, dir);
  const s = summarise(entries);
  assert(s.conflict.length >= 1, 'should detect the pre-existing AGENTS.md as a conflict');
  assert(s.create > 0, 'should also have new files to create');
});

test('installer: default mode never overwrites an existing file', () => {
  const dir = scratchProject();
  const before = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'skip' });
  eq(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), before, 'AGENTS.md must be untouched');
});

test('installer: dry run writes nothing at all', () => {
  const dir = scratchProject();
  const countBefore = fs.readdirSync(dir).length;
  apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'overwrite', dryRun: true });
  eq(fs.readdirSync(dir).length, countBefore, 'dry run must not create files');
  assert(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').startsWith('# MY OWN'), 'unchanged');
});

test('installer: --force still backs up user-authored files', () => {
  const dir = scratchProject();
  const original = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const r = apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'overwrite' });
  assert(r.backedUp.length > 0, 'should have taken a backup');
  assert(fs.existsSync(path.join(dir, 'AGENTS.md.bak')), 'AGENTS.md.bak must exist');
  eq(fs.readFileSync(path.join(dir, 'AGENTS.md.bak'), 'utf8'), original, 'backup must hold the original');
});

test('installer: re-running on a clean install is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-idem-'));
  apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'skip' });
  const second = apply(plan(path.join(DIST, 'agents-md'), dir), { onConflict: 'skip' });
  eq(second.created, 0, 'nothing new on the second run');
  eq(second.skipped, 0, 'identical files are not conflicts');
  assert(second.identical > 0, 'should recognise files as identical');
});

test('installer: user-owned file list covers the known-dangerous paths', () => {
  for (const f of ['AGENTS.md', '.github/copilot-instructions.md', 'CLAUDE.md']) {
    assert(isUserOwned(f), `${f} should be treated as user-authored`);
  }
  assert(!isUserOwned('.claude/agents/rn-security.md'), 'generated files are ours to replace');
});

/* ---------------------------------------------------------------- *
 * Version single-source-of-truth
 * ---------------------------------------------------------------- */

test('every generated manifest uses the package.json version', () => {
  const marketplace = JSON.parse(
    fs.readFileSync(path.join(DIST, 'claude-code/.claude-plugin/marketplace.json'), 'utf8'),
  );
  const plugin = JSON.parse(
    fs.readFileSync(path.join(DIST, 'claude-code/plugins/react-native-agents/.claude-plugin/plugin.json'), 'utf8'),
  );
  const index = JSON.parse(fs.readFileSync(path.join(DIST, 'index.json'), 'utf8'));

  eq(marketplace.metadata.version, VERSION, 'marketplace metadata');
  eq(marketplace.plugins[0].version, VERSION, 'marketplace plugin entry');
  eq(plugin.version, VERSION, 'plugin.json');
  eq(index.version, VERSION, 'index.json');
});

test('no hardcoded version literals remain in the generators', () => {
  for (const rel of ['scripts/lib/targets.mjs', 'mcp-server/index.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const hits = src.match(/version:\s*['"]\d+\.\d+\.\d+['"]/g);
    assert(!hits, `${rel} hardcodes a version: ${hits?.join(', ')}`);
  }
});

/* ---------------------------------------------------------------- *
 * Knowledge freshness
 * ---------------------------------------------------------------- */

test('knowledge.json declares verification metadata', () => {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(KNOWLEDGE.last_verified), 'last_verified must be a date');
  assert(KNOWLEDGE.reactNative?.verified_through, 'reactNative.verified_through required');
  assert(KNOWLEDGE.expo?.verified_through, 'expo.verified_through required');
  assert(KNOWLEDGE.reactNative?.min_supported, 'reactNative.min_supported required');
});

test('shared context states the same RN version as knowledge.json', () => {
  const rn = KNOWLEDGE.reactNative.verified_through;
  assert(shared.includes(rn), `shared/rn-context.md should mention RN ${rn}`);
});

test('shared context tells agents to trust package.json over the baseline table', () => {
  assert(
    /package\.json/i.test(shared) && /authoritative|verify|re-verify/i.test(shared),
    'context must defer to the project as ground truth',
  );
});

test('knowledge age is reported and not absurd', () => {
  const age = knowledgeAgeDays();
  assert(age >= 0, `negative age: ${age} — last_verified is in the future`);
});

/* ---------------------------------------------------------------- *
 * No invented benchmarks in the output contract
 * ---------------------------------------------------------------- */

test('the output-contract example does not model a fabricated measurement', () => {
  // The example is imitated more strongly than the rule, so it must comply.
  const contract = shared.slice(shared.indexOf('## Output contract'));
  const invented = contract.match(/\b(roughly|approximately|about|~)\s*\d+\s+(wasted|extra)\s+\w*\s*renders?/i);
  assert(!invented, `example fabricates a measurement: "${invented?.[0]}"`);
});

test('the measurement rule distinguishes standards from fabrication', () => {
  assert(/never invent a measurement/i.test(shared), 'rule must be explicit');
  assert(/wcag|4\.5:1|44/i.test(shared), 'rule must permit citing published standards');
});

/* ---------------------------------------------------------------- *
 * MCP intent routing
 * ---------------------------------------------------------------- */

const routeCases = [
  ['My large product catalogue is stuttering', 'rn-performance'],
  ['the app freezes when I open the inbox', 'rn-performance'],
  ['is it safe to keep the JWT where I am keeping it', 'rn-security'],
  ['the store rejected my build again', 'rn-release'],
  ['screen reader users cannot use the cart', 'rn-ui-accessibility'],
  ['my tests keep failing randomly', 'rn-testing'],
  ['can you refactor this messy component', 'rn-code-quality'],
];

for (const [task, expected] of routeCases) {
  test(`routing: "${task.slice(0, 40)}" → ${expected}`, () => {
    const ranked = scoreAgents(task, agents);
    eq(ranked[0]?.id, expected, `ranked: ${ranked.slice(0, 2).map((r) => `${r.id}(${r.score})`).join(', ')}`);
  });
}

test('routing: semantic phrasing with no jargon still routes', () => {
  // The team's example — contains no RN vocabulary at all.
  const ranked = scoreAgents('My large product catalogue is stuttering', agents);
  eq(ranked[0].id, 'rn-performance');
  eq(ranked[0].confidence, 'high', `confidence was ${ranked[0].confidence}`);
});

test('routing: crash-reporting language beats release, not ties with it', () => {
  // rn-release carried 'sentry'/'crash'/'monitoring' in its medium list, which
  // tied with rn-observability on "Sentry shows no production crashes".
  for (const task of [
    'Sentry shows no production crashes',
    'crashes are not showing up in the dashboard',
    'our stack traces are unreadable',
  ]) {
    const ranked = scoreAgents(task, agents);
    eq(ranked[0]?.id, 'rn-observability', `"${task}" ranked: ${ranked.slice(0, 2).map((r) => `${r.id}(${r.score})`).join(', ')}`);
    assert(
      ranked.length < 2 || ranked[0].score > ranked[1].score,
      `tie on "${task}": ${ranked.slice(0, 2).map((r) => `${r.id}(${r.score})`).join(' vs ')}`,
    );
  }
});

test('routing: release still wins its own vocabulary', () => {
  for (const [task, expected] of [
    ['the store rejected my build', 'rn-release'],
    ['plan the OTA rollback', 'rn-release'],
    ['code signing certificate expired', 'rn-release'],
  ]) {
    eq(scoreAgents(task, agents)[0]?.id, expected, task);
  }
});

test('routing: unrelated text matches nothing rather than guessing', () => {
  eq(scoreAgents('how do I make a burrito', agents).length, 0);
});

test('routing: admits low confidence instead of asserting a winner', () => {
  const { text } = explainRouting('something is a bit odd', agents);
  assert(/no specialist clearly matches|guess/i.test(text), text.slice(0, 200));
});

/* ---------------------------------------------------------------- *
 * Eval suite integrity
 * ---------------------------------------------------------------- */

const evalCases = loadCases(path.join(ROOT, 'evals'));

test('every agent has at least one eval case', () => {
  const covered = new Set(evalCases.map((c) => c.def.agent));
  for (const a of agents) assert(covered.has(a.id), `no eval case for ${a.id}`);
});

test('eval cases reference real agents and have assertions', () => {
  const ids = new Set(agents.map((a) => a.id));
  for (const c of evalCases) {
    assert(ids.has(c.def.agent), `${c.id}: unknown agent ${c.def.agent}`);
    // A clean case has no `expect` entries by design — its entire assertion is
    // that the agent reported (almost) nothing.
    const asserts = c.def.expect?.length > 0 || c.def.expectMaxFindings !== undefined;
    assert(asserts, `${c.id}: no expectations`);
    assert(c.input.trim().length > 50, `${c.id}: fixture too small to be meaningful`);
  }
});

test('every agent has a clean case or more than one case', () => {
  // One case per agent is where silent quality regressions hide. This asserts
  // what its name says: either the agent is measured for noise (a clean case),
  // or it has at least two failure cases covering different modes.
  const byAgent = {};
  for (const c of evalCases) (byAgent[c.def.agent] ??= []).push(c);

  const thin = [];
  for (const a of agents) {
    const cases = byAgent[a.id] ?? [];
    assert(cases.length >= 1, `${a.id} has no eval case`);
    const hasClean = cases.some((c) => c.def.expectMaxFindings !== undefined);
    if (!hasClean && cases.length < 2) thin.push(a.id);
  }
  assert(
    thin.length === 0,
    `these agents need a clean case or a second case: ${thin.join(', ')}`,
  );
});

test('enough clean cases exist to measure noise across the collection', () => {
  const clean = evalCases.filter((c) => c.def.expectMaxFindings !== undefined);
  assert(
    clean.length >= 6,
    `only ${clean.length} clean (noise) case(s) — these are what catch false positives`,
  );
});

test('clean cases forbid the findings they are designed to catch', () => {
  for (const c of evalCases.filter((x) => x.def.expectMaxFindings !== undefined)) {
    assert(
      (c.def.forbid ?? []).length >= 3,
      `${c.id}: a clean case needs forbid rules naming the likely false positives`,
    );
    assert(c.def.expectMaxFindings <= 2, `${c.id}: a clean case with a loose cap tests nothing`);
  }
});

test('eval forbid patterns are valid regexes', () => {
  for (const c of evalCases) {
    for (const f of c.def.forbid ?? []) {
      if (f.pattern) new RegExp(f.pattern, 'i'); // throws if invalid
    }
  }
});

test('eval scoring catches premature FlashList advice', () => {
  const def = evalCases.find((c) => c.id === 'performance/unstable-render-item').def;
  const bad = scoreOutput('Just switch to FlashList, it is 3x faster.', def);
  assert(bad.violations.length >= 1, 'should flag premature FlashList');
  assert(!bad.pass, 'must not pass');
});

test('eval scoring accepts a measured answer mentioning FlashList', () => {
  const def = evalCases.find((c) => c.id === 'performance/unstable-render-item').def;
  const good = scoreOutput(
    'renderItem is an inline arrow so rows re-render. Profile with React DevTools first; consider FlashList after you measure.',
    def,
  );
  eq(good.violations.length, 0, `unexpected violations: ${good.violations.map((v) => v.name).join(', ')}`);
});

test('eval fixtures contain no scanner-triggering credential literals', () => {
  // A realistic-looking key in a public repo trips GitHub secret scanning and
  // gitleaks — and is a bad look in the repo whose own security agent forbids it.
  const patterns = [
    /sk_live_[A-Za-z0-9]{12,}/,
    /sk_test_[A-Za-z0-9]{12,}/,
    /AKIA[0-9A-Z]{16}/,
    /ghp_[A-Za-z0-9]{20,}/,
    /AIza[0-9A-Za-z_-]{30,}/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
  ];
  for (const c of evalCases) {
    for (const p of patterns) {
      const m = c.input.match(p);
      assert(!m, `${c.id} contains a scanner-triggering literal: ${m?.[0]?.slice(0, 12)}…`);
    }
  }
});

test('the security fixture still expresses a genuine P0, not a defanged placeholder', () => {
  // Redacting the literal must not quietly turn the case into one that a
  // *correct* agent fails — a transparent placeholder is not a P0, so demanding
  // P0 + "rotate" would reward over-reacting instead of good judgement.
  const c = evalCases.find((x) => x.id === 'security/jwt-in-asyncstorage');
  assert(c, 'security eval case missing');

  const defanged = /=\s*['"](EXAMPLE|PLACEHOLDER|CHANGEME|TODO|XXX)[_A-Z]*['"]/.test(c.input);
  assert(
    !defanged,
    'fixture uses a transparent placeholder — a correct agent would rate it low, ' +
      'so expectSeverity P0 would fail good behaviour. Express the P0 by mechanism instead.',
  );

  if (c.def.expectSeverity?.includes('P0')) {
    assert(
      /EXPO_PUBLIC_\w*(SECRET|KEY|TOKEN)|api\.stripe\.com|authorization/i.test(c.input),
      'case demands P0 but the fixture has no mechanism that justifies one',
    );
  }
});

test('eval scoring catches the AsyncStorage-is-encrypted claim', () => {
  const def = evalCases.find((c) => c.id === 'security/jwt-in-asyncstorage').def;
  const bad = scoreOutput('AsyncStorage is encrypted so the token is safe there.', def);
  assert(bad.violations.some((v) => /encrypted/i.test(v.name)), 'should flag the false claim');
});

/* ---------------------------------------------------------------- *
 * Repository hygiene
 * ---------------------------------------------------------------- */

test('gitignore covers FUSE artifacts and packed tarballs', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert(gi.includes('.fuse_hidden'), 'FUSE artifacts must be ignored');
  assert(gi.includes('*.tgz'), 'packed tarballs must be ignored');
});

test('third-party actions are pinned to a commit SHA, not a mutable tag', () => {
  // The repo's own security agent tells users to do this (supply-chain.md);
  // failing to follow our own advice is both a risk and a credibility problem.
  const dir = path.join(ROOT, '.github/workflows');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const [, ref] of src.matchAll(/uses:\s*([^\s#]+)/g)) {
      if (ref.startsWith('./')) continue; // local action — no pinning needed
      const [, version] = ref.split('@');
      assert(
        /^[0-9a-f]{40}$/.test(version ?? ''),
        `${f}: "${ref}" is not pinned to a full commit SHA`,
      );
    }
  }
});

test('the demo workflow exercises the working tree, not a published release', () => {
  // It triggers on action/** changes, so pinning it to a published tag would
  // let a PR that breaks the action pass its own demo.
  const src = fs.readFileSync(path.join(ROOT, '.github/workflows/demo-audit.yml'), 'utf8');
  if (/paths:[\s\S]*?action\//.test(src)) {
    assert(
      /uses:\s*\.\/\s*$/m.test(src),
      'demo-audit.yml triggers on action/** but does not run `uses: ./`',
    );
  }
});

test('CI triggers on both main and master', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const m = ci.match(/branches:\s*\[([^\]]+)\]/);
  assert(m, 'no branches filter found');
  assert(/main/.test(m[1]) && /master/.test(m[1]), `branches: [${m[1]}] — must cover both`);
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
