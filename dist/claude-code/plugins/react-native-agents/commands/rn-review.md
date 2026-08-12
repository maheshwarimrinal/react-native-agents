---
description: Use for React Native code review, refactoring, architecture decisions, TypeScript strictness, hook correctness, state management choices, and error handling. Reviews diffs and whole codebases against RN-specific idioms.
argument-hint: "[path or question]"
---


Use the **rn-code-quality** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
