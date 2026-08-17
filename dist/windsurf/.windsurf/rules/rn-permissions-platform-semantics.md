---
trigger: manual
description: "RN Permissions: Platform Semantics"
---

# Platform Semantics

The two platforms have different models. This is the root of nearly every permission bug.

| | iOS | Android |
|---|---|---|
| Prompts | Once, ever | Repeatable until refused twice |
| After denial | Settings only | Can re-ask, with rationale |
| Permanent denial | Immediate, after one "Don't Allow" | After "Don't allow" twice |
| Rationale step | No equivalent | `shouldShowRequestPermissionRationale` |
| Declaration | `Info.plist` usage string | `AndroidManifest.xml` `uses-permission` |
| Missing declaration | **App crashes** on request | Request silently fails |
| Partial grants | Limited photos, provisional notifications | Coarse location, media subsets |
| Changed in Settings | App is usually terminated | App continues; re-check on resume |

## The states worth modelling

A boolean cannot express these. `react-native-permissions` names them usefully:

- **`unavailable`** — the feature does not exist on this device. Not a denial; do not offer Settings.
- **`denied`** — not granted, but **requestable**. On iOS this means not yet asked.
- **`granted`** — proceed.
- **`limited`** — granted in part. iOS limited photo access lands here.
- **`blocked`** — cannot be requested again. Settings is the only route.

The two that get conflated are `denied` and `blocked`, and conflating them produces a specific,
common bug: a "grant access" button that calls `request()` when the status is `blocked`. The promise
resolves, nothing appears, nothing changes. The user taps repeatedly and concludes the app is
broken.

```ts
const status = await check(PERMISSIONS.IOS.CAMERA);

switch (status) {
  case RESULTS.UNAVAILABLE: return showNoCameraOnDevice();
  case RESULTS.DENIED:      return request(PERMISSIONS.IOS.CAMERA);   // askable
  case RESULTS.BLOCKED:     return showSettingsPrompt();               // not askable
  case RESULTS.LIMITED:     return proceedWithLimited();
  case RESULTS.GRANTED:     return proceed();
}
```

## iOS asks once — treat the prompt as scarce

The single system prompt is the whole budget. Once spent on a "no", your code cannot ask again;
`request()` resolves immediately with the denied status and shows nothing.

The practical consequence is that **when** you ask matters more than how. See `request-flows.md`.

## Android's rationale step

Android tells you when the user has refused before and an explanation is warranted:

```ts
// react-native-permissions surfaces this in the status;
// the platform API is shouldShowRequestPermissionRationale
if (status === RESULTS.DENIED && hasAskedBefore) {
  await showRationale();      // your UI, explaining why
}
await request(PERMISSION);
```

Skipping the rationale wastes the second chance the platform gives you, and iOS-first code always
skips it because there is nothing to skip on iOS.

## Settings changes while backgrounded

A user can grant or revoke in Settings and return. On Android your app keeps running with a cached
status that is now wrong. On iOS the app is usually terminated for some permissions, but not all.

Re-check on resume rather than caching at mount:

```ts
useEffect(() => {
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') refreshPermissionStatus();
  });
  return () => sub.remove();
}, []);
```

Without this, a user who followed your Settings link returns to a screen still telling them access
is denied — after they just granted it. This is a bad moment: they did what you asked and the app
disagrees.
