---
trigger: manual
description: "RN Store Submission: Google Play"
---

# Google Play

Play's enforcement is more automated than Apple's, which changes the character of the problems:
fewer judgement calls, more hard requirements with deadlines, and rejections that arrive as policy
notices rather than as a reviewer's observation.

## Target API level deadlines

Play requires new and updated apps to target a recent API level, and the bar rises annually. Missing
it means **you cannot ship an update at all** — existing installs keep working, but you are frozen.

This is the one to check earliest, because raising a target API level in React Native can surface
library incompatibilities and behaviour changes that take real work. Discovering it a week before a
release is the bad case, and it is avoidable — the deadlines are published well in advance.

Check the current requirement against Play's live policy page rather than from memory; the number
changes every year.

## Data Safety

A form describing what you collect, what you share, and how it is protected. It must match what the
app actually does, **including what your SDKs do without being asked**.

The recurring failure: analytics, crash reporting, or attribution SDKs collect device identifiers
and diagnostics that nobody on the team declared, because nobody knew. An honest audit means proxying
a build and watching what actually leaves the device.

Declaring less than you collect is treated as a misrepresentation, not an oversight.

## Permissions

- **Declared permissions must be used.** An unused one is a policy problem and appears in your
  listing.
- **Sensitive permissions** — location in the background, SMS, call log, `QUERY_ALL_PACKAGES`,
  `MANAGE_EXTERNAL_STORAGE` — need justification, and some require a declaration form.
- **Check the merged manifest.** Libraries add permissions you did not write. This is the most
  common source of a permission you cannot explain.

```bash
rg -n "uses-permission" android/app/build/intermediates/merged_manifests/**/AndroidManifest.xml 2>/dev/null
```

## Account deletion

Like Apple, Play requires an in-app path to delete an account where accounts can be created, and
also a **web-accessible** deletion route. Both are needed, and the web one is the half teams miss.

## Foreground services

Android 14+ requires a declared type for each foreground service and a justification. A service
whose type does not match its actual behaviour is a rejection.

## Families policy

Apps targeting children have substantially stricter rules on ads, data collection, and third-party
SDKs — many common SDKs are not permitted. If the age rating suggests a child audience, this
applies whether or not you intended it, so the rating questionnaire deserves care.

## Testing tracks

Play requires a period of closed testing with real testers before some apps can go to production.
Plan for it: it is a calendar requirement rather than a technical one, and it cannot be shortened.

## Policy notices differ from rejections

A **rejection** blocks the release. A **policy notice** may give a deadline to fix an app already
live, and ignoring it escalates to removal. Notices are easy to miss because they arrive by email
rather than blocking anything — check the Policy status page in Play Console rather than relying on
inbox attention.
