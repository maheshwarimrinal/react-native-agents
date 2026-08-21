# Before You Submit

Most rejections are preventable, and the preventable ones cluster tightly.

## The account

The single most common avoidable rejection.

- A **permanent** review account that does not expire
- Credentials in the review notes, correct and tested **this** submission
- Reaches the entire app — every feature, every tier
- No SMS or email verification the reviewer cannot complete
- If a code is unavoidable, a fixed test code, and say so in the notes

Sign in with the credentials yourself, from a fresh install, immediately before submitting.

## Test what a reviewer tests

Reviewers behave unlike your team, and this is where the surprising rejections come from:

- **Fresh install, no account** — does the app work before signing in?
- **Deny every permission** — does it degrade, or break?
- **Airplane mode** — is there an error state, or a spinner forever?
- **Empty states** — a new account has no data; has anyone seen those screens?
- **Slow or restricted network**
- **An older device**, not the newest simulator
- **Every payment path**, in the sandbox

The most common reviewer-only crash is a cold start with no data and a denied permission — three
conditions that rarely coincide in development.

## Metadata

- Screenshots from the **current** build, at the required sizes
- No other platform mentioned anywhere
- No "beta", "test", "demo", or "coming soon"
- No placeholder or lorem ipsum
- Age rating answered honestly — under-rating is a serious problem
- Support URL and privacy policy URL both load

## Requirements that block

- **In-app account deletion**, if accounts can be created (and a web route for Play)
- **Purpose strings** for every permission, specific rather than generic
- **Privacy declarations** matching reality, on both stores
- **Target API level** meeting Play's current requirement
- **Sign in with Apple**, where third-party sign-in is offered and the rule applies

## Build hygiene

- Version and build number incremented
- Release configuration, not debug
- No development URLs, test flags, or debug menus reachable
- Crash reporting working and **verified** — hand to `rn-observability`
- No console logging of anything sensitive

## Timing

Reviews take variable time and are slower around major OS releases and holidays. Submit with room,
and not on a Friday before a launch.

For anything risky — a first submission, a new payment flow, a permission you have not used before —
submit early enough to absorb one rejection cycle. Assuming approval on the first attempt is what
turns a routine rejection into a missed launch date.

## Keep a record

What you declared, what you answered on the rating questionnaire, and which credentials you supplied.
At the next release you will not remember, and inconsistency between submissions is itself something
reviewers notice.
