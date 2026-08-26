# Running the evals against a local model

No API key, no spend. The runner treats an `OPENAI_BASE_URL` pointing at
localhost as free and skips budgeting entirely, so a local run costs nothing and
cannot be stopped by `budget-usd`.

## Setup, once

```bash
brew install ollama
ollama serve                      # leave running in its own tab
ollama pull qwen2.5-coder:14b      # or llama3.1:8b, deepseek-coder-v2:16b
```

No `OPENAI_API_KEY` is needed. The runner skips the key check entirely when the
base URL points at localhost, and treats the model as free — so a local run
cannot be stopped by `budget-usd` and reports `~$0.000 spent`.

If your shell says `zsh: command not found: node`, Node is not on this shell's
PATH. Either open a fresh tab after installing, or use the absolute path:

```bash
which node || ls /opt/homebrew/bin/node /usr/local/bin/node
```

## Know what you are committing to

The full suite is **49 cases, ~542,000 prompt tokens**. Each case sends the
agent's whole playbook plus its reference library, which is the point — it is
measuring the real prompt — but it is not a quick check:

| Subset | Cases | Prompt tokens | 14B, prompt processing alone |
|---|---:|---:|---:|
| everything | 49 | 542,000 | ~8 hours |
| `--clean` | 15 | 179,000 | ~2¾ hours |
| `--agent rn-payments,rn-background,rn-monorepo` | 6 | 62,000 | ~1 hour |

A 7B is roughly half those times; a 32B, more than double.

Generation is on top of that. **Run a subset unless you are leaving it
overnight.**

## Start here: the clean cases

Correct code that must produce no findings. Fifteen cases, the cheapest useful
signal, and the one result that is never ambiguous — a model inventing problems
in correct code is wrong regardless of how small the model is.

```bash
OPENAI_BASE_URL=http://localhost:11434/v1 \
node evals/run.mjs --provider openai --model qwen2.5-coder:14b --clean --json
```

## Then: whatever the change touched

```bash
# The three agents added in v1.3.0
OPENAI_BASE_URL=http://localhost:11434/v1 \
node evals/run.mjs --provider openai --model qwen2.5-coder:14b \
  --agent rn-payments,rn-background,rn-monorepo --json

# Individual cases
node evals/run.mjs ... --case stale-closure,jwt-in-asyncstorage
```

## Watching a long run

macOS has no `watch(1)`. The runner writes `evals/results.json` after every
case, and a viewer ships with it:

```bash
node evals/watch.mjs --follow      # second terminal tab
```

Interrupted runs resume, and restored results still count toward the verdict:

```bash
node evals/run.mjs ... --resume
```

## Reading the result on a small model

**The exit code is a release gate, not an exploration tool.** A weak model will
fail it, and that is correct behaviour rather than a problem to work around.
What matters locally is the report, in this order:

1. **Forbidden-advice violations** — the model gave advice a case explicitly
   bans. Unambiguous. Act on these.
2. **Clean-case failures** — findings invented in correct code. Also
   unambiguous.
3. **Missed expectations** — ambiguous. A 7B model misses things a frontier
   model catches, so read these as "check whether the finding is genuinely
   absent from the response", not as a defect.

Lower the floor so the third category does not drown the first two:

```bash
node evals/run.mjs ... --min-pass-rate 0.3
```

One thing a small model will hit: a response that omits `severity` fails the
parse rather than being assigned a default, so the case errors. That is
deliberate — guessing a severity puts an unranked finding into a
severity-gated pipeline — but it means some cases will error on a weak model,
and **an errored case fails the run at any `--min-pass-rate`**. Read the report.

## What a local run does and does not tell you

It does tell you whether the prompts elicit the right *shape* of answer, and it
catches forbidden advice and invented findings.

It does not tell you how the agents perform in production, because the shipped
default is a frontier model and the gap is large. Treat a local pass as "nothing
is obviously broken", not as the answer-quality evidence a release wants.
