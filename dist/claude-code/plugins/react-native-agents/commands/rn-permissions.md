---
description: Use for runtime permission handling in React Native — camera, location, photos, microphone, notifications, contacts and Bluetooth. Covers the iOS/Android semantic differences, purpose strings and manifest declarations, rationale and denial flows, "never ask again", settings deep links, and the partial-grant states that code written for one platform silently mishandles.
argument-hint: "[path or question]"
---


Use the **rn-permissions** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
