---
trigger: manual
description: "RN Permissions: Request Flows"
---

# Request Flows

## Ask at the point of use

The most consequential decision in permission handling is timing, not code.

**Requesting at launch is the worst option.** The user has no context, no reason to trust you yet,
and on iOS you have spent your only prompt.

**Requesting at the point of use is the best.** The user tapped "Scan receipt"; the camera prompt
now follows obviously from something they chose.

```tsx
// ✗ nothing has happened yet from the user's point of view
useEffect(() => { requestCameraPermission(); }, []);

// ✓ they asked for this
const onScanPress = async () => {
  const status = await ensureCamera();
  if (status === RESULTS.GRANTED) openScanner();
};
```

## Pre-permission prompts protect the system prompt

Ask in your own UI first. Your prompt is repeatable; the system prompt is not.

```tsx
const wants = await showExplainer({
  title: 'Scan receipts',
  body: 'Use the camera to add receipts to a claim without typing anything.',
  confirm: 'Continue',
  cancel: 'Not now',
});

if (wants) await request(PERMISSIONS.IOS.CAMERA);
// If they decline yours, the system prompt is unspent — you can ask again later.
```

This matters most on iOS, where the alternative is losing the permission permanently to a user who
was merely surprised.

Do not make the pre-prompt manipulative. Its purpose is to supply context, not to pressure — and
dark patterns here draw store review attention.

## One place that resolves permission

Scattering `check`/`request` across screens produces inconsistent handling, and some screen will
handle only the happy path.

```ts
export async function ensure(permission: Permission): Promise<PermissionOutcome> {
  const status = await check(permission);

  switch (status) {
    case RESULTS.GRANTED:
    case RESULTS.LIMITED:
      return { ok: true, status };
    case RESULTS.UNAVAILABLE:
      return { ok: false, status, reason: 'unsupported' };
    case RESULTS.BLOCKED:
      return { ok: false, status, reason: 'settings' };
    case RESULTS.DENIED: {
      const next = await request(permission);
      return { ok: next === RESULTS.GRANTED || next === RESULTS.LIMITED, status: next };
    }
  }
}
```

Callers get a result they cannot mishandle by accident, and the platform differences live in one
file.

## Do not gate the app on an optional permission

If the app is usable without a permission, let it be used. A location permission that blocks the
whole app when the user only wanted to browse is a reason to uninstall.

Degrade instead: manual address entry rather than location, file picker rather than camera, an
in-app inbox rather than push.

## Handle the request in flight

Permission requests are async and the user may background the app, rotate, or navigate away.
Guard against setting state on an unmounted component, and against a second request firing while
one is already open — on Android that can throw, and on iOS the second resolves against the first
prompt in ways that are hard to reason about.

## Never request speculatively

Requesting a permission for a feature that is not built yet, or "while we're here", is a rejection
risk under both stores' rules and it burns the iOS prompt for nothing.

The rule that keeps you safe: a permission request should be traceable to a user action that
obviously needs it.
