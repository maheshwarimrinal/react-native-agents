---
description: Use when a React Native build, install, or dev server fails — Gradle errors, pod install failures, Metro "unable to resolve module", Xcode signing and archive errors, version conflicts after an upgrade or a merge, or "it works on my machine". Diagnoses from the actual error output.
argument-hint: "[path or question]"
---


Use the **rn-doctor** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
