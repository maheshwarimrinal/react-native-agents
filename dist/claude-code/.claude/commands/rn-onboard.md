---
description: Use when orienting in an unfamiliar React Native codebase — mapping the architecture, finding where things actually live, inferring the team's conventions, identifying the landmines and the load-bearing code, and working out what to read first and how to make a safe first change. For joining a project, inheriting a client app, or auditing before quoting work.
argument-hint: "[path or question]"
---


Use the **rn-onboard** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
