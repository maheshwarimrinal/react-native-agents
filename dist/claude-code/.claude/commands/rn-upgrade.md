---
description: Use for React Native and Expo version upgrades and New Architecture migration — planning an upgrade path, the RN/React/Expo/Gradle/Kotlin/Xcode version matrix, Fabric and TurboModule migration, the interop layer, Codegen specs, package scope moves, and breaking changes between versions. Specialises in the failures an upgrade introduces that do not appear until runtime.
argument-hint: "[path or question]"
---


Use the **rn-upgrade** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
