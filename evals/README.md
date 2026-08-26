# Agent Evaluations

The test suites in `scripts/test.mjs` and `action/test.mjs` verify that the repository is
well-formed and that the pipeline works. Neither says anything about whether the agents give
**good React Native advice** — an agent could pass every structural test while confidently
recommending something wrong.

That is what these evals are for.

## What an eval is

A realistic code fixture, plus an explicit statement of what a competent React Native engineer
should say about it:

```
evals/<agent>/<case>/
├── case.json      what to expect
└── input.tsx      the code under review (or .ts, .json, .xml …)
```

`case.json`:

```jsonc
{
  "agent": "rn-performance",
  "title": "Unstable renderItem in a FlatList",
  "context": { "reactNative": "0.87", "expo": "57" },

  // At least one of each group must appear in the output.
  "expect": [
    { "name": "identifies unstable renderItem", "any": ["renderitem", "inline arrow"] },
    { "name": "recommends measuring", "any": ["profiler", "measure", "devtools"] }
  ],

  // Severity the finding should carry, if the agent emits structured findings.
  "expectSeverity": ["P1", "P2"],

  // Phrases that indicate a wrong or premature answer. Any hit fails the case.
  "forbid": [
    { "name": "jumps to FlashList before measuring", "all": ["flashlist"], "unlessPattern": "measur\\w+|profil\\w+" },
    { "name": "invents a benchmark", "pattern": "\\b\\d+%? (faster|fewer renders|wasted)" }
  ]
}
```

## Design decisions worth knowing

**Assertions are keyword-based, not exact-match.** LLM output is non-deterministic; asserting on
exact wording would produce a suite that fails constantly and gets ignored. We assert that the
*substance* is present.

**`forbid` matters as much as `expect`.** The failure mode for these agents is not silence, it's
confident bad advice — recommending FlashList before profiling, claiming AsyncStorage is
encrypted, inventing a percentage. Those are the regressions worth catching.

**Evals cost money and are non-deterministic**, so they do not run on every PR. They run on
demand and on a schedule. A failing eval is a signal to read the output, not necessarily a bug.

## Running them

```bash
# No API key needed — checks fixtures and case definitions are well-formed.
node evals/run.mjs --validate

# Real run against a provider (costs money)
ANTHROPIC_API_KEY=sk-... node evals/run.mjs
node evals/run.mjs --agent rn-security
node evals/run.mjs --case security/jwt-in-asyncstorage --verbose

# Continue an interrupted run. Restored results still count toward the gate.
node evals/run.mjs --resume

# Only the cases a change touched — the full suite is ~542k prompt tokens.
node evals/run.mjs --agent rn-payments,rn-background,rn-monorepo
node evals/run.mjs --clean          # correct-code cases only, the cheapest signal

# Against a deliberately weak or local model, lower the floor rather than
# ignoring the result. Free, no API key — see LOCAL-MODEL.md.
OPENAI_BASE_URL=http://localhost:11434/v1 \
  node evals/run.mjs --provider openai --model qwen2.5-coder:7b --min-pass-rate 0.3
```

## Writing a `forbid` exception

A `forbid` rule sometimes needs an escape hatch: "don't recommend X" should not
fire on "**never** do X". Two mechanisms exist, and the difference matters.

**`unlessPattern` — explicit, and what to use for new rules.** A regex naming
the phrasings that are acceptable, matched against the clause containing the
match:

```json
{
  "name": "recommends validating the receipt on the device",
  "pattern": "validat\\w*\\s+(the\\s+)?receipt\\s+(on|in)\\s+the\\s+(device|client|app)",
  "unlessPattern": "\\b(do not|don't|never)\\s+\\w*\\s*validat|validat\\w*[^.;,]{0,50}\\b(is|are)\\s+(insufficient|not enough)"
}
```

**`unless` — removed.** It took a list of keywords and excused the violation if
any appeared nearby. That asks "does a negation-ish word appear?", which is a
semantic question keywords cannot answer. Five bypasses were reported against
it, each after narrowing the scope:

| Scope | Bypass that survived it |
|---|---|
| Whole response | `not` three sentences away excused anything |
| Sentence | "Validate on the device, which is **not** hard to do." |
| Sentence, whole-word | "Validate on the device; this is **not** optional." |
| Clause, whole-word | "Validate on the device even though it is **insufficient** … anyway." |
| Clause + concessive check | "Use useRef as the fix … and store its **id** there." |

The last one needed no contradiction at all — just a legitimate word in an
unrelated role. That is the point at which narrowing stops being worth it: the
mechanism was asking the wrong question. All 98 rules now use `unlessPattern`,
and `--validate` **fails** if `unless` reappears.

Two rules still apply on top of `unlessPattern`, because an explicit pattern is
only as careful as the regex someone wrote:

- **Concessive markers void the exception.** *even though, although, despite,
  regardless, anyway* and friends mean the objection is being conceded, not
  applied. A closed list of grammatical constructions, not another guess.
- **A comma-joined preceding clause counts.** "Only after confirming the
  duplicate, remove `node_modules`" is a correct answer, and the qualifier is in
  its own clause. A preceding clause ending in a full stop does *not* count —
  allowing that would reopen the first bypass in the table.

## What makes the suite fail

The runner exits non-zero when any of these is true:

| Condition | Why it is fatal |
|---|---|
| An agent gave advice its case forbids | Unambiguous. Model capability does not excuse wrong advice. |
| A **clean** case failed | The model reported problems in correct code. Also unambiguous. |
| A case errored | The suite did not measure what it claims to. |
| Fewer than `--min-pass-rate` of **dirty** cases fully passed | Default `0.7`. |

Dirty failures gate on a *rate* rather than being fatal individually, because
missing a finding is genuinely ambiguous on a weaker model — it may be the
prompt, it may be the model. A suite that always fails is one nobody runs.

This gate used to have two holes worth knowing about, since they shaped it:
dirty failures did not reach the exit code at all unless *every* case in the
suite scored zero, and `--resume` judged only the cases run in that invocation,
so resuming a run with forty-eight failures and one new passing case exited
successfully.

## Adding a case

The most valuable cases come from real mistakes. When an agent gives bad advice, add the
fixture that produced it and the assertion that would have caught it — same principle as a
regression test.

Keep fixtures small and focused. A 400-line component tests everything and diagnoses nothing.
