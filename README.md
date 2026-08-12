<div align="center">

# React Native Agents

**Six expert AI agents for React Native — performance, security, code quality, accessibility, testing, and release.**

Written once. Runs in Claude Code, Cursor, Windsurf, GitHub Copilot, Codex, and any MCP client.

[![CI](https://github.com/maheshwarimrinal/react-native-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/maheshwarimrinal/react-native-agents/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![React Native](https://img.shields.io/badge/React%20Native-0.85-61dafb.svg)](https://reactnative.dev)
[![Expo SDK](https://img.shields.io/badge/Expo%20SDK-57-000020.svg)](https://expo.dev)

</div>

---

## Table of contents

- [The problem](#the-problem)
- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [Installation by tool](#installation-by-tool)
- [The agents in detail](#the-agents-in-detail)
- [How to use them](#how-to-use-them)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Building and testing](#building-and-testing)
- [Extending](#extending)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## The problem

AI coding tools are excellent at *writing* React Native code and mediocre at knowing what's
*wrong* with it. Ask any of them to build a feed screen and you will get, cheerfully and
confidently:

```tsx
// A FlatList that re-renders every visible row on every parent render
<FlatList
  data={posts.filter(p => p.visible)}          // new array identity each render
  keyExtractor={(_, i) => String(i)}           // index keys — breaks on delete
  renderItem={({ item }) =>                    // new function identity each render
    <Pressable onPress={() => open(item.id)}>  // new closure per row
      <Image source={{ uri: item.photoUrl }} style={{ width: 72, height: 72 }} />
    </Pressable>                               // full-res image decoded into a 72px box
  }
/>
```

Every line of that is a real, measurable defect, and none of it will be flagged by a linter or a
type checker. The same is true across the board:

- `.env` files that developers believe are secret, and which ship as **plaintext in the JS bundle**
- Auth tokens in `AsyncStorage`, which is unencrypted on both platforms
- Icon-only buttons with no `accessibilityLabel` — a screen reader announces "button" and nothing else
- `useEffect` used to derive state that could just be computed during render
- An OTA update published against a changed native dependency, which **crashes every install with no way for users to update out of it**

These agents are the specialist knowledge that's missing. They are not linters and not
checklists — they're detailed operating instructions that make an AI assistant behave like a
senior React Native engineer who has shipped to millions of users and has the scar tissue to
prove it.

---

## What you get

**6 agents. 38 reference documents. ~40,000 words of React Native expertise.**

| | Agent | Focus | Slash command |
|---|---|---|---|
| ⚡ | **rn-performance** | Janky lists, dropped frames, wasted re-renders, slow startup, memory growth, bundle size | `/rn-perf` |
| 🔒 | **rn-security** | Secret leakage, insecure storage, TLS and pinning, auth, WebView and deep links, supply chain, privacy | `/rn-security` |
| 🧹 | **rn-code-quality** | Architecture, TypeScript, hook correctness, state management, error handling, RN idioms | `/rn-review` |
| 🎨 | **rn-ui-accessibility** | Responsive layout, safe areas, keyboard, dark mode, screen readers, contrast, dynamic type, RTL | `/rn-ui` |
| 🧪 | **rn-testing** | RNTL component tests, mocking, Maestro/Detox E2E, flake elimination, CI | `/rn-test` |
| 🚀 | **rn-release** | EAS/Fastlane, signing, versioning, OTA updates, store submission, rollout, rollback | `/rn-release` |
| 🔎 | *(orchestrator)* | Runs all six, deduplicates, and produces one prioritised report | `/rn-audit` |

Everything is current to **React Native 0.85**, **Expo SDK 57**, **React 19.2**, and the **New
Architecture** (Fabric + TurboModules + Hermes V1, with the legacy bridge removed in 0.82). The
agents actively flag stale pre-0.76 advice — RAM bundles, Flipper, `MessageQueue` spying,
bridge-batching tricks — rather than repeating it.

### Works with

| Tool | Format produced |
|---|---|
| **Claude Code** | Plugin + marketplace, `.claude/agents/`, slash commands |
| **Cursor** | `.cursor/rules/*.mdc` with `description` / `globs` / `alwaysApply` |
| **Windsurf** | `.windsurf/rules/*.md` with correct `trigger` modes, split for the 12k char limit |
| **GitHub Copilot** | `copilot-instructions.md`, path-scoped instructions, chat modes |
| **Codex / Zed / Aider / Jules** | `AGENTS.md` + `.agents/react-native/` |
| **Any MCP client** | stdio MCP server: 5 tools, 7 prompts, 45 resources |

---

## Quick start

```bash
# Auto-detect your tool and install
npx github:maheshwarimrinal/react-native-agents install

# Or be explicit
npx github:maheshwarimrinal/react-native-agents install --tool cursor

# See what's available first
npx github:maheshwarimrinal/react-native-agents list
```

Then ask your assistant a React Native question. It routes to the right specialist automatically:

```
"The feed stutters when I scroll on Android"      → rn-performance
"Is it safe to store the refresh token here?"      → rn-security
"Review this before I ship it"                     → rn-code-quality
```

---

## Installation by tool

Every option below is zero-install — no dependencies, nothing to compile.

<details open>
<summary><b>Claude Code</b></summary>

**As a plugin** (recommended — you get agents, slash commands, and update support):

```
/plugin marketplace add maheshwarimrinal/react-native-agents
/plugin install react-native-agents
```

**Or drop the files in directly:**

```bash
npx github:maheshwarimrinal/react-native-agents install --tool claude-code
```

This writes:

```
.claude/agents/rn-performance.md              ← the playbook, with Claude Code frontmatter
.claude/agents/rn-performance/references/*.md ← 8 deep-dive docs, read on demand
.claude/commands/rn-perf.md                   ← the slash command
… and the same for all six agents
.claude/commands/rn-audit.md                  ← the full-audit orchestrator
```

Restart Claude Code, then either run `/rn-audit` or just describe your problem — Claude picks the
subagent from the `description` field automatically.

The reference files are deliberately *not* inlined into the prompt. Each agent knows its library
exists and `Read`s the relevant document when it reaches that area, which keeps the base context
small while making the full depth available.

</details>

<details>
<summary><b>Cursor</b></summary>

```bash
npx github:maheshwarimrinal/react-native-agents install --tool cursor
```

Writes `.cursor/rules/`:

```
react-native-context.mdc     alwaysApply: true  — ecosystem baseline + severity scale
rn-performance.mdc           agent-requested, scoped to **/*.tsx, **/*.ts, metro.config.js …
rn-performance/*.md          reference docs, @-mentionable
… ×6
```

Rules activate automatically — Cursor matches the `description` field against your request and
the `globs` against the files you're editing. To force one, `@`-mention it: `@rn-security`.

</details>

<details>
<summary><b>Windsurf</b></summary>

```bash
npx github:maheshwarimrinal/react-native-agents install --tool windsurf
```

Writes `.windsurf/rules/` with the correct activation modes:

| File | `trigger` |
|---|---|
| `react-native-context.md` | `always_on` |
| `rn-*.md` (playbooks) | `model_decision` (Cascade decides from the description) |
| `rn-*-*.md` (references) | `manual` — `@`-mention when you want the depth |

Windsurf caps workspace rules at **12,000 characters each**. The build enforces this: it splits
references into separate rules and, if a playbook were ever to exceed the limit, truncates on a
section boundary and emits a build warning rather than silently losing content.

</details>

<details>
<summary><b>GitHub Copilot</b></summary>

```bash
npx github:maheshwarimrinal/react-native-agents install --tool copilot
```

Writes three layers:

```
.github/copilot-instructions.md            always applied — baseline + index of specialists
.github/instructions/*.instructions.md     path-scoped via applyTo globs, full depth inlined
.github/chatmodes/*.chatmode.md            selectable personas in the VS Code chat panel
```

Pick a chat mode from the dropdown in the Copilot chat panel to talk to a specific specialist.

</details>

<details>
<summary><b>Codex / Zed / Aider / anything reading AGENTS.md</b></summary>

```bash
npx github:maheshwarimrinal/react-native-agents install --tool codex
```

```
AGENTS.md                            baseline context + index of specialists
.agents/react-native/rn-*.md         full playbooks with all references inlined
```

`AGENTS.md` is the emerging cross-tool convention, so this covers a widening set of assistants.

</details>

<details>
<summary><b>MCP — any client</b></summary>

Works with Claude Desktop, Cursor, Windsurf, Zed, Continue, or a custom host.

```jsonc
// claude_desktop_config.json, or your client's MCP config
{
  "mcpServers": {
    "react-native-agents": {
      "command": "npx",
      "args": ["-y", "github:maheshwarimrinal/react-native-agents", "mcp"]
    }
  }
}
```

**Tools**

| Tool | Purpose |
|---|---|
| `list_react_native_agents` | Discover the six specialists, their triggers, and their reference libraries |
| `get_react_native_agent` | Load a playbook as the operating instructions for the current task |
| `get_reference` | Fetch one deep-dive document (e.g. the MASVS checklist, the lists playbook) |
| `suggest_agent` | Given a free-text problem description, recommend which specialist(s) to use |
| `get_audit_plan` | Return the ordered plan for a full six-agent audit |

**Prompts** — one per agent, plus `rn-audit`.

**Resources** — every playbook and reference addressable as
`rn-agents://<agent-id>/playbook` and `rn-agents://<agent-id>/reference/<slug>`.

The server implements MCP's JSON-RPC 2.0 over stdio directly, with **no SDK dependency**, so
`npx` works instantly and there's no install step or version drift to manage.

</details>

<details>
<summary><b>Everything at once</b></summary>

```bash
npx github:maheshwarimrinal/react-native-agents install --tool all
```

Useful for a shared team repo where people use different editors.

</details>

<details>
<summary><b>Install only some agents</b></summary>

```bash
npx github:maheshwarimrinal/react-native-agents install --agents rn-security,rn-performance
```

</details>

---

## The agents in detail

Each agent has a **playbook** (the system prompt: who it is, its method, what it checks, what it
pushes back on) and a **reference library** (deep-dive documents loaded on demand, containing
concrete patterns, anti-patterns, real code, and the `rg` commands that find the problem).

### ⚡ rn-performance

> *"You refuse to optimise anything you have not measured."*

Most performance work in RN codebases is cargo-culted — `useMemo` sprinkled on primitives,
`React.memo` on components that were never the problem, `removeClippedSubviews` toggled on faith.
This agent's defining behaviour is demanding evidence first.

It classifies the symptom before touching code, because these have completely different causes:

| Symptom | Thread | Usual root cause |
|---|---|---|
| Slow app launch | Native + JS init | Bundle size, eager module init, sync storage reads |
| Janky scroll | JS or UI | Row re-renders, unstable props, image decode |
| Janky animation | UI (or JS if misconfigured) | Animation driven from the JS thread |
| UI freezes on interaction | JS | Long synchronous task — JSON parse, sort, crypto |
| Memory grows over time | — | Uncleaned listeners/timers, retained navigation state |

**References (8):** `measurement` · `lists` · `rendering` · `startup-and-bundle` ·
`animations-and-gestures` · `images-and-media` · `memory` · `data-and-network`

**Representative depth:** the measurement doc insists on release builds on low-end hardware with
n≥5 and both p50 and p95, and covers React Native DevTools, the Hermes sampling profiler,
Perfetto, Instruments, `react-native-bundle-visualizer`, and Expo Atlas. The lists doc explains
why `removeClippedSubviews` causes blank cells, when `getItemLayout` is safe, and why FlashList
v2's view recycling makes `recyclingKey` mandatory on images.

---

### 🔒 rn-security

> *"Everything shipped in the app binary is public."*

The premise the agent never lets go of, with a demonstration:

```bash
unzip -o app.apk -d out/
strings out/assets/index.android.bundle | grep -i 'key\|secret\|token'
# Hermes bytecode is not encryption — hbctool and hermes-dec decompile it
```

That single fact invalidates `.env`, `react-native-config`, `expo-constants` extras, EAS
"secrets", and every other build-time mechanism developers believe protects them.

It maps findings to **OWASP MASVS** control groups (STORAGE, CRYPTO, AUTH, NETWORK, PLATFORM,
CODE, RESILIENCE, PRIVACY) so reports are auditable, and it pushes back on the standard
rationalisations: *"we obfuscate it"*, *"it's in an env var"*, *"Hermes bytecode can't be read"*,
*"we check for root"*.

It also reminds you of the thing people miss most: **removing a shipped secret from source does
nothing for the builds already in users' hands.** Rotate first.

**References (8):** `secrets-and-storage` · `transport-and-network` · `auth-and-session` ·
`webview-and-deeplinks` · `platform-hardening` · `supply-chain` · `privacy-and-compliance` ·
`masvs-checklist`

**Representative depth:** the auth doc distinguishes real biometric gating (cryptographic key
release via `ACCESS_CONTROL.BIOMETRY_CURRENT_SET`) from the common theatre version (a boolean
from `authenticateAsync` that an attacker patches out). The transport doc explains why
certificate pinning without a backup pin has bricked real apps for days.

---

### 🧹 rn-code-quality

> *"Correctness first, then clarity, then consistency, then elegance — in that order."*

Reviews like a senior engineer rather than a linter. It separates **Bug** / **Risk** /
**Maintainability** / **Nit** and explicitly warns that reviews which are 80% nits get skimmed
and the real bugs get missed.

The RN-specific things a generic React reviewer misses:

- `useEffect` used to derive state — the single most common React bug
- `Dimensions.get('window')` captured at module scope, wrong after rotation/foldables/split-screen
- Inline style objects, which break memoisation *and* scatter design tokens
- Platform divergence assumed away — shadows, keyboard, back navigation, safe areas
- Untyped navigation params; unvalidated network responses

**References (7):** `architecture` · `typescript` · `react-patterns` · `state-management` ·
`error-handling` · `rn-idioms` · `tooling`

---

### 🎨 rn-ui-accessibility

> *"Roughly one in six people has a disability, and the same work that helps them makes the app better for everyone."*

Two jobs: the UI works on every device it will actually meet (small phones, tablets, foldables,
landscape, split-screen, 200% text, notches, Android 15 edge-to-edge, keyboard covering half the
screen), and it's usable without sight, without precise touch, and without hearing.

It **computes** contrast ratios rather than eyeballing them, measures touch targets including
`hitSlop`, and reads the component tree to describe what a screen reader user would actually hear.

The ten findings it makes most often — icon buttons with no label, targets under 44pt, hardcoded
colours breaking dark mode, `allowFontScaling={false}`, modals that don't trap focus — recur in
almost every codebase.

**References (6):** `accessibility-checklist` · `layout-and-responsive` · `theming-and-dark-mode` ·
`motion-and-feedback` · `i18n-and-rtl` · `platform-conventions`

---

### 🧪 rn-testing

> *"If this test passes, what do I now know is true for the user?"*

Tests behaviour, not implementation. Queries by accessibility role and label before `testID` — so
a component test doubles as an accessibility test.

Zero tolerance for flakiness: *"a test that fails 1 in 20 runs trains the team to re-run CI
without looking. Fix it or delete it."*

Pushes back on snapshot tests as a default, over-mocking, `waitFor` wrapping synchronous
assertions, arbitrary `setTimeout` waits, and 100% coverage mandates.

**References (4):** `component-testing` · `mocking` · `e2e` · `strategy-and-ci`

**Representative depth:** `transformIgnorePatterns` (the top cause of "Jest failed to parse a
file"), stateful native-module mocks backed by a `Map` so you can test write-then-read cycles,
and a Maestro-vs-Detox comparison with a concrete recommendation.

---

### 🚀 rn-release

> *"How do we undo this in five minutes?"*

Mobile is unforgiving: you cannot recall a binary, and review takes hours or days. That asymmetry
drives everything the agent does.

The failure it treats most seriously — because the user **cannot update their way out of it** —
is an OTA update published against a changed native dependency. Runtime version fingerprinting
exists to prevent exactly this, and the agent checks for it every time.

It also insists on: staged rollout with written crash-free thresholds agreed *before* you ship,
automatic source-map upload, Play App Signing (losing a self-managed key means never updating the
app again), and a rollback path that has actually been practised.

**References (5):** `build-and-signing` · `versioning` · `ota-updates` · `store-submission` ·
`monitoring-and-rollback`

---

## How to use them

### Just describe the problem

Most of the time you don't invoke an agent by name. Each has a carefully written `description`
that the tool routes on:

```
"The feed stutters when I scroll on Android"           → rn-performance
"Review this before I ship it"                          → rn-code-quality
"Is it safe to store the refresh token here?"           → rn-security
"Why does the layout break at large text sizes?"        → rn-ui-accessibility
"Write tests for the checkout flow"                     → rn-testing
"Our OTA update crashed everyone"                       → rn-release
```

### Run a full audit

```
/rn-audit                    # Claude Code
/rn-audit src/features/      # scoped
```

The orchestrator:

1. **Detects your setup first** — RN version, Expo SDK, managed vs bare, TypeScript, router,
   state library — and states its findings, because every downstream recommendation depends on
   them.
2. **Dispatches all six specialists**, in parallel where possible.
3. **Consolidates** into a health summary, a severity table, all P0/P1 findings deduplicated
   across agents, P2/P3 grouped by theme, and a **top 5 actions** list ranked by impact per unit
   of effort.

### The shared severity scale

Every agent uses the same scale, so a consolidated report is coherent:

| Level | Meaning | Response |
|---|---|---|
| **P0 — Critical** | Exploitable vulnerability, data loss, crash on launch, store rejection | Fix before merge |
| **P1 — High** | Meaningful user-visible degradation, likely bug, real security weakness | Fix this sprint |
| **P2 — Medium** | Measurable inefficiency, maintainability risk, partial a11y failure | Schedule it |
| **P3 — Low** | Polish, consistency, nice-to-have | Batch it |

The playbooks explicitly instruct against inflating severity: *"A `console.log` is not a P0.
Reserve P0 for things that genuinely must block a release, or the scale becomes noise and gets
ignored."*

### The finding format

Every finding carries `file:line`, an explanation of why it matters *in this codebase*, a
concrete diff, and how to verify the fix:

````
### [P1] Unstable `renderItem` recreates every row on each parent render
`src/screens/Feed.tsx:88`

**What's happening**
`renderItem` is an inline arrow, so `FlatList` sees a new function identity on every parent
render and re-renders all mounted rows even when data is unchanged.

**Why it matters**
On the feed screen this fires on every scroll-position state update — roughly 40 wasted row
renders per second on a mid-range Android device.

**Fix**
```diff
- renderItem={({ item }) => <PostCard post={item} onLike={() => like(item.id)} />}
+ renderItem={renderPost}
```

**Verify**
React DevTools Profiler → record a scroll → `PostCard` commit count should drop to only
newly-windowed rows.
````

---

## How it works

### Single source, many targets

```
                            agents/<id>/agent.md
                            agents/<id>/references/*.md
                            shared/rn-context.md
                                     │
                                     ▼
                            scripts/build.mjs
                                     │
        ┌──────────┬─────────┬───────┴────┬──────────┬──────────┐
        ▼          ▼         ▼            ▼          ▼          ▼
   claude-code  cursor   windsurf     copilot   agents-md   index.json
   plugin +     .mdc     trigger-     3-layer   AGENTS.md   consumed by
   subagents +  rules    scoped       instr. +  + .agents/  the MCP server
   commands              rules,       chatmodes             and the CLI
                         12k-split
```

You edit **one** markdown file. Every format regenerates. There is no per-tool copy to keep in
sync, which is the thing that kills multi-tool prompt collections.

### Design decisions worth knowing

**Zero dependencies.** No npm install, ever. The frontmatter parser is a ~60-line hand-rolled
YAML subset (scalars, block lists, flow lists — the entire surface agent frontmatter uses), and
the MCP server implements JSON-RPC over stdio directly instead of pulling in the SDK. This is why
`npx github:...` works instantly with nothing to resolve.

**`dist/` is committed.** Deliberately, so `npx` needs no build step. CI enforces that it matches
`agents/` via `node scripts/build.mjs --check`, which builds into a temp directory and diffs —
so a PR that edits a playbook without rebuilding fails loudly.

**References are loaded on demand, not inlined.** For Claude Code and Cursor, the playbook lists
its reference library and the agent `Read`s the relevant file when it reaches that area. Base
context stays small; full depth stays available. For single-file targets (Copilot instructions,
`AGENTS.md`) everything is inlined, since there's no filesystem access to defer to.

**Build-then-prune, not delete-then-build.** `scripts/build.mjs` writes all output first, then
removes anything no longer generated. A mid-build failure leaves the previous `dist/` intact, and
it works on filesystems that refuse recursive removal (network mounts, container binds).

**Per-tool constraints are enforced, not hoped for.** The Windsurf emitter knows about the
12,000-character rule limit and warns on overflow. The Cursor emitter emits `description` /
`globs` / `alwaysApply` in the exact `.mdc` shape. The Claude Code emitter produces a valid
plugin manifest and marketplace entry. The test suite verifies all of it.

---

## Repository layout

```
react-native-agents/
├── agents/                          ← SINGLE SOURCE OF TRUTH. Edit here.
│   ├── performance/
│   │   ├── agent.md                 ← playbook + YAML frontmatter
│   │   └── references/
│   │       ├── measurement.md
│   │       ├── lists.md
│   │       ├── rendering.md
│   │       └── … (8 total)
│   ├── security/          (8 references)
│   ├── code-quality/      (7 references)
│   ├── ui-accessibility/  (6 references)
│   ├── testing/           (4 references)
│   └── release/           (5 references)
│
├── shared/
│   └── rn-context.md                ← ecosystem baseline, project-detection protocol,
│                                       universal rules, severity scale, output contract.
│                                       Injected into every agent, every target.
│
├── scripts/
│   ├── build.mjs                    ← generator + `--check` CI gate
│   ├── cli.mjs                      ← `npx` installer with tool auto-detection
│   ├── test.mjs                     ← 149 assertions, no test framework
│   └── lib/
│       ├── source.mjs               ← frontmatter parser, loader, prune
│       └── targets.mjs              ← one emitter per tool
│
├── mcp-server/
│   └── index.mjs                    ← zero-dependency MCP server over stdio
│
├── dist/                            ← GENERATED. Committed so npx works. Don't edit.
│   ├── claude-code/
│   ├── cursor/
│   ├── windsurf/
│   ├── copilot/
│   ├── agents-md/
│   └── index.json
│
├── .github/workflows/ci.yml         ← tests on Node 18/20/22, sync gate, MCP smoke,
│                                       per-tool install, markdown fence check
├── CONTRIBUTING.md
├── LICENSE                          ← MIT
└── package.json                     ← "dependencies": {}
```

---

## Building and testing

```bash
git clone https://github.com/maheshwarimrinal/react-native-agents
cd react-native-agents

npm run build      # regenerate all five tool formats into dist/
npm test           # 149 assertions
npm run check      # CI gate: fails if dist/ is out of sync with agents/
npm run mcp        # run the MCP server on stdio (for manual testing)
```

No `npm install` step — there are no dependencies.

### What the test suite covers

| Area | Checks |
|---|---|
| **Frontmatter parser** | Scalars, booleans, numbers, quoted strings, block lists, flow lists, round-tripping, no-frontmatter passthrough |
| **Agent sources** | Required fields, id naming convention, description length (≥60 chars — tools route on it), body substance, reference count, declared-vs-on-disk reference match, no authoring placeholders, no stray non-ASCII |
| **Uniqueness** | Agent ids, slash commands |
| **Claude Code output** | Frontmatter validity, `tools` string format, plugin manifest, marketplace `source` is a relative path |
| **Cursor output** | `.mdc` frontmatter has `description`, non-empty `globs`, boolean `alwaysApply` |
| **Windsurf output** | Every rule ≤ 12,000 bytes; `trigger` is one of the four valid modes |
| **All targets** | Every agent emitted for every one of the five formats |
| **MCP protocol** | Real stdio round trip: `initialize`, `tools/list`, four `tools/call` variants, `prompts/list`, `resources/list`, `resources/read`, error handling for unknown references, `-32601` for unknown methods, notifications produce no response |
| **CLI** | `list` runs and names every agent |
| **Sync gate** | `--check` passes against a fresh build |

149 assertions, no framework, runs in about two seconds.

**What is *not* automatically verified:** the technical accuracy of the guidance itself. That
comes from review and from field reports. If something here is wrong or out of date, please open
an issue.

---

## Extending

### Adding a reference document

Drop a `.md` file into `agents/<id>/references/`, add its slug to the `references` list in that
agent's frontmatter, and rebuild. The build cross-checks declared references against what's on
disk and fails on a mismatch.

### Adding an agent

Create `agents/<id>/agent.md` plus at least three reference files. The build discovers it
automatically — there is no registry to update.

```yaml
---
id: rn-something          # kebab-case, rn- prefix, unique
name: React Native Something Agent
title: RN Something       # short label for menus and reports
description: >-           # ≥60 chars. THIS IS WHAT TOOLS ROUTE ON — be specific about
  Use for …               # when to use it and what triggers it.
version: 1.0.0
model: opus               # Claude Code model hint
color: teal
emoji: "🔧"
tools: [Read, Grep, Glob, Bash, Edit]
globs: ["**/*.tsx"]       # drives Cursor/Windsurf/Copilot file scoping
alwaysApply: false        # true only for genuinely universal rules — costs context every request
command: rn-something     # slash command name, must be unique
triggers: [keyword, phrase]        # powers the MCP suggest_agent tool
references: [topic-one, topic-two, topic-three]
---
```

The body should cover: who the agent is, its method, what it checks (with a table pointing at
references), its anti-pattern list, what it pushes back on, and its output format.

### Adding a tool target

Write an emitter in `scripts/lib/targets.mjs` with the signature
`({ agents, shared, distDir }) => ({ name, files, warnings })`, register it in the `TARGETS` map,
and add it to `TOOLS` in `scripts/cli.mjs`. Add a case to `scripts/test.mjs`.

---

## FAQ

**Do I need an API key or a subscription?**
No. These are prompt/instruction files plus a local MCP server. They run inside whatever AI tool
you already use.

**Will this slow my assistant down or eat my context window?**
The playbooks are deliberately compact (~1,000–1,500 words each) and the reference libraries load
on demand. Only `react-native-context.mdc` and `rn-code-quality` are always-on; everything else
activates when relevant.

**My project is on React Native 0.72 / the old architecture. Is this useless?**
No. The agents check your `package.json` first and are instructed to say so explicitly when a
project is pre-0.76, treating New Architecture migration as a first-class recommendation with its
own cost/benefit rather than an assumption.

**Expo or bare React Native?**
Both. The shared context makes workflow detection a required first step, precisely because the
correct advice differs — telling a managed-workflow user to hand-edit `ios/` is actively harmful,
since prebuild will discard it.

**Can I use just one agent?**
```bash
npx github:maheshwarimrinal/react-native-agents install --agents rn-security
```

**Can I customise them for my team?**
Yes — fork it, edit `agents/`, run `npm run build`, and point your team at your fork. That's the
intended workflow for house conventions, internal libraries, and company-specific policies.

**Why commit `dist/`?**
So `npx github:maheshwarimrinal/...` works with no build step. CI guarantees it stays in sync.

**Is this on npm?**
No — distribution is GitHub-only. `npx github:maheshwarimrinal/react-native-agents` works for every command,
the Claude Code plugin marketplace reads the repo directly, and the other four tool integrations
are plain file copies. The package is npm-ready if that changes (correct `bin` entries, a `files`
allowlist, zero dependencies), so publishing later is a single `npm publish` with no structural
change.

**Why no npm dependencies?**
Faster installs, no supply-chain surface, and nothing to break when a transitive dependency
changes. The two things that would normally need libraries — YAML parsing and the MCP protocol —
are small enough to implement directly and are covered by tests.

**Does this replace ESLint / TypeScript / a security scanner?**
No. It's complementary. Linters catch mechanical issues; these agents catch design and judgement
issues — and they tell you *why* something matters and *how to verify the fix*.

---

## Contributing

The most valuable contributions are **specific and battle-tested**: a failure mode you actually
hit, with the symptom, the cause, and the fix.

1. Edit `agents/<id>/agent.md` or a file in its `references/`
2. Run `npm run build && npm test`
3. Commit both the source edit and the regenerated `dist/`

House style: concrete over abstract, code over prose, honest about trade-offs, no advice that
can't be verified. Full guidance in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, ship it.

---

## Sources

- [React Native New Architecture in 2026: Fabric and JSI](https://blog.codercops.com/blog/react-native-new-architecture-fabric-jsi-2026)
- [Expo SDK 56 changelog](https://expo.dev/changelog/sdk-56)
- [React Native ecosystem advances with Expo SDK 56 and React 19.2](https://dev.to/davekurian/react-native-ecosystem-advances-with-expo-sdk-56-and-react-192-updates-in-2026-3df5)
- [Cursor `.cursor/rules` frontmatter schema](https://qaskills.sh/blog/cursor-skill-md-frontmatter-schema-guide)
- [Windsurf rules and activation modes](https://docs.windsurf.com/windsurf/cascade/memories)
