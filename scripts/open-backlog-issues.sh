#!/usr/bin/env bash
# Open the six community-backlog issues.
#
# Run once, from the repository root, with the GitHub CLI authenticated.
# Each issue links back to docs/community-backlog.md rather than restating it,
# so there is one copy of the analysis to keep current.
set -euo pipefail

REPO="maheshwarimrinal/react-native-agents"
DOC="https://github.com/${REPO}/blob/master/docs/community-backlog.md"

gh label create "community-feedback" --repo "$REPO" --color 0E8A16 \
  --description "Raised by the React Native community after the public post" 2>/dev/null || true
gh label create "correctness" --repo "$REPO" --color B60205 \
  --description "The agents can be confidently wrong" 2>/dev/null || true

gh issue create --repo "$REPO" \
  --label "community-feedback,correctness" \
  --title "Tests can validate the implementation instead of the intended behaviour" \
  --body "Community backlog items 1, 2, 3, 19 — see [the analysis](${DOC}#a--a-test-can-validate-the-implementation-instead-of-the-intended-behaviour).

When the agent that writes the code also decides what correct means, the loop closes:
implementation → read implementation → tests derived from it → green. Item 19 is the
sharpest form: if the implementer can also edit the specification, the failure
reappears one level up.

**Item 3 already has a proven answer we do not ship.** Mutation testing is this
repository's internal standard — 46 mutations in one week of review, **four survived**,
including two tests written specifically to prove a fix that passed with the fix
reverted. That is item 3's exact failure caught by item 3's exact technique, in this
repo, with no product surface.

Constraint from items 17/18: opt-in and scoped. A correctness pass that doubles CI time
gets switched off and then protects nothing.

The full closed-loop problem needs a source of truth the implementer cannot write to —
an architecture change, not a prompt change. Mutation testing is a genuine partial
mitigation and should ship first."

gh issue create --repo "$REPO" \
  --label "community-feedback,correctness" \
  --title "Cross-domain problems are missed: rn-push does not route on push APIs" \
  --body "Community backlog items 4, 5, 20 — see [the analysis](${DOC}#b--real-problems-span-specialists).

**Reproducer.** A diff containing a deep link, a permission check and
\`messaging().onNotificationOpenedApp\` routes 5 of 25 agents: permissions, navigation,
security, code-quality, accessibility. It does **not** route \`rn-push\`.

\`rn-push\` has 14 triggers and none match \`messaging()\` or \`onNotificationOpenedApp\`;
the closest is the two-word phrase \"firebase messaging\". The community's own example —
notifications interacting with navigation and permissions — fails today.

Three parts:

- Routing recall — mechanical, needs recall tests so it cannot silently regress
- Conflict surfacing — detect two specialists touching the same lines with incompatible
  advice. Surfacing disagreement is achievable; resolving it is not, and pretending
  otherwise is worse than showing both
- Flow-level reasoning (item 20) — deferred"

gh issue create --repo "$REPO" \
  --label "community-feedback" \
  --title "Routing breadth: measured at 5/25, the defect is under-routing not over-routing" \
  --body "Community backlog item 6 — see [the analysis](${DOC}#c--routing-breadth).

Measured rather than assumed: a cross-domain diff pulls **5 of 25** agents, not 20.
Routing breadth is not currently the cost problem, and narrowing it further would make
the real defect worse.

Filed to record the measurement so the conclusion is not re-derived later. The actual
problem is under-routing, tracked separately."

gh issue create --repo "$REPO" \
  --label "community-feedback,correctness" \
  --title "Knowledge drift: 10 of 13 version-carrying agents have never been verified individually" \
  --body "Community backlog items 7, 8, 11, 12, 13, 16 — see [the analysis](${DOC}#d--knowledge-drifts-at-different-rates-in-different-places).

Item 12 is the mechanism behind the worst defect found so far: a fabricated Reanimated
compatibility window lived in \`knowledge.json\` and from there reached the migration
reference, a guard's explanatory text, **and** a test asserting it. Four sites, one root,
and the redundancy made it look corroborated.

**Closed:** version claims checked against a vendored registry snapshot; quoted
\`peerDependencies\` windows must match what the package declares; deprecation claims
checked against what libraries actually mark.

**Open:** \`agentsVerified\` now exists in \`knowledge.json\`, but **10 of 13** agents
carrying version-specific claims have never been verified individually. The mechanism
is there; the reviewing is not. Item 13 — specialist references disagreeing with shared
context — has no check at all."

gh issue create --repo "$REPO" \
  --label "community-feedback,correctness" \
  --title "Invented APIs: extend identifier guards beyond 3 of 20 libraries" \
  --body "Community backlog items 9, 10 — see [the analysis](${DOC}#e--invented-react-native-apis).

\`accessibilityInvalid\` shipped in v1.4.0. It is not a React Native prop and never has
been. 734 tests passed, because every guard checked *claims* and none checked
*identifiers*. The validator built in response found a second invention on its first run
(\`aria-invalid\`) that the original report had not spotted.

**Closed for namespaces with complete ground truth** — invented props, roles,
\`accessibilityState\` keys, \`aria-*\` aliases, unpublished versions and non-existent
exports are all rejected, each mutation-checked.

**Open:** coverage is **3 of 20** referenced libraries. A library absent from the
snapshot is *unverified*, not verified-absent, and the guard skips it rather than
guessing — a guard that fails on incomplete evidence gets disabled and then protects
nothing.

\`npm run api:refresh\` fetches ground truth and reports verified / missing /
could-not-check per library. Extending coverage is running it and committing the result."

gh issue create --repo "$REPO" \
  --label "community-feedback" \
  --title "Findings should carry their evidence class" \
  --body "Community backlog items 14, 15, 17, 18 — see [the analysis](${DOC}#f--evidence-quality-and-effort-proportional-to-the-question).

A finding should say how it was known: read from the repository, documented API,
inference, or heuristic. \`shared/\` already *instructs* agents to say when they are
unsure — an instruction, not a mechanism, and instructions are exactly what failed for
\`accessibilityInvalid\`.

Should follow the identifier guards rather than precede them: \"documented API\" only
means something once there is a snapshot to cite. It also makes items 8 and 11 partly
self-limiting, because a claim that must name its source is harder to fabricate.

**Item 15 restated.** It is framed as a risk — using an LLM where calculation suffices —
but that is already a design principle here: \`rn-size\` is deterministic, no model call,
free on every PR. The productive version is its second half: which *other* things are
mechanically checkable and currently are not? That question has produced four answers so
far, all now deterministic checks that were previously nobody's job."

echo
echo "Six issues opened. docs/community-backlog.md holds the analysis they link to."
