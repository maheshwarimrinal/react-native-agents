<div align="center">

# React Native Agents

**Six expert AI agents for React Native — performance, security, code quality, accessibility, testing, and release.**

Works with Claude Code, Cursor, Windsurf, GitHub Copilot, Codex, Zed, Aider, MCP clients, and GitHub Actions.

[![npm](https://img.shields.io/npm/v/@maheshwarimrinal/react-native-agents.svg)](https://www.npmjs.com/package/@maheshwarimrinal/react-native-agents)
[![GitHub Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-React%20Native%20Audit-blue?logo=github)](https://github.com/marketplace/actions/react-native-audit)
[![CI](https://github.com/maheshwarimrinal/react-native-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/maheshwarimrinal/react-native-agents/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

React Native Agents gives your AI coding tool specialist React Native guidance instead of generic React advice. The agents inspect the project context first, use deep references on demand, and explain findings with practical fixes and verification steps.

## Quick start

```bash
npx @maheshwarimrinal/react-native-agents install
```

Or install for one tool:

```bash
npx @maheshwarimrinal/react-native-agents install --tool cursor
npx @maheshwarimrinal/react-native-agents install --tool claude-code
npx @maheshwarimrinal/react-native-agents install --tool windsurf
```

Then ask your assistant a normal React Native question:

```text
The catalogue stutters when I scroll on Android. Find the likely causes and show me how to measure them.
```

The right specialist is selected automatically, or you can invoke one directly using the tool's supported command or chat mode.

## Automate pull-request reviews

The GitHub Action reviews changed files using the relevant specialists and posts findings to the pull request.

```yaml
- name: React Native audit
  uses: maheshwarimrinal/react-native-agents@v1.0.1
  with:
    provider: anthropic
    model: claude-sonnet-5
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    budget-usd: '1.50'
    fail-on: never
```

OpenAI is also supported:

```yaml
- name: React Native audit
  uses: maheshwarimrinal/react-native-agents@v1.0.1
  with:
    provider: openai
    model: gpt-5
    api-key: ${{ secrets.OPENAI_API_KEY }}
```

Store API keys as GitHub Actions repository secrets. Do not commit them to workflow files.

## The agents

| Agent | Focus | Claude Code command |
|---|---|---|
| ⚡ Performance | Lists, rendering, startup, memory, bundles | `/rn-perf` |
| 🔒 Security | Secrets, storage, auth, TLS, WebViews, deep links, supply chain | `/rn-security` |
| 🧹 Code Quality | Architecture, TypeScript, hooks, state, errors, RN idioms | `/rn-review` |
| 🎨 UI & Accessibility | Layout, safe areas, screen readers, contrast, RTL, theming | `/rn-ui` |
| 🧪 Testing | Jest, RNTL, mocking, Maestro, Detox, CI | `/rn-test` |
| 🚀 Release | EAS, signing, OTA, stores, rollout, rollback | `/rn-release` |
| 🔎 Audit | Runs and consolidates all six specialists | `/rn-audit` |

The source contains 6 playbooks and 38 reference documents. Knowledge is verified through React Native 0.87 and Expo SDK 57; always verify version-specific advice against your project.

## Documentation

- [Real-world demo](examples/react-native-audit-demo/README.md) — intentionally flawed React Native project with a PR audit workflow
- [Installation by tool](docs/installation.md) — Claude Code, Cursor, Windsurf, Copilot, Codex, and MCP
- [GitHub Action guide](docs/github-action.md) — providers, secrets, inputs, outputs, routing, and severity gates
- [Agents guide](docs/agents.md) — what each specialist catches and when to use it
- [Usage guide](docs/usage.md) — prompts, commands, MCP, full audits, severity, and finding format
- [Architecture](docs/architecture.md) — source files, generator, generated targets, and design decisions
- [Development guide](docs/development.md) — build, test, evals, freshness checks, and extending the project
- [FAQ](docs/faq.md) — versions, Expo, API keys, customization, npm, and troubleshooting
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Supported targets

| Target | Generated output |
|---|---|
| Claude Code | Plugin, marketplace entry, subagents, slash commands |
| Cursor | `.cursor/rules/*.mdc` |
| Windsurf | Trigger-scoped `.windsurf/rules/*.md` |
| GitHub Copilot | Instructions, path-scoped rules, chat modes |
| Codex, Zed, Aider | `AGENTS.md` and `.agents/react-native/` |
| MCP clients | Zero-dependency stdio MCP server |

## License

MIT — see [LICENSE](LICENSE).

## Support the project

If React Native Agents saves you time, you can support its ongoing maintenance:

[![Buy Me a Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/maheshwarimrinal)
