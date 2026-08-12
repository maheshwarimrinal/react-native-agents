# Usage

## Natural-language requests

Usually, describe the problem without naming an agent:

```text
The feed stutters when I scroll on Android.
Is it safe to store the refresh token here?
Review this screen before I ship it.
Why does the layout break at large text sizes?
Write tests for the checkout flow.
Our OTA update crashed everyone.
```

The tool routes the request to the relevant specialist. MCP routing uses weighted signals and returns a confidence level rather than guessing when there is no meaningful match.

## Full audits

In Claude Code:

```text
/rn-audit
/rn-audit src/features/
```

The orchestrator detects the project, runs the specialists, deduplicates findings, groups lower-severity themes, and returns the top actions ranked by impact and effort.

## Severity scale

| Level | Meaning | Response |
|---|---|---|
| P0 | Exploitable vulnerability, data loss, launch crash, or store blocker | Fix before merge |
| P1 | Important user-visible degradation, likely bug, or real security weakness | Fix this sprint |
| P2 | Measurable inefficiency, maintainability risk, or partial accessibility failure | Schedule it |
| P3 | Polish and nice-to-have improvements | Batch it |

Agents should not invent measurements about the user's code. They should distinguish established platform facts from claims that require profiling or testing.

## Finding format

Findings include a severity, file and line, explanation, concrete fix, and verification step:

```text
### [P1] Unstable renderItem recreates every row
src/screens/Feed.tsx:88

What's happening
renderItem has a new function identity on every parent render.

Why it matters
This can cause unnecessary row work. Confirm the frequency with React DevTools Profiler.

Fix
Move the row renderer to a stable callback and pass stable dependencies.

Verify
Record a scroll in a release build and compare row commits before and after.
```

## MCP tools

The MCP server exposes tools to:

- List specialists and their triggers
- Load a specialist playbook
- Load an individual reference document
- Suggest a specialist from a free-text task
- Build a full audit plan

It also exposes one prompt per specialist plus the full audit prompt, and resources for playbooks and references.

## Local audit engine

Preview routing without an API call:

```bash
npx @maheshwarimrinal/react-native-agents audit \
  --diff-file pr.diff \
  --provider mock \
  --dry-run
```
