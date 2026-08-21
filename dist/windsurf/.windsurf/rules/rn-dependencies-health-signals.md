---
trigger: manual
description: "RN Dependencies: Reading Maintenance Honestly"
---

# Reading Maintenance Honestly

The common failure is treating age as decay. A small, complete library can go a year without a
release because there is nothing left to do. A large framework going three months without a commit
is a different signal entirely.

**Distinguish stable from stalled**: look at whether issues are being *answered*, not at whether
releases are being *cut*.

## What to actually look at

| Signal | Reading |
|---|---|
| Last publish | Useful, and least meaningful in isolation |
| Issue response time | The best single indicator of an active maintainer |
| Open issues naming your RN version | Others hit it first; read those threads |
| An open New Arch PR, unmerged | Bandwidth problem, not a capability problem |
| Number of maintainers | A single-maintainer library is a bus-factor decision |
| Weekly downloads | How many others will notice and fix a break |
| Whether a maintained fork exists | Frequently the real answer |
| Corporate or foundation backing | More predictable, not automatically better |

## Commands

```bash
npm view <pkg> time.modified version maintainers
npm view <pkg> dist-tags
npm view <pkg> peerDependencies
npm view <pkg> deprecated          # explicit deprecation notice, if any

# What it actually pulls in
npm ls <pkg> --all 2>/dev/null | head -30
```

For anything native, the React Native directory records New Architecture support per package —
check it rather than inferring from the README, which is frequently older than the code.

## Deprecation is a hard signal

An explicitly deprecated package is not a judgement call. `npm view <pkg> deprecated` returning a
message means the author has told you to stop. These are worth surfacing immediately and worth
treating as more urgent than they feel, because the deprecation notice usually predates the point
where things actually break by a long way.

## What stars do not tell you

Stars measure attention at some past moment. They do not decay when a project is abandoned, they
accumulate from blog posts and conference talks, and they are the most-cited and least-useful
number in this whole assessment. A 30k-star library with no commits in two years is a worse bet
than a 400-star one whose maintainer answers issues in a day.

## Framing the finding

"Unmaintained" is a conclusion, and it should be supported by which signal produced it. Say *"last
published 2023, 40 open issues with no maintainer response since 2024, and the New Architecture PR
has been open 14 months"* rather than *"this looks abandoned"*. The first is checkable and
actionable; the second is an impression.

And if the evidence is thin, say that. A library you could not find much about is not the same as a
library you found evidence against.
