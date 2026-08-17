---
trigger: manual
description: "RN Onboard: Making the First Change"
---

# Making the First Change

## Prove the environment before you change anything

```bash
npm install                # or yarn / pnpm — match the lockfile present
cd ios && bundle exec pod install && cd ..

npm test
npx tsc --noEmit
npm run lint

npx react-native run-ios
npx react-native run-android
```

Both platforms, before touching code. If something is broken, you want to know it was broken before
you arrived — otherwise your first day is spent debugging someone else's problem while assuming it
is yours.

Record what failed. A test suite that was already failing is important context and is very often
nobody's stated knowledge.

## Choose a first change that touches the seams

The best first task is small but crosses layers — a label change is too shallow to teach you
anything. Something like adding a field to an existing form takes you through the screen, the
validation, the state, the API call, and the error path, which is the map you actually need.

Deliberately avoid, at first: anything in the payment flow, anything in auth, anything native, and
anything in the most-changed files.

## Follow the existing pattern exactly

Find the closest analogous feature and copy its shape — same file layout, same naming, same error
handling, same test style.

Resist improving while you are still learning. What looks like a redundant wrapper is often working
around something you have not met yet.

## Verify on both platforms

A React Native change is not done until it has run on both. This is the most common newcomer
omission, and `rn-platform-parity` exists because of how often it bites.

Check the states that are easy to skip: empty, loading, error, offline, and with permissions denied.

## Ask early and specifically

A vague question gets a vague answer. A specific one gets you unblocked and demonstrates you did the
work:

> *"I can see `useAuth` reads the token from SecureStore, but `apiClient` also has a token
> interceptor reading from the Zustand store. Which is authoritative — and is the store copy meant
> to be a cache?"*

That question shows you traced it and names the exact ambiguity. Half an hour of trying, then ask.

## Write down what confused you

Your confusion is a time-limited asset. In three weeks you will have internalised the odd parts and
be unable to see them.

Keep a running note as you go, and turn it into documentation or a README improvement before it
fades. It is often the most valuable thing a newcomer contributes in their first month, and the only
window in which they can.

## Do not rewrite

The urge to rewrite peaks exactly when understanding is lowest. Code that looks wrong is frequently
load-bearing for a reason nobody wrote down — a device-specific bug, a backend quirk, a race that
only appears in production.

If something genuinely should change, you will still think so in a month, and you will be able to
argue for it with evidence instead of taste.
