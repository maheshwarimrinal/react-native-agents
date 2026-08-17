---
trigger: manual
description: "RN Dependencies: Alternatives and Replacements"
---

# Alternatives and Replacements

## Check core first

A recurring category of dependency question has the answer "you no longer need a library for that".
Platform APIs and framework surfaces have expanded, and a package added three years ago for a gap
may be filling a gap that has since closed.

Before recommending any library, check whether React Native core, the Expo SDK, or a dependency you
already carry covers it. This is the highest-value check in the whole evaluation because it removes
a commitment rather than choosing between commitments.

## Reasons to replace, in order of strength

1. **Explicitly deprecated by its author.** Not a judgement call.
2. **Blocks a React Native upgrade** and is unmaintained. This forces the timing.
3. **No New Architecture support**, with no PR and no responsive maintainer.
4. **Superseded by something in core**, so the replacement removes a dependency rather than swapping
   one for another.
5. **Duplicates another dependency you already have.** Two libraries doing the same job is
   avoidable weight.
6. **Unmaintained and load-bearing.** The combination is what matters — unmaintained and trivial is
   fine.

## Reasons that are not good enough on their own

- It has not been updated recently, and it works, and it does something small and complete.
- A newer library is more popular.
- The API is not to current taste.
- A blog post said so.

Churn has a cost: a migration is engineering time, a fresh set of bugs, and a period where the team
knows the new thing less well than the old. "Working and boring" is a legitimate state.

## Doing a replacement safely

1. **Contain the old one first.** If it is imported in 200 files, wrap it behind one module before
   you swap anything. This turns a risky refactor into two smaller safe ones.
2. **Run both briefly** where feasible, so behavioural differences surface before you commit.
3. **Migrate the data**, if it stores any. This is the step people forget, and it fails for users
   upgrading rather than installing fresh — which means it fails in production and not in testing.
4. **Remove the old dependency properly** — the package, its config, its native artefacts, and its
   patches.
5. **Rebuild native** if either side ships native code.

Step 3 deserves emphasis. A storage library swap that works perfectly on a clean install and
silently loses data for existing users is a common and severe outcome, and no amount of testing on
a fresh simulator will reveal it. Test the upgrade path specifically, from a build of the previous
release.

## Framing the recommendation

Name what is being accepted, not only what is gained. *"Replacing X with Y removes the upgrade
blocker and drops a native dependency; the cost is a data migration and roughly a day of work
across the twelve files that import it directly."* That is a decision someone can make. "Y is
better" is not.
