---
trigger: manual
description: "RN Store Submission: Reading a Rejection"
---

# Reading a Rejection

## Separate observation from classification

A notice has two parts and only one is evidence.

> *"We were unable to complete the review of your app because we could not sign in. Guideline 2.1 —
> Information Needed."*

**Observation**: they could not sign in. **Classification**: 2.1. The fix addresses the observation.
Reading the guideline text will not tell you whether the demo account expired, whether it needed a
verification code you did not supply, or whether sign-in requires a network your reviewer's device
could not reach.

Screenshots attached to a rejection are the most valuable part and are routinely skimmed. They show
the exact screen, and sometimes the device and OS version, which is often the whole answer.

## Which artefact is at fault

Getting this wrong costs a full cycle.

| Signal in the notice | Type | Response |
|---|---|---|
| A crash, a broken flow, a missing feature | Binary | New build |
| Description, screenshots, keywords, age rating | Metadata | Edit in App Store Connect, reply — **no build** |
| Privacy labels, Data Safety | Declaration | Update the declaration |
| "Information Needed" | Usually neither | Reply with the information |

Uploading a new build for a metadata rejection resets you to the back of the queue for no reason.

## Reproduce the reviewer's conditions

Reviewers are not using your development environment, and the difference is usually the bug:

- **Fresh install**, no existing data, no logged-in session
- **A real device**, often not the newest
- **Restricted or slow networks** — reviews happen behind corporate networks
- **Permissions denied**, because they test that path deliberately
- **Regions and locales** you have not tried

A crash they hit and you cannot is most often a cold start, an empty state, or a denied permission.
All three are states developers rarely see.

## Replying well

The reply is read by a person and it is part of the submission.

**Do**: address the specific observation, say what you changed, give exact reproduction steps if you
believe they saw something else, and include working credentials in the notes.

**Do not**: argue the guideline, cite competitors, or explain your business model. None of it moves
a reviewer.

```
We've addressed the sign-in issue. The demo account had expired.

Working credentials (valid until 2027-01-01):
  email: review@example.com
  password: ReviewAccess2026
  Verification code: any 6 digits will be accepted for this account.

Steps: launch → Sign in → enter the above → the full app is accessible.
```

If a code is required, say how the reviewer gets one. An SMS code they cannot receive is a
guaranteed second rejection and a common one.

## When to appeal

Appeals exist and they work — when the reviewer made a **factual** error: they missed a feature,
tested an old build, or misread what the app does.

An appeal is not for disagreeing with a policy. State the fact, show where to find it, keep it
short.

If a rejection contradicts a previous approval, say so with the specific prior version. Reviews do
vary, and that is a legitimate thing to raise.

## Track your history

Keep a record of every rejection, its trigger, and the fix. Two reasons: teams hit the same
rejection more than once across releases, and a pattern across several rejections sometimes reveals
one underlying cause rather than several.
