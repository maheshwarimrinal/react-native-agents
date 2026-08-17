# Silent Failures

The catalogue. Every entry here produces **no error at build time and no error at runtime** — the
dashboard simply stays empty or misleading, and the team believes the app is healthy.

Work through this before adding any new instrumentation.

## The verification that matters

Everything else is inference. This is proof:

```ts
// Ship this behind a hidden debug gesture or a dev-only screen, then run it in a RELEASE build.
Sentry.captureException(new Error(`verify-${Date.now()}`));
// or
crashlytics().crash();
// or
NewRelic.crashNow('verification');
```

Then confirm in the dashboard, within a few minutes, that:

1. The event **arrived**.
2. The stack trace is **symbolicated** — real file names and line numbers, not `index.android.bundle:1:284619` or hex addresses.
3. It is attributed to the **correct release and build number**.
4. It carries **breadcrumbs** showing how the user got there.

If any of those four fail, the setup is broken regardless of how correct the config looks. A debug
build proves nothing — debug is where symbolication works by accident.

---

## 1. No events at all

| Cause | Check |
|---|---|
| SDK never initialised in release | `rg -n "Sentry.init\|startAgent\|Bugsnag.start" src/ index.js` — is it at module scope in the entry file? |
| Init behind a `__DEV__` guard that inverts | Read the condition literally. `if (__DEV__) Sentry.init(...)` disables it exactly where it matters. |
| DSN/token from an env var that is empty in CI | `rg "SENTRY_DSN\|APP_TOKEN"` then check the CI secret actually exists |
| ProGuard/R8 stripped the SDK on Android | See `symbolication.md` — this is the most common cause |
| Init runs after the crash | Init inside a component, or after `await` on storage/config, misses startup crashes |
| Network blocked | Certificate pinning that does not allow the vendor's domain silently drops every event |

**Init belongs at the top of the entry file, before `AppRegistry.registerComponent`.** Anything
later means startup crashes — the ones users notice most — are invisible.

## 2. Events arrive, stack traces are unreadable

The single most demoralising failure: you get the crash, and it says
`index.android.bundle:1:284619`.

- **JS**: source maps not uploaded for that exact release/dist.
- **iOS native**: dSYMs not uploaded, or Xcode did not generate them (`Debug Information Format`
  must be `DWARF with dSYM File` for release).
- **Android native**: ProGuard mapping file not uploaded, or NDK symbols missing.
- **Mismatch**: maps uploaded under a different `release`/`dist` than the app reports at runtime.
  Very common, and it looks identical to "not uploaded".

## 3. Native crashes missing, JS crashes present

JS error handlers never see native crashes. If the dashboard only ever shows JavaScript errors,
native reporting is off:

```ts
Sentry.init({
  enableNative: true,          // default, but verify it was not disabled
  enableNativeCrashHandling: true,
  enableNdkScopeSync: true,    // Android NDK
});
```

A React Native app crashing in a native module, in Hermes itself, or from an OOM produces nothing
in the JS layer. If your crash list is 100% JavaScript, be suspicious rather than pleased.

## 4. Crash-free rate is implausibly high

Crash-free rate needs **session tracking**. Without it you have crash counts, and a count with no
denominator cannot produce a rate.

```ts
Sentry.init({ autoSessionTracking: true });
// New Relic: sessions are automatic, but check interactionTracingEnabled
```

Also: track crash-free **users** as well as **sessions**. A crash that hits 2% of users on every
launch looks fine in session terms and is catastrophic for those users.

## 5. Everything attributed to one release

```ts
Sentry.init({
  release: `${Application.nativeApplicationVersion}+${Application.nativeBuildVersion}`,
  dist: Application.nativeBuildVersion,
});
```

Without these, every build is the same release. You cannot tell whether the rollout you just
started made things worse — which is the main operational reason to have this at all. It also
breaks source-map matching, so this one failure causes failure #2 as well.

## 6. Events stop after a while

Vendors buffer events and drop them when the pool fills. New Relic exposes this directly
(`setMaxEventPoolSize`, `setMaxEventBufferTime`); Sentry samples. Symptoms: telemetry is rich for
the first minutes of a session and thin afterwards, or busy users report less than quiet ones.

Chatty instrumentation — an event per render, per scroll, per network call — fills the pool with
noise and evicts the events you needed.

## 7. Nothing from users on poor networks

If the SDK does not persist events offline, everything generated while disconnected is lost. That
biases your data toward users on good connections, which is precisely the population *least*
likely to be experiencing problems.

```ts
// New Relic
offlineStorageEnabled: true,
setMaxOfflineStorageSize(200)
```

## 8. Crashes with no story

A stack trace with no breadcrumbs tells you where it broke, not how the user got there. For
anything but a trivial crash, that is the difference between a fix and a guess.

Minimum useful set: navigation transitions, key user actions, network failures, auth state
changes.

## 9. Development-only correctness

Symbolication frequently works in debug and fails in release, because debug ships un-minified
code. **Never verify observability in a debug build.** Every check in this file assumes a release
build on a real device.

## 10. The dashboard is healthy because nobody ships

Worth stating: a genuinely low crash rate is possible. Distinguish it from broken telemetry by
confirming that *something* arrives — events, sessions, breadcrumbs — not just by the absence of
crashes.

---

## Audit sweep

```bash
# Is it initialised, and where?
rg -n "Sentry\.init|startAgent|Bugsnag\.start|crashlytics\(\)" --glob "**/*.{js,jsx,ts,tsx}" -B3 -A12

# Release identity
rg -n "release:|dist:|setJSAppVersion|environment:" --glob "**/*.{js,jsx,ts,tsx}"

# Native + session flags
rg -n "enableNative|autoSessionTracking|nativeCrashReporting|enableNdk" --glob "**/*.{js,jsx,ts,tsx}"

# Symbolication pipeline
rg -n "sentry-cli|upload-sourcemaps|uploadSourceMaps|run-symbol-tool|firebase-crashlytics" \
   package.json ios/ android/ .github/workflows/ fastlane/ 2>/dev/null
rg -n "newrelic|sentry|crashlytics" android/app/proguard-rules.pro 2>/dev/null

# PII
rg -n "beforeSend|beforeBreadcrumb|sendDefaultPii|setUser" --glob "**/*.{js,jsx,ts,tsx}"

# Is it disabled somewhere?
rg -n "enabled:\s*(false|__DEV__)|if \(__DEV__\)" --glob "**/*.{js,jsx,ts,tsx}" -A3 | rg -i "sentry|crash|newrelic"
```
