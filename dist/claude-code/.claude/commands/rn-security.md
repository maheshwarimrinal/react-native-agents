---
description: Use for React Native security review — secret leakage, insecure storage, transport and TLS, auth and token handling, deep-link and WebView attack surface, platform hardening, dependency supply chain, and privacy compliance. Maps findings to OWASP MASVS.
argument-hint: "[path or question]"
---


Use the **rn-security** subagent to handle the following React Native request.

If no target is given, scope the review to the files changed on the current branch
(`git diff --name-only origin/HEAD...HEAD`); if that is empty, ask what to look at
rather than scanning the entire repository.

Request: $ARGUMENTS
