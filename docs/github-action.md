# GitHub Action

The Action reviews pull requests in the user's GitHub Actions runner using the user's chosen model provider. It does not send code to infrastructure operated by React Native Agents.

## Basic setup

Create `.github/workflows/rn-audit.yml`:

```yaml
name: React Native audit

on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: maheshwarimrinal/react-native-agents@v1
        with:
          provider: anthropic
          model: claude-sonnet-5
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          budget-usd: '1.50'
          fail-on: never
```

For OpenAI:

```yaml
- uses: maheshwarimrinal/react-native-agents@v1
  with:
    provider: openai
    model: gpt-5
    api-key: ${{ secrets.OPENAI_API_KEY }}
```

Add the matching key under repository **Settings → Secrets and variables → Actions**. Never place an API key directly in YAML.

## Inputs

| Input | Default | Purpose |
|---|---:|---|
| `provider` | `anthropic` | `anthropic` or `openai` |
| `model` | Provider default | Model identifier |
| `api-key` | required | Provider API key |
| `fail-on-error` | `true` | Fail the check when an agent errors or the budget cap stops the run early. An audit where agents failed reviewed nothing, so a pass would be misleading. Set `false` to accept partial coverage. |
| `agents` | auto | Comma-separated forced agent IDs |
| `max-agents` | `6` | Maximum agents per run |
| `budget-usd` | `2` | Estimated preflight budget — a brake, not a hard cap. See below. |
| `fail-on` | `never` | `P0`, `P1`, `P2`, `P3`, or `never` |
| `dry-run` | `false` | Route without model calls |

## Outputs

The Action exposes finding counts, estimated cost, the agents that ran, and JSON findings through `total`, `p0`, `p1`, `p2`, `p3`, `cost-usd`, `agents`, and `findings-json` outputs.

## Routing and cost control

The Action routes changed files to relevant specialists. For example, `eas.json` routes to release, authentication changes route to security, and list components route to performance and UI/accessibility.

### What `budget-usd` actually does

Before each model call, the run estimates that call's cost from an approximate token count and a table of published prices. If adding it would push the running estimate past `budget-usd`, the call is not made: the run stops, reports what it reviewed, and marks `budget-hit`.

**It is an estimate, not a guarantee.** Four things keep it from being a hard cap:

- Token counts are approximated from text length, not tokenized.
- The check happens *before* a call. A call already in flight is not interrupted.
- Prices change. The table is dated in [`action/lib/llm.mjs`](../action/lib/llm.mjs) and can go stale.
- A model absent from that table is priced at the most expensive known rate — deliberately pessimistic, so an unknown model stops the run early rather than overspending quietly. The run warns when this happens.

Local models (an `OPENAI_BASE_URL` pointing at localhost) are treated as free and are not budgeted at all.

If you need a spend limit you can rely on, set one with your provider. This one is a brake on runaway routing, not a billing control.

Start with `fail-on: never` while calibrating. Tighten to `P1` or `P0` only after the team trusts the signal.

For the complete metadata, see [`action.yml`](../action.yml). For a full workflow, see [`action/examples/rn-audit.yml`](../action/examples/rn-audit.yml).
