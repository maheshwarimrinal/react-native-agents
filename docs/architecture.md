# Architecture

## Single source, many targets

```text
agents/<id>/agent.md
agents/<id>/references/*.md
shared/rn-context.md
              │
              ▼
       scripts/build.mjs
              │
   ┌──────────┼──────────┬──────────┬──────────┐
   ▼          ▼          ▼          ▼          ▼
 Claude     Cursor     Windsurf   Copilot    AGENTS.md
 plugin     .mdc       rules      rules      targets
```

Edit the source playbooks once, then regenerate `dist/` for every target. Generated files should not be edited manually.

## Generated outputs

| Directory | Output |
|---|---|
| `dist/claude-code/` | Claude plugin, subagents, commands, marketplace metadata |
| `dist/cursor/` | Cursor `.mdc` rules |
| `dist/windsurf/` | Windsurf trigger-scoped rules |
| `dist/copilot/` | Copilot instructions and chat modes |
| `dist/agents-md/` | `AGENTS.md` and specialist files |
| `dist/index.json` | Machine-readable agent index |

## Design decisions

**Zero dependencies.** The frontmatter parser and MCP server are implemented directly, reducing installation and supply-chain risk.

**Committed `dist/`.** npm and GitHub users can run the project without a build step. CI checks that generated output matches source.

**On-demand references.** Playbooks stay compact while deeper material remains available to agents that need it.

**Non-destructive installation.** The installer previews changes, skips conflicts by default, supports `--force`, and backs up user-authored files when replacing them.

**Version single source of truth.** `package.json` supplies the package, plugin, marketplace, index, and MCP versions.

## Repository layout

```text
agents/                 source playbooks and references
shared/                 shared React Native context
scripts/                generator, CLI, tests, freshness check
action/                 GitHub Action audit engine
mcp-server/             zero-dependency MCP server
evals/                  agent-quality evaluation fixtures
dist/                   generated tool-specific output
docs/                   public documentation
```
