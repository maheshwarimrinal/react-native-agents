# Installation

React Native Agents generates the native instruction format for each coding tool. The source playbooks remain the same across targets.

## Automatic installation

```bash
npx @maheshwarimrinal/react-native-agents install
```

Preview changes without writing files:

```bash
npx @maheshwarimrinal/react-native-agents install --dry-run
```

Existing files are skipped by default. Use `--force` only when you want replacement; user-authored files are backed up. Use `--skip-existing` to make the skip behaviour explicit.

List available agents and tools:

```bash
npx @maheshwarimrinal/react-native-agents list
```

Install selected agents:

```bash
npx @maheshwarimrinal/react-native-agents install --agents rn-security,rn-performance
```

## Claude Code

Plugin installation:

```text
/plugin marketplace add maheshwarimrinal/react-native-agents
/plugin install react-native-agents
```

Or install files directly:

```bash
npx @maheshwarimrinal/react-native-agents install --tool claude-code
```

This creates subagents, slash commands, and reference files under `.claude/`.

## Cursor

```bash
npx @maheshwarimrinal/react-native-agents install --tool cursor
```

This creates `.cursor/rules/*.mdc` files using Cursor's `description`, `globs`, and `alwaysApply` fields. Rules activate from their descriptions and file globs; use `@` to force a rule.

## Windsurf

```bash
npx @maheshwarimrinal/react-native-agents install --tool windsurf
```

The generated rules use `always_on`, `model_decision`, `glob`, and `manual` triggers. Reference files remain separately addressable so the workspace-rule size limit is respected.

## GitHub Copilot

```bash
npx @maheshwarimrinal/react-native-agents install --tool copilot
```

This creates baseline instructions, path-scoped instructions, and selectable chat modes.

## Codex, Zed, Aider, and AGENTS.md-compatible tools

```bash
npx @maheshwarimrinal/react-native-agents install --tool codex
```

This creates `AGENTS.md` plus `.agents/react-native/` specialist playbooks.

## MCP

Any MCP client can launch the server from GitHub or npm:

```json
{
  "mcpServers": {
    "react-native-agents": {
      "command": "npx",
      "args": ["-y", "@maheshwarimrinal/react-native-agents", "mcp"]
    }
  }
}
```

See [Usage](usage.md) for MCP tools and prompts.
