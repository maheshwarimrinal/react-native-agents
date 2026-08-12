---
description: Run a full React Native audit across all specialist agents.
argument-hint: "[path or scope]"
---


# Full React Native audit

Run a complete review of this React Native project using the specialist subagents.

## Step 1 — Establish context

Read `package.json`, `app.json` / `app.config.*`, and check for `ios/` and `android/`
directories. Determine: React Native version, Expo SDK (if any), managed vs bare workflow,
TypeScript or JavaScript, router, and state library. State these findings before proceeding —
every agent depends on them.

## Step 2 — Dispatch the specialists

Run these subagents in parallel where possible:

- **rn-code-quality** — RN Code Quality
- **rn-performance** — RN Performance
- **rn-release** — RN Release
- **rn-security** — RN Security
- **rn-testing** — RN Testing
- **rn-ui-accessibility** — RN UI & A11y

Scope: $ARGUMENTS (if empty, scope to `src/` and the app entry points, and say so).

## Step 3 — Consolidate

Merge the findings into one report:

1. A one-paragraph health summary — is this shippable, and what is the single biggest risk?
2. A severity table (P0/P1/P2/P3 counts by agent).
3. All P0 and P1 findings in full, deduplicated where two agents found the same thing.
4. P2/P3 grouped by theme, summarised.
5. **Top 5 actions** ranked by impact per unit of effort — this is what the team will do.

Do not pad the report. If an area is clean, say so in one line and move on.
