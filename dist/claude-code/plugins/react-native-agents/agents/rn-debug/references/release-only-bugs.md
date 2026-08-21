# Bugs That Only Happen in Release

The worst category, because your tooling does not reach them. DevTools attaches to development
builds, so the moment the bug is release-only you have lost breakpoints, the component tree, and
the profiler.

## What is actually different

| Difference | What it breaks |
|---|---|
| Minification | Anything relying on `Function.name`, `constructor.name`, or class names |
| Dead-code elimination | Code reachable only in ways the bundler cannot see |
| `__DEV__` is false | Any behaviour gated on it, including some libraries' internals |
| ProGuard / R8 (Android) | Reflection, native bindings, anything not covered by keep rules |
| No dev warnings | Bugs that were being masked by a warning nobody read |
| Real timing | Development is slower; races hidden by that slowness surface |
| Different error handling | Redbox is gone; errors that were visible now fail silently |

## Diagnose in order

**1 — Is it `__DEV__`?**

```bash
rg -n "__DEV__" --glob "**/*.{ts,tsx,js,jsx}" -A3
```

Read every condition literally. An inverted guard is the classic — `if (__DEV__) initSomething()`
disables the thing exactly where it matters. This is also the most common cause of crash reporting
that appears configured and reports nothing.

**2 — Is it ProGuard/R8, on Android?**

If the symptom is Android-release-only and involves a native module, reflection, or serialisation,
this is the first suspect. Test the hypothesis directly:

```properties
# android/gradle.properties — TEMPORARY, to isolate only
android.enableR8=false
```

If the bug disappears, you need keep rules. Never ship with R8 disabled — this is a diagnostic,
not a fix.

**3 — Is it minification?**

Anything depending on a name surviving the build. Class names, function names, and any
serialisation keyed on them.

```ts
// ✗ the name is not stable after minification
if (error.constructor.name === 'NetworkError') { ... }

// ✓ explicit and survives anything
if (error.code === 'NETWORK_ERROR') { ... }
```

**4 — Is it a swallowed error?**

In development a thrown error shows a redbox. In release it may do nothing visible at all. An empty
screen in release and a working screen in development often means something is throwing where
nobody is looking.

## Getting evidence out of a release build

You cannot attach DevTools, so bring the evidence to you:

```bash
adb logcat --pid=$(adb shell pidof -s <applicationId>)   # Android, works on release
xcrun simctl spawn booted log stream --level debug       # iOS simulator
```

For a physical iOS device, use Xcode's Devices and Simulators → Open Console.

Your crash reporter is the other route — but only if it is genuinely working. A release-only bug is
exactly the situation where you discover that symbolication was broken all along. Verify with a
deliberate test crash before trusting an empty dashboard; `rn-observability` owns that.

## The fastest bisect

Build release with one production behaviour disabled at a time:

1. Release build with minification off — still broken?
2. Release build with R8 off (Android) — still broken?
3. Release build with `__DEV__` forced true — still broken?

Whichever one makes it disappear names the category. Each is a definite answer, and all three
together take less time than a day of reading code.
