<div align="center">

# React Native Agents

**25 expert AI agents for React Native — upgrades, debugging, animation, performance, security, offline, navigation, push, permissions, platform parity, state, accessibility, testing, native modules, observability, release, store submission, payments, background execution, and monorepos.**

Works with Claude Code, Cursor, Windsurf, GitHub Copilot, Codex, Zed, Aider, MCP clients, and GitHub Actions.

[![npm](https://img.shields.io/npm/v/@maheshwarimrinal/react-native-agents.svg)](https://www.npmjs.com/package/@maheshwarimrinal/react-native-agents)
[![GitHub Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-React%20Native%20Audit-blue?logo=github)](https://github.com/marketplace/actions/react-native-audit)
[![CI](https://github.com/maheshwarimrinal/react-native-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/maheshwarimrinal/react-native-agents/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[Project page](https://www.mrinalmaheshwari.com/projects/react-native-agents)** · [npm](https://www.npmjs.com/package/@maheshwarimrinal/react-native-agents) · [Marketplace](https://github.com/marketplace/actions/react-native-audit)

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

Then ask your assistant a normal React Native question. You do not name the agent — the right specialist is selected from how you describe the problem:

```text
The catalogue stutters when I scroll on Android.        → Performance
Deep links open the home screen when the app is killed. → Navigation
Push works when the app is open but not when it's shut. → Push
The Allow Camera button does nothing.                   → Permissions
App Store rejected us for the privacy manifest.         → Store Submission
Should we use Zustand or Redux Toolkit?                 → State
Upgrade us from 0.81 to 0.87.                           → Upgrade
We inherited this codebase and there are no docs.       → Onboard
```

Or invoke one directly with the tool's supported command or chat mode — `/rn-perf`, `/rn-nav`, `/rn-debug`, and so on. The full list is in [the agents guide](docs/agents.md).

## Automate pull-request reviews

The GitHub Action reviews changed files using the relevant specialists and posts findings to the pull request.

```yaml
- name: React Native audit
  uses: maheshwarimrinal/react-native-agents@v1
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
  uses: maheshwarimrinal/react-native-agents@v1
  with:
    provider: openai
    model: gpt-5
    api-key: ${{ secrets.OPENAI_API_KEY }}
```

`@v1` tracks the latest v1 release. To pin exactly, use a full tag (`@v1.3.0`) or a commit SHA — the SHA is the strictest option and what supply-chain-sensitive setups should prefer.

Store API keys as GitHub Actions repository secrets. Do not commit them to workflow files.

**A failed run fails the check.** If an agent errors — an invalid key, no credits left, a provider
outage — the audit exits non-zero rather than reporting a pass with zero findings. A green check
that means "we did not actually look" is worse than a red one. Set `fail-on-error: false` if you
would rather accept partial coverage.

## The agents

**Day to day** — these respond to a question, an error log, or a request:

| Agent | Focus | Command |
|---|---|---|
| 🩺 Doctor | Gradle, CocoaPods, Metro, Xcode, and environment failures — diagnosed from your actual error output | `/rn-doctor` |
| 🏗️ Build | New screens, components, forms, and lists that already handle safe areas, accessibility, states, and keyboard | `/rn-new` |
| 🔍 Debug | Builds fine but behaves wrong — render loops, state that will not update, release-only bugs, post-Flipper tooling | `/rn-debug` |
| 📦 Dependencies | Should we add this library — New Arch support, maintenance, native cost, lighter alternatives | `/rn-deps` |
| 🗺️ Onboard | Orienting in an inherited codebase — architecture map, conventions, landmines, what to read first | `/rn-onboard` |
| 🏪 Store Submission | Rejection triage, privacy manifests, Data Safety, ATT, target API deadlines | `/rn-submit` |
| 🗂️ Monorepo | Metro resolution across packages, hoisting, duplicate React, autolinking from a nested app | `/rn-monorepo` |

**Review** — these run on a diff, and on pull requests:

| Agent | Focus | Command |
|---|---|---|
| 🎬 Animation | Reanimated worklets, gestures, layout animations | `/rn-animate` |
| ⚡ Performance | Lists, rendering, startup, memory, bundles | `/rn-perf` |
| 🔒 Security | Secrets, storage, auth, TLS, WebViews, deep links, supply chain | `/rn-security` |
| 🧹 Code Quality | Architecture, TypeScript, hooks, state, errors, RN idioms | `/rn-review` |
| 🎨 UI & Accessibility | Layout, safe areas, screen readers, contrast, RTL, theming | `/rn-ui` |
| 🧪 Testing | Jest, RNTL, mocking, Maestro, Detox, CI | `/rn-test` |
| 🔧 Native Modules | TurboModules, Fabric, JSI, codegen, Swift/Kotlin, packaging, bridge migration | `/rn-native` |
| 🔭 Observability | Crash reporting that silently doesn't work, symbolication, breadcrumbs, tracing, PII in telemetry | `/rn-observe` |
| 🚀 Release | EAS, signing, OTA, stores, rollout, rollback | `/rn-release` |
| ⬆️ Upgrade | Version matrix, New Architecture migration, scope moves, and the regressions that compile cleanly | `/rn-upgrade` |
| 🧭 Navigation | Deep links, cold-start routing, auth guards, nested navigators, typed params | `/rn-nav` |
| 🔔 Push | APNs and FCM setup, token lifecycle, background handlers, tap routing | `/rn-push` |
| 🔐 Permissions | Denial and blocked states, purpose strings, rationale flows, partial grants | `/rn-permissions` |
| 📱 Platform Parity | iOS/Android divergence — keyboard, safe areas, hardware back, shadows, pickers | `/rn-parity` |
| 📴 Offline | Durable mutation queues, idempotency, optimistic rollback, conflicts, sync | `/rn-offline` |
| 🗃️ State | Server vs client state, selectors and re-renders, persistence and hydration | `/rn-state` |
| 💳 Payments | IAP and subscriptions, server-side receipt validation, restore, refunds, grace periods | `/rn-pay` |
| 🌙 Background | Background fetch, headless JS, location, and designing for the task not running | `/rn-background` |
| 🔎 Audit | Runs and consolidates every review specialist | `/rn-audit` |

Seven agents are deliberately excluded from pull-request routing — **Doctor, Build, Debug, Dependencies, Onboard, Store Submission, and Monorepo**. They need something brought to them: an error log, a question, a rejection notice. Firing them at a diff would spend tokens to say nothing.

Routing is narrow on purpose. A typical UI change reaches about three agents, not twenty-four — signals are scoped so that adding specialists does not raise the cost of an ordinary pull request.

25 playbooks and 133 reference documents. Knowledge is verified through React Native 0.87 and Expo SDK 57; always verify version-specific advice against your project.

## Bundle size, measured

`rn-size` analyses your production bundle from its source map. It is **deterministic — no model call, no API key, no cost**, so it can run on every pull request for free.

```bash
npx @maheshwarimrinal/react-native-agents size
npx @maheshwarimrinal/react-native-agents size --base main --budget-delta 100kb
```

```text
📦 Bundle size 📈 +332.0 KB
2.00 MB → 2.33 MB (+16.2%)

❌ Budget exceeded — increase 332.0 KB exceeds budget 100.0 KB

| moment 🆕 | +207.0 KB | 207.0 KB |
→ date-fns or dayjs (Hermes ships Intl, so formatting may need no library at all)
```

Bytes are attributed per source-map segment, so a package's number is measured rather than estimated. Budgets accept `250kb`, `1.5mb`, or a raw byte count; an invalid value is an error rather than a silently skipped check.

## Telemetry

**Off by default.** Nothing is sent unless you turn it on.

```bash
npx @maheshwarimrinal/react-native-agents telemetry           # status
npx @maheshwarimrinal/react-native-agents telemetry enable    # opt in
npx @maheshwarimrinal/react-native-agents telemetry disable   # opt back out
```

When enabled it sends anonymous adoption data only — package version, Node major, OS, and which
editor you installed for. Never paths, repository names, project names, code, findings, or IP
address. `DO_NOT_TRACK=1` and `RN_AGENTS_TELEMETRY=0` are honoured and override an opt-in.

Every field that can ever be transmitted is listed in [TELEMETRY.md](TELEMETRY.md), and a test
fails the build if that document falls out of sync with the code.

For download counts you do not need telemetry at all:

```bash
npx @maheshwarimrinal/react-native-agents stats
```

That reads the public npm registry — every download rather than a consenting sample, retroactive
across every release, and it collects nothing from anyone.

## Documentation

- [Project page](https://www.mrinalmaheshwari.com/projects/react-native-agents) — overview of the agents, the bundle-size analyzer, and the design decisions behind them
- [Real-world demo](examples/react-native-audit-demo/README.md) — intentionally flawed React Native project with a PR audit workflow
- [Installation by tool](docs/installation.md) — Claude Code, Cursor, Windsurf, Copilot, Codex, and MCP
- [GitHub Action guide](docs/github-action.md) — providers, secrets, inputs, outputs, routing, and severity gates
- [Agents guide](docs/agents.md) — what each specialist catches and when to use it
- [Usage guide](docs/usage.md) — prompts, commands, MCP, full audits, severity, and finding format
- [Architecture](docs/architecture.md) — source files, generator, generated targets, and design decisions
- [Development guide](docs/development.md) — build, test, evals, freshness checks, and extending the project
- [FAQ](docs/faq.md) — versions, Expo, API keys, customization, npm, and troubleshooting
- [Telemetry](TELEMETRY.md) — every field collected, verbatim, and how to turn it off
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

If React Native Agents saves you time, you can support its ongoing maintenance. The agents are MIT
and stay that way — sponsorship pays for the upkeep behind them: tracking React Native releases,
refreshing the knowledge base, and adding specialists.

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/maheshwarimrinal)

Recurring support goes through [GitHub Sponsors](https://github.com/sponsors/maheshwarimrinal).
For a one-off, there is coffee:

[![Buy Me a Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/maheshwarimrinal)
