# Telemetry

**Telemetry is off.** Nothing is sent unless you explicitly turn it on.

This document lists every field that can ever be transmitted, verbatim. If something is not on
this page, this package does not collect it.

## Status and control

```bash
npx @maheshwarimrinal/react-native-agents telemetry           # show current status
npx @maheshwarimrinal/react-native-agents telemetry enable    # opt in
npx @maheshwarimrinal/react-native-agents telemetry disable   # opt back out
```

Environment variables, which override the stored setting:

| Variable | Effect |
|---|---|
| `DO_NOT_TRACK=1` | Disables telemetry unconditionally. Honoured above everything else. |
| `RN_AGENTS_TELEMETRY=0` | Disables telemetry. |
| `RN_AGENTS_TELEMETRY=1` | Enables telemetry without writing a config file — useful in CI. |

**Any signal that says "no" wins.** There is no combination of settings in which a user who set
`DO_NOT_TRACK` is still tracked; this is asserted by a test.

The setting is stored in a `config.json` under your OS config directory — `~/.config/react-native-agents/`
on Linux, `~/Library/Application Support/react-native-agents/` on macOS, `%APPDATA%\react-native-agents\`
on Windows. Deleting that file resets everything, including the installation identifier.

## What is collected

Only these fields. The list is enforced in code: anything a caller passes that is not on it is
dropped before the payload is built.

| Field | Example | Why |
|---|---|---|
| `surface` | `cli`, `mcp`, `action` | Which entry point ran |
| `command` | `install`, `size`, `audit` | Fixed vocabulary from this repo — never anything you typed |
| `tool` | `cursor`, `claude-code`, `windsurf` | Which editor the agents were installed for |
| `agent_id` | `rn-performance` | Which specialist was loaded, from this repo's own ids |
| `agent_count` | `3` | How many agents an audit ran |
| `version` | `1.2.0` | This package's version |
| `node_major` | `22` | Node major version only — not the full version string |
| `os` | `darwin`, `linux`, `win32` | Platform only |
| `ci` | `true` | Whether this was an automated environment |

Alongside these, a random `distinct_id` identifies the *installation*, not you. It is a
`crypto.randomUUID()` generated locally on first use and stored in your config file. It is not
derived from your hostname, MAC address, username, home directory, or anything else about your
machine, and deleting the config file produces a new one.

## What is never collected

- File paths, directory names, or your working directory
- Repository names, project names, or package names
- Source code, diffs, or any file contents
- Findings, error messages, or stack traces
- Usernames, email addresses, or any account identifier
- **IP address** — the payload explicitly sets `$ip: null`, which disables the geolocation the
  analytics provider would otherwise perform. An IP address is personal data under GDPR and there
  is no use for it here.
- Anything that would let anyone, including us, work out who you are or what you are building

There is a second line of defence beyond the allow-list: any value that looks like a path, a
traversal, a Windows drive letter, or an email address is dropped even if its field name is
permitted.

## Events

| Event | Sent when |
|---|---|
| `cli_install` | `install` completes successfully, once per target tool |
| `mcp_agent_loaded` | An MCP client loads an agent via `get_react_native_agent` |
| `action_run` | A GitHub Action audit completes |

## How it behaves

- **Fire-and-forget**, with a hard 1.5-second timeout. It cannot slow down or fail your command.
- **All errors are swallowed.** A network failure is silent by design.
- **Zero dependencies.** It is a plain HTTPS POST, not an analytics SDK, so it does not add a
  dependency tree to a package that deliberately has none.
- **A build with no configured key sends nothing**, regardless of your setting. Local checkouts
  and forks are inert.

Data goes to PostHog's EU cloud.

## Why this exists

To answer questions like *"is anyone using the new agents?"* and *"which editors should we
prioritise?"* — questions this project currently guesses at.

It deliberately cannot answer *"who uses this?"*. Those are different questions, and the second
one requires personal data that is not worth collecting.

If you only want reach numbers, you do not need telemetry at all:

```bash
npx @maheshwarimrinal/react-native-agents stats
```

That reads the **public npm registry API**, counts every download rather than a consenting sample,
works retroactively for every release already published, and collects nothing from anyone.

## Auditing this yourself

The implementation is one readable file: [`scripts/lib/telemetry.mjs`](scripts/lib/telemetry.mjs).
The allow-list is a single `Set` near the top.

Verify the claims on this page:

```bash
node scripts/test.mjs 2>&1 | grep -i telemetry
```

Those tests assert that it is off by default, that `DO_NOT_TRACK` beats an explicit opt-in, that
non-allow-listed fields are dropped, that `capture` performs no network call while disabled, and
that every field which can ship is documented on this page — so this document cannot drift from
the code without failing the build.
