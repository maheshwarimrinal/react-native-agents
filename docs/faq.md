# FAQ

## Do I need an API key for the local agents?

No. The local integrations are instruction files and a local MCP server. The GitHub Action requires an Anthropic or OpenAI API key because it calls the selected provider during CI.

## Does the Action support OpenAI?

Yes. Set `provider: openai`, choose a compatible model such as `gpt-5`, and use `OPENAI_API_KEY`. Anthropic is the default provider.

## Does this support Expo and bare React Native?

Yes. The shared context detects managed Expo, prebuild/bare Expo, and bare React Native workflows. Advice should still be verified against the project's actual SDK and native files.

## What React Native versions are supported?

Knowledge is verified through React Native 0.87 and Expo SDK 57. Older projects are supported, but the agents explicitly call out legacy architecture and version-specific differences.

## Can I install only one agent?

```bash
npx @maheshwarimrinal/react-native-agents install --agents rn-security
```

## Can I customize the agents?

Yes. Edit `agents/`, run `npm run build`, and commit the generated output. For team-specific conventions, fork the repository or maintain a private overlay.

## Why is `dist/` committed?

So npm and GitHub installs work without a build step. CI verifies that generated output remains synchronized with source.

## Can I install from GitHub instead of npm?

Yes:

```bash
npx github:maheshwarimrinal/react-native-agents install
```

Use GitHub installation to try unreleased changes; use npm for stable releases.

## Does this replace ESLint, TypeScript, or security scanners?

No. Those tools catch mechanical or deterministic issues. These agents provide React Native-specific review, trade-offs, and verification guidance.

## Does the installer overwrite my files?

Not by default. Existing files that differ are skipped. Use `--dry-run` to preview, `--skip-existing` to skip explicitly, or `--force` to replace with backups.

## Where should I report a security issue?

Follow [SECURITY.md](../SECURITY.md) rather than opening a public issue.
