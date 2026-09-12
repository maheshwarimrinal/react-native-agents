# Community feedback backlog

Twenty problem statements were raised by the React Native community after the
project was posted publicly. They describe about **six distinct problems** — the
duplication is not padding, it is the same defect seen from different angles,
which is itself a signal about where the risk sits.

This document is the mapping. Each cluster below is one GitHub issue.

**Sequencing principle: fix truth before adding reasoning on top of it.** Every
proposal in clusters A–C builds a layer that consumes the agent corpus. If the
corpus still contains fabricated facts, a reasoning layer does not catch them —
it propagates them with more confidence. That is cluster D's mechanism, and it
is exactly how one wrong Reanimated version became four corroborating sites.

| Cluster | Community items | Status |
|---|---|---|
| A — Tests derived from the implementation they test | 1, 2, 3, 19 | Open |
| B — Flows that span specialists | 4, 5, 20 | Open, reproducer below |
| C — Routing economics | 6 | Measured; narrower than assumed |
| D — Knowledge drifts at different rates | 7, 8, 11, 12, 13, 16 | Partly closed |
| E — Invented APIs | 9, 10 | Closed for covered namespaces |
| F — Evidence quality and proportionate effort | 14, 15, 17, 18 | Open |

---

## A — A test can validate the implementation instead of the intended behaviour

*Community items 1, 2, 3, 19.*

When the agent that writes the code also decides what correct means, the loop
closes: implementation → read implementation → tests derived from it → green.
Item 19 is the sharpest formulation — if the implementer can also edit the
specification, the same failure reappears one level up.

**What we already know works.** Item 3 asks for a way to tell whether generated
tests would fail if behaviour broke. That is mutation testing, and it is already
this repository's internal standard: 46 mutations were run during one week of
review, and **four survived** — including two tests written specifically to prove
a fix, which passed with the fix reverted. The technique is proven here. It has
no product surface.

Constraint from items 17 and 18: any mechanism must be opt-in and scoped. A
correctness pass that doubles CI time gets switched off, and then protects
nothing. A permission-state transition and a scroll-performance investigation do
not warrant the same rigor.

**Honest position:** the full closed-loop problem needs a source of truth the
implementer cannot write to, which is an architecture change rather than a
prompt change. Mutation testing is a genuine partial mitigation — a test that
survives mutation is load-bearing even if it was derived from the
implementation — and should ship first.

---

## B — Real problems span specialists

*Community items 4, 5, 20.*

**Confirmed, with a reproducer.** A diff containing a deep link, a permission
check, and `messaging().onNotificationOpenedApp` routes 5 of 25 agents:
permissions, navigation, security, code-quality, accessibility. It does **not**
route `rn-push` — that agent has 14 triggers and none match `messaging()` or
`onNotificationOpenedApp`; the closest is the two-word phrase "firebase
messaging". The community's own example (notifications interacting with
navigation and permissions) fails today.

Three parts, only the first of which is near-term:

- **Routing recall** — mechanical. Needs recall tests so it cannot silently
  regress.
- **Conflict surfacing** — detect when two specialists touch the same lines with
  incompatible advice. Surfacing disagreement is achievable; *resolving* it is
  not, and pretending otherwise would be worse than showing both.
- **Flow-level reasoning** — the item 20 problem, that code-level correctness is
  not user-level correctness. Hard. Deferred deliberately.

---

## C — Routing breadth

*Community item 6.*

Measured rather than assumed: the cross-domain diff above pulls **5 of 25**
agents, not 20. Routing breadth is not currently the cost problem, and treating
it as urgent would mean narrowing something already narrow.

The actual defect is the opposite — **under**-routing, covered in cluster B.
Recorded here so the conclusion is not re-derived from scratch later.

---

## D — Knowledge drifts, at different rates, in different places

*Community items 7, 8, 11, 12, 13, 16.*

Item 12 deserves more weight than its position suggests. "Shared knowledge
creates correlated mistakes" is exactly what happened: a fabricated Reanimated
compatibility window lived in `knowledge.json`, and from there reached the
migration reference, a guard's explanatory text, *and* a test asserting it. Four
sites, one root — and the redundancy made it look corroborated.

**Closed:**

- Version claims are checked against a vendored registry snapshot. A version
  that was never published fails the build.
- Quoted `peerDependencies` windows must match what the package declares.
- Deprecation claims are checked against what libraries actually mark. We had
  called the entire `runOn*` family deprecated; only `makeShareableCloneRecursive`
  is.

**Open:**

- Per-agent verification exists now (`agentsVerified` in `knowledge.json`) but
  **10 of 13** agents carrying version-specific claims have never been verified
  individually. The mechanism is there; the reviewing is not.
- Item 13 — specialist references disagreeing with shared context — has no check
  at all.

---

## E — Invented React Native APIs

*Community items 9, 10.*

The most damaging class, and the one that surfaced publicly. `accessibilityInvalid`
shipped in v1.4.0. It is not a React Native prop and never has been. 734 tests
passed, because every guard checked *claims* and none checked *identifiers*.

**Closed for the namespaces with complete ground truth.** Vendored snapshots now
reject invented props, roles, `accessibilityState` keys, `aria-*` aliases,
unpublished versions, and imports of exports that do not exist — each
mutation-checked. The validator found a second invention on its first run
(`aria-invalid`) that the original reporter had not spotted.

**Explicitly not closed:** coverage is **3 of 20** referenced libraries. A
library absent from the snapshot is *unverified*, not verified-absent, and the
guard skips it rather than guessing — a guard that fails on incomplete evidence
gets disabled, and then protects nothing. `npm run api:refresh` extends coverage.

Item 9 (accessibility being especially platform-divergent) is addressed in
content: roles carry no `@platform` annotation upstream, ten role values are
typed but undocumented Android constructs, and Flow's union ends `| string` so a
role typo type-checks in Flow but not TypeScript.

---

## F — Evidence quality, and effort proportional to the question

*Community items 14, 15, 17, 18.*

Item 14 is the one to build: a finding should carry how it was known — read from
the repository, documented API, inference, heuristic. `shared/` already
*instructs* agents to say when they are unsure. An instruction is not a
mechanism, and instructions are exactly what failed for `accessibilityInvalid`.

This should follow cluster E rather than precede it: "documented API" only means
something once there is a snapshot to cite. It also makes items 8 and 11 partly
self-limiting, because a claim that must name its source is harder to fabricate.

**Item 15 needs restating.** It is framed as a risk — using an LLM where
calculation suffices — but that is already a design principle here: `rn-size` is
deterministic, no model call, free on every pull request. The productive version
of the item is its second half: *which other things are mechanically checkable
and currently are not?* That question has produced four answers so far — prop
existence, published versions, library exports, false deprecation claims — all
now deterministic checks that were previously nobody's job.

---

## Not raised, and worth adding

- **How would we know an agent got worse?** The eval suite is the product's own
  quality signal and no item covers regression in it.
- **Advice that contradicts the user's own lockfile.** Subtly different from item
  8: not "guidance for the wrong React Native version" but "guidance that
  disagrees with what is actually installed".
