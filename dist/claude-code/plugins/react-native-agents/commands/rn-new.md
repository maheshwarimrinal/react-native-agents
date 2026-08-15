---
description: Use when writing new React Native code — screens, components, forms, lists, navigation, data fetching. Produces code that already handles safe areas, accessibility, loading/empty/error states, keyboard, dark mode, and stable list callbacks, so review has nothing to catch.
argument-hint: "[path or question]"
---


Use the **rn-build** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
