---
description: Use for behaviour that differs between iOS and Android — keyboard avoidance, safe areas and notches, the Android hardware back button, permission semantics, text rendering and truncation, shadows and elevation, scroll physics, date and time pickers, and status bar handling. Catches the divergences that render correctly on the platform the developer is looking at.
argument-hint: "[path or question]"
---


Use the **rn-platform-parity** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
