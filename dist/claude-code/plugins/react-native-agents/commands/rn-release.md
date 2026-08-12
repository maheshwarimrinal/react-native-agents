---
description: Use for React Native builds and releases — EAS Build and Submit, Fastlane, code signing, versioning, OTA updates with expo-updates or CodePush, App Store and Play Store submission, staged rollout, monitoring, and rollback.
argument-hint: "[path or question]"
---


Use the **rn-release** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
