# Landmines

The most valuable output of orientation. Nobody tells a newcomer these, and they are discovered
painfully.

## Read `patches/` first

```bash
ls patches/ 2>/dev/null && cat patches/*.patch | head -60
```

Every patch is a thing that hurt someone enough to fork a dependency in place. It tells you a bug
they hit, a fix they could not get upstream, and a constraint on upgrading that library.

A patch with no comment and no linked issue is worse: nobody remembers why it exists, and removing
it is a gamble.

## Persisted state without versioning

```bash
rg -n "persist\(|AsyncStorage.setItem|MMKV" --glob "**/*.{ts,tsx}" -A5 | rg -B3 -v "version|migrate"
```

A persisted store with no version means the next shape change breaks **existing users only** — it
passes every test on a fresh install. This is one of the most common production-only bugs in React
Native and it is invisible in code review unless you look for its absence.

## Custom native modules

```bash
fd -e swift -e kt -e java -e mm ios android 2>/dev/null | rg -v Pods
```

Under-documented by default, and frequently written by someone no longer on the team. They are the
usual blocker for a React Native upgrade, and the cost of that is not visible until an upgrade is
attempted.

Check whether they use the old `RCTBridgeModule` API — those need rewriting against Codegen. Hand
the detail to `rn-native-modules` and `rn-upgrade`.

## Unmaintained dependencies

```bash
node -p "Object.keys(require('./package.json').dependencies).join('\n')" | while read -r p; do
  d=$(npm view "$p" time.modified 2>/dev/null | cut -c1-10)
  [ -n "$d" ] && echo "$d  $p"
done | sort | head -15
```

The oldest ones are the constraint on every future upgrade. Distinguish stalled from stable — a
small complete library may simply be finished. See `rn-dependencies`.

## Half-finished migrations

Two libraries doing the same job means code written both ways, and a newcomer cannot tell which
pattern to follow.

```bash
rg -c "from 'redux|from 'zustand|from 'jotai" --glob "**/*.{ts,tsx}" 2>/dev/null
rg -c "axios|fetch\(" --glob "**/*.{ts,tsx}" 2>/dev/null
rg -c "moment|date-fns|dayjs" --glob "**/*.{ts,tsx}" 2>/dev/null
```

Ask which direction the migration was going. If nobody knows, that is itself the finding.

## Tests that assert nothing

```bash
fd -e test.ts -e test.tsx -e spec.ts . | wc -l
rg -c "expect\(" --glob "**/*.{test,spec}.{ts,tsx}" 2>/dev/null | head
rg -l "it\.skip|describe\.skip|xit\(|test\.todo" --glob "**/*.{test,spec}.{ts,tsx}"
```

A high file count with few assertions, or a wall of skipped tests, means the safety net is
decorative. Run the suite before believing anything about it — a suite that has been failing for
months is common and nobody mentions it.

## Secrets in the repository

```bash
rg -n "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{12,}" --glob "**/*.{ts,tsx,js,json}" -i | head
git log --all --oneline -- '**/.env*' | head
```

Anything found here is a `rn-security` finding immediately. Note that a secret removed in a later
commit is still in history and still compromised.

## Commented-out code and `@ts-ignore` clusters

```bash
rg -c "@ts-ignore|@ts-expect-error|eslint-disable" --glob "**/*.{ts,tsx}" | sort -t: -k2 -rn | head
```

Not automatically bad, and a cluster in one file usually marks a place where the types and reality
disagree — which is where bugs concentrate.

## The bus factor

```bash
git shortlog -sn --all | head
git log --format='%an' --since='1 year ago' | sort -u | wc -l
```

If one person wrote the payment flow and left, that is the most important thing to say in an
orientation, and it will not appear in any documentation.
