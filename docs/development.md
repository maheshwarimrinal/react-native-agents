# Development

## Requirements

- Node.js 18 or newer
- No npm dependencies are required

## Build and test

```bash
git clone https://github.com/maheshwarimrinal/react-native-agents
cd react-native-agents

npm run build
npm test
npm run check
npm run evals:validate
npm run freshness
```

`npm run build` regenerates all tool targets. `npm run check` fails when `dist/` is out of sync.

The test suites cover source parsing, generated output, MCP protocol behavior, installer safety, routing, the GitHub Action engine, and evaluation fixture structure.

## Agent evaluations

Evaluation fixtures live under `evals/`. Each case defines expected findings, forbidden recommendations, and severity expectations. Validate fixture structure without a model call:

```bash
npm run evals:validate
```

See [evals/README.md](../evals/README.md) for the evaluation format.

## Add a reference

1. Add a Markdown file under `agents/<id>/references/`.
2. Add its slug to the agent frontmatter.
3. Run `npm run build && npm test`.
4. Commit both source changes and generated `dist/` output.

## Add an agent

Create `agents/<id>/agent.md` with YAML frontmatter and at least three references. Include its description, globs, command, triggers, and reference slugs. The build discovers agents automatically.

## Add a tool target

Implement an emitter in `scripts/lib/targets.mjs`, register it in the target map and CLI tool list, then add generator tests.

## Pull requests

Keep guidance concrete, measured, version-aware, and honest about uncertainty. Do not add fabricated performance numbers, unsupported API claims, or security claims without evidence.
