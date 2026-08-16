# Crash Reporting Setup

## Initialise early, at module scope

```ts
// index.js — before AppRegistry.registerComponent, before any import that could throw
import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,

  // Release identity. Without these, every build is one bucket and source maps
  // never match — see symbolication.md.
  release: `${Application.applicationId}@${Application.nativeApplicationVersion}+${Application.nativeBuildVersion}`,
  dist: Application.nativeBuildVersion,
  environment: process.env.EXPO_PUBLIC_ENV ?? 'production',

  // Native crashes are invisible to any JS handler. Verify these are on.
  enableNative: true,
  enableNativeCrashHandling: true,
  enableNdkScopeSync: true,

  // Crash-free rate needs sessions; without this you have counts, not a rate.
  autoSessionTracking: true,

  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,

  sendDefaultPii: false,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,

  integrations: [
    Sentry.reactNativeTracingIntegration(),
    Sentry.reactNavigationIntegration({ enableTimeToInitialDisplay: true }),
  ],
});
```

Two things people get wrong here and never notice:

**Init runs too late.** Inside a component, or after `await AsyncStorage.getItem(...)`, or after a
remote-config fetch. Startup crashes — the most user-visible kind — then go unreported.

**Init is disabled in release.** Usually an inverted `__DEV__` guard, or a DSN read from an
environment variable that is populated locally and empty in CI. Read the condition literally
rather than assuming intent.

## Catch what the SDK doesn't

Even with the SDK installed, three sources need explicit wiring:

```ts
// 1. Uncaught JS errors outside React
const defaultHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  Sentry.captureException(error, { level: isFatal ? 'fatal' : 'error' });
  defaultHandler(error, isFatal);   // keep the default behaviour; do not swallow
});

// 2. Unhandled promise rejections — a large share of real production errors
require('promise/setimmediate/rejection-tracking').enable({
  allRejections: true,
  onUnhandled: (id, error) => Sentry.captureException(error),
});

// 3. React render errors, per screen, so one broken screen is not a white app
<Sentry.ErrorBoundary fallback={ScreenError} onError={(e, info) => Sentry.captureException(e, { extra: info })}>
```

Without an error boundary a render error unmounts the whole tree — the user sees a white screen
with no way back, and depending on setup you may not even get a report.

## Vendor comparison

| | Sentry | Crashlytics | New Relic | Bugsnag |
|---|---|---|---|---|
| JS + native crashes | ✅ | ✅ | ✅ | ✅ |
| Source-map upload | first class | manual-ish | limited | ✅ |
| Release health / crash-free | ✅ | ✅ | ✅ | ✅ |
| Performance / tracing | ✅ | limited | ✅ | limited |
| Network instrumentation | ✅ | ❌ | ✅ (automatic) | ✅ |
| Session replay | ✅ | ❌ | ✅ | ❌ |
| Cost | usage-based | free | enterprise | usage-based |

Choose on: does it symbolicate React Native properly, does it report release health, and can you
afford the event volume. Most teams do not need two — running Crashlytics *and* Sentry usually
means neither is configured properly, and it doubles the PII surface.

## New Relic specifics

Its instrumentation is broader by default, which is a mixed blessing: more signal, more volume.

```ts
NewRelic.startAgent(appToken, {
  crashReportingEnabled: true,
  nativeCrashReportingEnabled: true,   // Android C/C++; off by default
  networkRequestEnabled: true,
  networkErrorRequestEnabled: true,
  httpResponseBodyCaptureEnabled: false,  // ⚠ captures response bodies — PII risk
  distributedTracingEnabled: true,
  offlineStorageEnabled: true,             // keeps events from users on bad networks
  loggingEnabled: false,                   // agent's own logs, not yours
});
NewRelic.setJSAppVersion(version);         // easy to forget; without it, no version attribution
```

`httpResponseBodyCaptureEnabled: true` sends response bodies for failed requests to a third
party. That is frequently PII, sometimes tokens. Default it off and turn it on deliberately for a
debugging window.

Navigation instrumentation is not automatic:

```tsx
<NavigationContainer onStateChange={NewRelic.onStateChange} />
```

And Jest needs the package transformed, or every test suite breaks on import:

```jsonc
"transformIgnorePatterns": [
  "node_modules/(?!@react-native|react-native|newrelic-react-native-agent)"
],
"setupFiles": ["./node_modules/newrelic-react-native-agent/jestSetup.js"]
```

## Release health and alerting

Alert on **rates per release**, never on raw counts — counts rise with adoption and tell you
nothing.

| Metric | Healthy | Why |
|---|---|---|
| Crash-free sessions | ≥ 99.5% | share of launches without a crash |
| Crash-free users | ≥ 99.0% | catches a crash loop hitting a subset hard |
| ANR rate (Android) | < 0.47% | Play's threshold; exceeding it hurts ranking |
| New issue volume | — | a spike right after a rollout is the signal |

Gate rollouts on these (see the release agent's `monitoring-and-rollback.md`) and alert on
**regression against the previous release**, not an absolute number. Absolute thresholds either
fire constantly or never.

## Crashes are not the whole picture

An app can be crash-free and still broken. Also watch:

- **Funnel conversion per release** — a change that drops checkout 20% without crashing is a
  serious regression no crash dashboard will show.
- **API error rates by app version** — reveals a client/server contract break.
- **Schema validation failures** from your zod parsers — the earliest warning that the backend
  changed under you.
- **Startup time p95 by release.**
- **Store reviews and support tickets** — often the first signal, and the only one for "it works
  but it's wrong".
