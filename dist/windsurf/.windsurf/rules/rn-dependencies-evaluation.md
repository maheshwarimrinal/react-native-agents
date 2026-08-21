---
trigger: manual
description: "RN Dependencies: Evaluating a Dependency"
---

# Evaluating a Dependency

## Start by trying to not need it

The cheapest dependency is the one you do not add. Before evaluating candidates, check two things:

**Does core already do this?** React Native and Expo have absorbed a great deal of what libraries
used to provide. A question about a library is sometimes a question about an API that already
exists.

**Is this thirty lines?** Some things are genuinely small. A debounce, a formatter, a simple hook.
Writing it means you own it — which is a cost — but it also means no version constraints, no
transitive tree, no migration when it stops being maintained, and behaviour you can change when
your requirements shift.

The honest counterweight: do **not** write your own for anything involving dates, timezones,
currency, cryptography, or text layout. These are deceptively hard, and the library exists because
the naive implementation is wrong in ways you will not discover for a year.

## The five questions

Answer all five before recommending. An answer of "I don't know" is a finding.

1. **What breaks if this is unmaintained in two years?** The answer ranges from "we delete it" to
   "we cannot upgrade React Native".
2. **Does it ship native code?** See `native-cost.md`. This changes the category of decision.
3. **Is it New Architecture ready** — genuinely, or via the interop layer?
4. **How much of our code touches its API?** Directly proportional to replacement cost.
5. **What is the exit?** Name the alternative now, while you are not under pressure.

## Contain the surface

The difference between a dependency you can replace and one you cannot is usually not the library
— it is how you used it.

```ts
// A library reachable from one module is replaceable.
// src/lib/storage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export const storage = {
  get: (k: string) => AsyncStorage.getItem(k),
  set: (k: string, v: string) => AsyncStorage.setItem(k, v),
  remove: (k: string) => AsyncStorage.removeItem(k),
};
```

Now swapping the implementation touches one file. Import the library directly in 200 components and
the same swap is a refactor.

Apply this selectively. Wrapping everything is its own overhead — reserve it for dependencies that
are load-bearing, native, or that you have any doubt about.

## Comparing candidates

Compare on what they cost, not only what they offer:

| Axis | Question |
|---|---|
| Scope | Does it do one thing, or is it a framework? |
| Native | Does it require a rebuild to adopt or remove? |
| API surface | How much of your code will touch it? |
| Maintenance | See `health-signals.md` |
| Transitive tree | What comes with it? |
| Platform coverage | Does it support every platform you ship? |
| Licence | Acceptable for a commercial app? |

## When the answer is "either is fine"

Say so. Two comparable libraries that both work is a reversible decision, and deliberating it costs
more than picking wrong. Reserve real analysis for the irreversible ones — anything native,
anything that will touch a lot of code, anything in an area where migrating later is painful.
