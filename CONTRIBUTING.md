# Contributing

Thanks for wanting to make these agents better. The bar here is specific, battle-tested
knowledge — the kind you only get from shipping.

## The one rule

**Edit `agents/`, never `dist/`.** Everything under `dist/` is generated. CI will fail a PR where
the two disagree.

```bash
# after any edit
npm run build     # regenerate all five tool formats
npm test          # 149 checks
```

Commit both your source change and the regenerated `dist/`.

## What's most valuable

In rough order:

1. **A failure mode you actually hit**, with the symptom, the root cause, and the fix. "Our OTA
   crashed every install because the runtime version didn't change" is worth more than a page of
   general advice.
2. **Corrections.** Something here is out of date or wrong — RN moves fast and this will happen.
   Open an issue or a PR with the correction and a source.
3. **A missing check** in an existing playbook, ideally with the `rg` command that finds it.
4. **A new reference document** for an area an existing agent covers thinly.
5. **A new agent** for a genuinely distinct domain.

## House style

The agents read the way a good senior engineer talks. Specifically:

- **Concrete over abstract.** Show the code. A `✗` / `✓` pair beats three paragraphs.
- **Say why it matters**, not just what to do. "Index keys break on reorder — this is why your
  list flickers when you delete an item."
- **Be honest about trade-offs.** `removeClippedSubviews` causes blank cells. Certificate pinning
  can brick your app. Say so.
- **Prefer the platform primitive** over a new dependency, and name the cost when a dependency is
  genuinely warranted.
- **No advice that can't be verified.** Every performance claim needs a way to measure it; every
  security finding needs an exploit path.
- **Include the audit command.** Most reference documents end with the `rg` / `find` invocations
  that locate the problem. These make the agent actionable rather than theoretical.
- **No filler.** No "it's important to note that". Cut the sentence if removing it loses nothing.

Avoid: unqualified superlatives, advice copied from blog posts without verification, and
recommendations that only apply to web React.

## Adding an agent

Create `agents/<id>/agent.md` plus at least three files in `agents/<id>/references/`. The build
discovers it automatically — there's no registry to update.

```yaml
---
id: rn-something          # kebab-case, rn- prefix, unique
name: React Native Something Agent
title: RN Something       # short label used in menus and reports
description: >-           # ≥60 chars. This is what every tool routes on — be specific about
  Use for …               # when to use it and what triggers it.
version: 1.0.0
model: opus
color: teal
emoji: "🔧"
tools: [Read, Grep, Glob, Bash, Edit]
globs: ["**/*.tsx"]       # which files this applies to
alwaysApply: false        # true only for genuinely universal rules
command: rn-something     # slash command name (must be unique)
triggers: [keyword, phrase]
references: [topic-one, topic-two, topic-three]   # must match files on disk
---
```

The body should cover: who the agent is, its method, what it checks (with a table pointing at
references), its anti-pattern list, what it pushes back on, and its output format.

## Frontmatter fields

| Field | Required | Notes |
|---|---|---|
| `id`, `name`, `description`, `version` | Yes | Build fails without them |
| `title` | No | Falls back to `name` |
| `model`, `color`, `emoji` | No | Claude Code metadata |
| `tools` | Recommended | Passed to Claude Code as the tool allow-list |
| `globs` | Recommended | Drives Cursor/Windsurf/Copilot file scoping |
| `alwaysApply` | No | Default `false`. Use sparingly — always-on rules cost context in every request. |
| `command` | No | Generates a slash command |
| `triggers` | No | Powers the MCP `suggest_agent` tool |
| `references` | No | Cross-checked against `references/` on disk; a mismatch fails the build |

## Constraints to know about

- **Windsurf caps rules at 12,000 characters.** The emitter truncates on a section boundary and
  warns. If your playbook is near the limit, split content into references instead of growing the
  body.
- **Cursor rules** are agent-requested by default; the `description` is what Cursor matches on, so
  it carries real weight.
- **`dist/` is committed** so `npx` works with no build step. This is deliberate.

## Testing

```bash
npm test                      # everything
node scripts/build.mjs --check   # just the sync gate
```

The suite validates the frontmatter parser, agent structure and completeness, every emitted
format (including Cursor `.mdc` validity, Windsurf's size limit, and Claude Code plugin
manifests), a real MCP stdio round trip, and the CLI. It has no dependencies and runs in about
two seconds.

If you add a capability, add a check for it.

## Reporting a problem

Open an issue with: the RN and Expo versions, what the agent said, and what it should have said.
Field reports about wrong or stale guidance are the most useful thing you can send.
