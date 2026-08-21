---
description: Use when an app is being submitted to the App Store or Google Play, or has been rejected — reading a rejection notice and identifying the actual cause, privacy manifests and nutrition labels, Play Data Safety, App Tracking Transparency, permission purpose strings, target API deadlines, account deletion requirements, and preparing a resubmission that will not be rejected again.
argument-hint: "[path or question]"
---


Use the **rn-store-submission** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
