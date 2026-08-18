# Monitoring, Rollout Gates, and Rollback

You cannot recall a mobile binary. Everything here exists to make that survivable.

## Crash reporting

```ts
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  release: `${Application.nativeApplicationVersion}+${Application.nativeBuildVersion}`,
  dist: Application.nativeBuildVersion,
  environment: process.env.EXPO_PUBLIC_ENV,
  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,
  enableAutoSessionTracking: true,        // powers crash-free rate
  sendDefaultPii: false,
  beforeSend: (event) => scrubPii(event),
  integrations: [Sentry.reactNativeTracingIntegration()],
});
```

Non-negotiables:

- **`release` and `dist` set correctly**, or you cannot tell which build a crash came from. This
  is the most common misconfiguration and it makes everything downstream useless.
- **Source maps uploaded for every build**, automatically in the build pipeline. Minified stack
  traces are unreadable exactly when you need them most.
- **Session tracking on**, so you get crash-free session and user rates rather than raw counts.
  Raw crash counts rise with adoption and tell you nothing.
- **Native crashes captured** — a JS-only handler misses the crashes that matter most.
- **PII scrubbed** in `beforeSend` (see the security agent).

Verify the source map upload actually works by triggering a test crash in a release build and
confirming the stack trace is symbolicated. People discover this is broken during an incident.

## The metrics that matter

| Metric | Healthy | Meaning |
|---|---|---|
| Crash-free **sessions** | ≥ 99.5% | Share of app launches without a crash |
| Crash-free **users** | ≥ 99.0% | Share of users who never crashed — catches crash loops affecting a subset |
| ANR rate (Android) | < 0.47% | Play's bad-behaviour threshold; exceeding it hurts your ranking |
| Cold start p95 | < 3s | Perceived speed |
| Adoption rate | — | If users aren't upgrading, your fix isn't reaching them |

Track both crash-free sessions **and** crash-free users. A crash affecting 2% of users on every
launch looks acceptable in session terms and is catastrophic for those users.

Also watch **release health by version**, not in aggregate. A regression in the newest release is
invisible in an overall number dominated by older, stable versions.

## Rollout gates

Define these before you ship, in writing:

```
Proceed to the next rollout step when ALL hold, measured over ≥ 4 hours and ≥ 1000 sessions:
  • crash-free sessions ≥ 99.5%
  • crash-free users ≥ 99.0%
  • no new issue with > 50 events
  • ANR rate within threshold (Android)
  • key funnel conversion within 5% of the previous release

HALT immediately if:
  • crash-free sessions < 99.0%
  • any crash affecting > 1% of sessions on the new version
  • a P0 functional bug is confirmed
```

Written thresholds are the point. In the moment, with a launch date and a stakeholder waiting,
"it's probably fine" wins every argument that isn't already settled.

## Rollback, by scenario

**JS-only bug, OTA in use** — minutes:
```bash
eas update:rollback
# or repoint the channel at a known-good branch
eas channel:edit production --branch production-stable
```
Remember the propagation delay: clients fetch on next launch and apply on the one after, so users
may hit the bug once more.

**Native bug, Android** — halt the staged rollout in Play Console immediately. Users who already
received it keep it, so follow with a hotfix build at a higher `versionCode`. You cannot un-ship
to those users; you can only ship over them.

**Native bug, iOS** — pause the phased release. Then either expedite a fix through review, or (in
severe cases) remove the version from sale. Phased release is why you cap exposure at 1% on day
one.

**Bad server-side change** — the fastest lever of all, and the reason to put risky behaviour
behind a **remote feature flag** rather than shipping it in the binary. A flag you can flip is a
rollback that takes seconds and needs no review, no OTA, and no user action. When advising on any
risky release, ask whether the change can be flagged.

## Incident response

1. **Confirm scope.** Which versions, which platforms, how many users, since when. Filter by
   release — this is where correct `release`/`dist` tagging pays for itself.
2. **Stop the spread.** Halt the rollout, pause the phased release, disable the flag, or roll back
   the OTA. Do this before diagnosing; you can debug a contained incident calmly.
3. **Diagnose** from the symbolicated stack trace and breadcrumbs.
4. **Fix and verify** on a build with the same runtime version as the affected users.
5. **Ship** by the fastest safe path: flag → OTA → expedited review.
6. **Communicate** — status page, app store release notes, support macros. Users who know a fix
   is coming leave fewer one-star reviews.
7. **Post-mortem.** What made this reach production, and what gate would have caught it? Add the
   gate.

## Breadcrumbs

Crashes are far easier to reproduce with a trail:

```ts
// Navigation breadcrumbs
navigationRef.addListener('state', () => {
  Sentry.addBreadcrumb({ category: 'navigation', message: navigationRef.getCurrentRoute()?.name });
});

// Key user actions
Sentry.addBreadcrumb({ category: 'action', message: 'checkout.submit', level: 'info' });
```

Scrub anything sensitive from breadcrumb URLs and payloads.

## Beyond crashes

Crash-free rate can look perfect while the app is broken. Also monitor:

- **Funnel conversion** per release — a release that drops checkout completion 20% without
  crashing is a serious regression that no crash dashboard will show you.
- **API error rates** by app version — reveals a client/server contract break.
- **Startup time and screen-load** p95 by release.
- **Store reviews and support tickets** — often the earliest signal, and the only one for
  "it works but it's wrong".
- **Schema-validation failures** (from your zod parsers) — the canary for backend drift.

## Audit

```bash
rg 'Sentry\.init|crashlytics|Bugsnag' --glob "**/*.{js,jsx,ts,tsx}" -A 12
rg 'release:|dist:|environment:' --glob "**/*.{js,jsx,ts,tsx}"
rg 'sentry|sourcemap' .github/workflows/ eas.json fastlane/ 2>/dev/null
rg 'enableAutoSessionTracking' --glob "**/*.{js,jsx,ts,tsx}"
rg 'addBreadcrumb' --glob "**/*.{js,jsx,ts,tsx}" -c
rg -i 'featureFlag|remoteConfig|launchDarkly|statsig' --glob "**/*.{js,jsx,ts,tsx}" -l
```
