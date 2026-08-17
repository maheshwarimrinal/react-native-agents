---
trigger: manual
description: "RN Upgrade: Breaking Changes"
---

# Breaking Changes

The dangerous breaking changes are not the ones that fail the build. Those get fixed in an hour.
The ones that cost weeks compile cleanly and behave differently.

## The two categories

**Loud** — the build fails, an import cannot resolve, a type does not check. Annoying, bounded,
self-announcing.

**Silent** — it compiles, it runs, and something is different. A ref is null. An event no longer
fires. A style resolves differently. A promise that used to settle no longer does. Nothing in your
tooling points at the upgrade, so the bug is investigated as though it were new code.

Spend your attention on the second category. It is the whole reason a version bump needs a review.

## The silent ones worth checking every time

| Change | Symptom | Where to look |
|---|---|---|
| Fabric view flattening | `ref.current` is null; `measure()` returns zeroes | `useRef<View>` followed by a measurement |
| Interop-layer libraries | Concurrent features silently unavailable | Native deps without New Arch support |
| Package scope moves | `unable to resolve module` for a real dependency | Imports under old scopes |
| Style resolution changes | Layout shifts by a few points | Flex and text-alignment edge cases |
| Event ordering under JSI | Race conditions that were previously masked | Native modules called during mount |
| Default prop changes | Different behaviour with no code change | Components relying on unspecified defaults |
| Touch handling changes | A control stops responding in one place | Nested touchables, gesture handlers |

## Deprecation is a warning shot

Something deprecated in this version is removed in a later one. Fixing deprecations during the
upgrade you are already doing is far cheaper than fixing them during the next one, when they are
hard failures and you have less context.

```bash
# Capture the warnings this build produces, rather than scrolling past them
npx react-native start --reset-cache 2>&1 | rg -i "deprecat|will be removed|no longer"
cd android && ./gradlew assembleDebug 2>&1 | rg -i "deprecat|warning:" | sort -u
```

## Read the changelog for behaviour, not for features

Release notes emphasise what is new. What you need is what is *different*. Read specifically for:

- Anything described as "now", "no longer", "changed to", "by default"
- Removals, including of things you did not know you depended on
- Changes to defaults, which are the highest-risk category because no code of yours changes

## Your own code is not the only surface

The upgrade also changes what your **dependencies** are running on. A library that was correct
against the previous version may now be subtly wrong, and its issue tracker is often the fastest
place to discover that — someone else usually hits it first.

## Version boundaries this repository has verified

See `knowledge.json` for the authoritative record of which versions have actually been reviewed.
Three boundaries matter structurally:

- **0.76** — New Architecture became the default.
- **0.82** — the legacy bridge was removed.
- **0.84** — Hermes V1 became the default.

When a question concerns a version outside the verified range, say so rather than extrapolating.
The changelog is checkable; your memory of it is not.
