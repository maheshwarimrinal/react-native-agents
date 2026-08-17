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

## Check what the SDK already covers before adding handlers

A modern crash SDK installs its own global error handler and its own unhandled-rejection tracking.
**Adding your own on top usually makes things worse.** You get duplicate events, or the SDK
replaces your wrapper and yours silently stops running — and which happens depends on whether your
code ran before or after `init`.

```ts
// ✗ Sentry already owns the global handler. Wrapping it double-reports every
//   fatal — once from captureException, once from Sentry's own handler.
const defaultHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((e, isFatal) => {
  Sentry.captureException(e);
  defaultHandler(e, isFatal);
});

// ✗ The `promise` polyfill is not guaranteed to be resolvable on Hermes, so this
//   can throw at startup — inside the code meant to make startup observable.
require('promise/setimmediate/rejection-tracking').enable({ ... });
```

Who actually owns each source:

| Source | Owner |
|---|---|
| Uncaught JS errors | The SDK's global handler — verify with a test throw, don't wrap |
| Unhandled promise rejections | Sentry and Crashlytics both capture these; verify rather than polyfill |
| React render errors | **Yours** — the SDK cannot catch these |
| Native crashes | The SDK, provided native reporting is enabled |

So only the error boundary is genuinely your job:

```tsx
<Sentry.ErrorBoundary
  fallback={ScreenError}
  onError={(e, info) => Sentry.captureException(e, { extra: info })}
>
```

Without one, a render error unmounts the whole tree — the user sees a white screen with no way
back.

If you are on an SDK that genuinely does not cover global errors, install your handler **before**
`init` so the SDK can chain onto yours, then verify the count: trigger one fatal and confirm
exactly one symbolicated event arrives, not two.

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
