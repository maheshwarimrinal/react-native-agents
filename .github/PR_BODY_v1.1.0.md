# v1.1.0 — rn-observability, and doubling the eval suite

Adds a tenth agent, and the quality work that should accompany one.

---

## 🔭 `rn-observability`

Crash reporting, symbolication, breadcrumbs, tracing, and telemetry privacy.

Its organising premise is that **broken telemetry looks exactly like a healthy app.** An empty crash dashboard means either the app is stable or the reporter isn't working, and those are indistinguishable from the outside — teams believe the first for months while the second is true.

So the agent refuses to assess coverage until it has proof:

> Show me a symbolicated stack trace from a **release** build.

Anything that silently disables reporting is P0/P1 — not because it breaks the app, but because it removes the team's ability to know the app is broken, which is worse and lasts longer.

**References**

| File | Covers |
|---|---|
| `silent-failures` | Ten failure modes that produce no build error and no runtime error |
| `symbolication` | dSYMs, ProGuard mappings, source maps, and the release/dist mismatch that looks identical to "never uploaded" |
| `crash-reporting` | SDK init timing, vendor comparison, release health, alerting on rates not counts |
| `events-and-tracing` | Breadcrumb and event schema, network instrumentation, sampling |
| `privacy-and-volume` | What leaks by default, consent before initialisation, cost control |

Routes on vendor files, `proguard-rules.pro`, analytics/telemetry/monitoring directories, and root entry points. Mode `both` — it works in PR review and interactively.

---

## 🧪 Eval suite: 9 → 20 cases

Every agent now has **two**, and there's a case type that didn't exist before: **clean fixtures where the agent must find nothing.**

Six of them (`performance`, `security`, `ui-accessibility`, `code-quality`, `build`, `native-modules`) contain deliberately correct code and assert `expectMaxFindings`, with forbid rules naming the likely false positives.

This matters more than another agent. **An agent that invents findings is worse than one that misses some** — every false positive costs a human the time to dismiss it and erodes trust in the real findings. Nothing was testing for that.

Verified the discrimination works: noisy output trips 2 violations, correct output passes clean, 3 findings against a cap of 1 fails.

New failure cases: `pods-out-of-sync` (tests *against* over-diagnosis, since the error names its own cause), `flaky-e2e`, `missing-sourcemaps`, `proguard-strips-sdk`, `silent-crash-reporting`.

---

## 🐛 Fixes from the pre-release review

**P1 — `.fuse_hidden` files shipped to npm.** Five files, 72KB, in the published tarball. npm doesn't consult `.gitignore` for allowlisted directories, so the fix is negation entries in `files` rather than deletion. Added a test that inspects the real `npm pack --json` manifest — it also catches `.DS_Store`, `.tgz`, and editor swap files.

**P2 — `**/App.tsx` over-routed to observability.** Almost every UI change touches `App.tsx`, so it spent an observability model call on unrelated work. Removed. Telemetry genuinely added there is still caught by diff keyword signals, and there's a test proving that path so the coverage isn't lost.

**P2 — `src/analytics/events.ts` matched nothing.** Added directory globs (`analytics`, `telemetry`, `monitoring`, `observability`, `instrumentation`) plus the four missing Action routing tests.

**P3 — the eval coverage test asserted less than its name claimed.** Enforced the named requirement rather than renaming it, which meant writing the two missing clean cases instead of lowering the bar.

**Routing tie.** `rn-release` held `sentry`, `crash`, `monitoring`, and `source map` in its medium list, tying with observability on *"Sentry shows no production crashes"*. Moved to observability; release keeps its rollout-specific strong terms. Guards added in both directions.

---

## ✅ Verification

```
277  repository tests
120  action tests
 20  eval cases validated
327  generated files in sync
  0  residue files in the npm tarball (was 5)
```

| Check | Result |
|---|---|
| `Sentry shows no production crashes` | `rn-observability` high/5 vs release low/1 (was a 5–5 tie) |
| `App.tsx` | no longer routes to observability |
| `src/analytics/events.ts` | routes to observability ✓ |
| Every agent | 2 eval cases, 6 with clean coverage |

---

## ⚠️ Not yet verified

**The evals have never run against a real model.** `--validate` proves the cases are well-formed, not that the agents pass them.

```bash
ANTHROPIC_API_KEY=... npm run evals
```

I'd expect the six clean cases to be where failures show up first — reflexive false positives are the most likely weakness, and that's precisely what they were written to measure.
