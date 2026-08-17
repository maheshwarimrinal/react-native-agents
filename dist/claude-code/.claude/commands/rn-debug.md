---
description: "Use when a React Native app builds and runs but behaves wrong — a component re-rendering endlessly, state that will not update, a network call that silently fails, a layout that is right on one device and wrong on another, an animation that stutters, or a bug that only appears in release. Covers the post-Flipper tooling: React Native DevTools, the Hermes debugger, network and performance inspection."
argument-hint: "[path or question]"
---


Use the **rn-debug** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
