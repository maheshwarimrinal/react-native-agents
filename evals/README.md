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
    { "name": "jumps to FlashList before measuring", "all": ["flashlist"], "unless": ["measure", "profil"] },
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
```

## Adding a case

The most valuable cases come from real mistakes. When an agent gives bad advice, add the
fixture that produced it and the assertion that would have caught it — same principle as a
regression test.

Keep fixtures small and focused. A 400-line component tests everything and diagnoses nothing.
