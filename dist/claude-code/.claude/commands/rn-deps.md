---
description: Use when choosing, auditing, or removing a React Native dependency — is a library New Architecture ready, is it maintained, what does it cost in bundle size and native build time, is there a lighter alternative or a core API that already does it, and what does adding it commit you to. Answers the "should we add this?" question before it becomes a migration problem.
argument-hint: "[path or question]"
---


Use the **rn-dependencies** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
