# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report privately through [GitHub Security Advisories](https://github.com/maheshwarimrinal/react-native-agents/security/advisories/new),
which is the preferred channel. It keeps the report private until a fix is available and lets us
credit you properly.

If you can't use Security Advisories, email **maheshwari.mrinal@gmail.com** with `SECURITY` in the
subject line.

### What to include

- What the issue is and where in the codebase
- How to reproduce it, ideally with a minimal case
- What an attacker could actually achieve
- Your assessment of severity, and any suggested fix

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement | 48 hours |
| Initial assessment | 7 days |
| Fix for a confirmed high-severity issue | 30 days |
| Public disclosure | After a fix ships, coordinated with you |

This is a small project maintained by one person, so these are honest targets rather than a
contractual SLA. If something is being actively exploited, say so in the subject line and it will
be treated accordingly.

## Supported versions

| Version | Supported |
|---|---|
| Latest release on `main` | ✅ |
| Older releases | ❌ — please upgrade |

Fixes ship in a new release rather than being backported.

## Scope

### In scope

This repository is developer tooling, so the meaningful risks are supply-chain and local:

- **The installer writing outside the target project.** Path traversal, symlink following, or
  escaping the working directory would be a real vulnerability.
- **Destroying user files.** The installer must never overwrite user-authored files without
  explicit consent. This is treated as a security-class bug, not just a usability one.
- **Code execution during install.** There are no install scripts and no dependencies; anything
  that introduces execution at install time is in scope.
- **The GitHub Action leaking secrets.** API keys or tokens appearing in logs, in PR comments,
  or being sent anywhere other than the configured model provider.
- **The MCP server.** It reads from the repository and writes to stdout. Anything that lets a
  crafted request read files outside the package or execute code is in scope.
- **Prompt injection with real consequences.** Content in a reviewed diff that causes the agent
  to exfiltrate data or take destructive action — as opposed to merely producing a wrong review.
- **Supply chain.** A compromised release artifact, or a tag pointing at unexpected code.

### Out of scope

- **Bad security advice from an agent.** Important, and we want to hear about it — but it's a
  correctness bug, so please open a normal issue with the case that produced it. Better still,
  add an eval case (see `evals/README.md`).
- **Vulnerabilities in React Native, Expo, or any package the agents discuss.** Report those
  upstream.
- **Your own API key leaking through your own CI configuration.** The Action reads the key you
  provide; securing your repository secrets is your responsibility. We will still fix anything
  that causes the key to be logged or transmitted incorrectly.
- **The model provider's behaviour.** Data handling by Anthropic or OpenAI is governed by their
  terms, not ours.

## Design notes relevant to security

Some deliberate choices that reduce the attack surface:

- **Zero runtime dependencies.** No transitive supply chain, and nothing to be compromised in a
  patch release. Verified by tests.
- **No install scripts.** Nothing executes on `npm install`.
- **No network access at install time.** The installer only copies files from the package.
- **The Action runs in your CI, with your key.** No data is sent to any infrastructure we
  operate — the only outbound request goes to the model provider you configured.
- **Conflicts are skipped by default.** The installer will not replace an existing file unless
  you pass `--force`, and even then it backs up user-authored files first.
- **GitHub Actions are pinned to commit SHAs**, not mutable tags.

## Recognition

Valid reports are credited in the advisory and the release notes unless you'd rather stay
anonymous. There is no bug bounty — this is an unfunded open-source project, and it would be
dishonest to imply otherwise.
