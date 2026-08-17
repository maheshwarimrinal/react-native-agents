---
trigger: manual
description: "RN Upgrade: Verification"
---

# Verification

An upgrade is done when you have evidence, not when CI is green. CI proves it compiles. Users find
out whether it works.

## The order that catches things earliest

Each step is cheap relative to the one after it, so run them in this order and stop at the first
failure.

**1 — It builds, from clean, on both platforms.**

```bash
cd android && ./gradlew clean && ./gradlew assembleRelease && cd ..
cd ios && bundle exec pod install && xcodebuild -workspace *.xcworkspace -scheme <Scheme> -configuration Release clean build && cd ..
```

Release, not debug. Debug hides ProGuard/R8 problems, symbolication problems, and dead-code
elimination differences — and those are exactly what an upgrade disturbs.

**2 — It builds from a clean checkout.** In a fresh clone, not your working tree. This is what
catches the uncommitted file, the stale lockfile, and the local Gradle cache that was doing more
work than anyone realised.

**3 — It starts.** On a real device, release build, from a cold launch. The simulator does not
exercise the same native paths.

**4 — Behaviour, deliberately.** The compiler has now told you everything it can. What remains is
the silent category:

- Screens that **measure** — anything using `ref.current.measure()`, since Fabric flattening breaks
  these without erroring
- Every **custom native module**, exercised directly
- **Navigation and deep links**, including cold-start from a link
- **Push notification** receipt in background and foreground
- **Permission** flows, including the denied path
- Anything **animated or gesture-driven**
- The **offline** path

**5 — Crash reporting still works.** An upgrade is precisely when symbolication breaks — source map
paths change, ProGuard rules drift, dSYM upload steps rot. Trigger a test crash in a release build
and confirm it arrives symbolicated against the correct release. Hand this to `rn-observability`.

The failure mode here is genuinely nasty: you ship an upgrade, it introduces a crash, and the crash
reporting that would have told you is broken by the same upgrade.

## Compare against a baseline you actually recorded

"It feels slower" is not reportable and not refutable. If you want to make a claim about startup
time or bundle size after an upgrade, you need the number from **before**:

```bash
# Before the upgrade, on the current release build
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output /tmp/before.bundle && wc -c /tmp/before.bundle
```

Without a recorded baseline, do not state a regression as fact — say that it was not measured. An
invented comparison is worse than an acknowledged gap, because it sends someone optimising the
wrong thing.

## Ship it carefully

An upgrade is the highest-variance release a team does. It deserves a staged rollout and a rollback
plan more than a feature does. Gate on crash-free sessions and crash-free users **per release**,
compared against the previous release rather than an absolute threshold. See the release agent's
`monitoring-and-rollback.md`.

Watch for the first 24–48 hours specifically for native crashes, which is where upgrade regressions
concentrate and which JS-only error handling will not show you.
