# Inferring Conventions

A codebase has rules. Most are unwritten, and breaking them in a first PR is how a newcomer looks
careless when they were only uninformed.

## Read what is enforced first

```bash
cat .eslintrc* eslint.config.* 2>/dev/null | head -40
cat .prettierrc* 2>/dev/null
cat tsconfig.json
ls .husky/ .github/workflows/ 2>/dev/null
```

`tsconfig.json` matters most. `strict: true` with `noUncheckedIndexedAccess` is a different codebase
from one with `strict: false` — it changes what code is even possible to write, and how much you can
trust the types you read.

CI configuration tells you what is genuinely enforced as opposed to aspirational. A lint rule that
does not run in CI is a suggestion.

## Then infer from frequency

For anything not enforced, the convention is whatever the codebase does most.

```bash
# Component style
rg -c "^export function [A-Z]" --glob "**/*.tsx"
rg -c "^export const [A-Z]\w* = \(" --glob "**/*.tsx"

# Styling approach
rg -c "StyleSheet.create" --glob "**/*.tsx"
rg -c "styled\.|tw\`|className=" --glob "**/*.tsx"

# Imports: aliases or relative
rg -c "from '@/" --glob "**/*.{ts,tsx}"
rg -c "from '\.\./\.\./" --glob "**/*.{ts,tsx}"

# File naming
fd -e tsx . src | xargs -n1 basename | rg -c '^[A-Z]'
```

Count, do not sample. Three files using one pattern proves nothing; sixty do.

## Look at recent commits, not old ones

Conventions drift. What the codebase did two years ago may be what they are moving away from.

```bash
git log --oneline -20 --name-only | rg '\.tsx?$' | sort -u | head -20
```

Read a few files that changed recently. Those reflect current practice, and following an outdated
pattern is a common newcomer mistake that looks like carelessness.

## Commit and PR conventions

```bash
git log --oneline -40
cat .github/pull_request_template.md 2>/dev/null
cat CONTRIBUTING.md 2>/dev/null
```

Conventional commits, ticket prefixes, or free text — match whatever is there. It is a small thing
that signals attention.

## Error handling is the most telling convention

How a team handles failure varies more than anything else and is rarely documented.

```bash
rg -n "catch\s*\(" --glob "**/*.{ts,tsx}" -A3 | head -40
```

Look for whether errors are logged, reported to a crash service, shown to the user, or swallowed;
whether there is a shared error type; and whether the network layer normalises failures. Whatever
the pattern is, follow it — an inconsistent error path is worse than a mediocre consistent one.

## When conventions conflict

Sometimes there is no convention, only sediment: three approaches from three eras. Do not pick your
favourite. Ask which is intended, and if nobody knows, follow the one in the most recently changed
code and say what you did.

## Match rather than improve, at first

The urge to fix conventions is strongest when you understand the codebase least. A first PR that
also changes the styling approach is a first PR that will not be merged.

Note what you would change, follow what is there, and raise it separately once you have earned the
context to argue for it.
