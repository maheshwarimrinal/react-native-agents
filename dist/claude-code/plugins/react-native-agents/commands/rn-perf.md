---
description: Use for React Native performance work — slow lists, janky animations, dropped frames, long startup/TTI, excessive re-renders, memory growth, and oversized bundles. Diagnoses with real profiling data before changing code.
argument-hint: "[path or question]"
---


Use the **rn-performance** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
