# Denial and Recovery

The path most often unimplemented. The happy path gets built and tested; the denial path is where
users end up.

## Three outcomes, three different UIs

```tsx
switch (outcome.reason) {
  case 'unsupported':
    // No camera on this device. Do not offer Settings — it will not help.
    return <Message>This device has no camera. You can upload a photo instead.</Message>;

  case 'settings':
    // BLOCKED. Requesting again does nothing.
    return (
      <Message>
        Camera access is turned off. Turn it on in Settings to scan receipts.
        <Button onPress={() => Linking.openSettings()}>Open Settings</Button>
      </Message>
    );

  default:
    // DENIED but askable — a retry is meaningful here.
    return <Button onPress={retry}>Allow camera access</Button>;
}
```

Getting these wrong is not cosmetic. A retry button shown for `blocked` calls `request()`, which
resolves without prompting. The user taps, nothing happens, they tap again, and they conclude the
app is broken — which is a support ticket and a review.

## Always offer a way forward

A dead-end screen saying "camera permission denied" is a failure of the app, not of the user. Offer
the alternative: upload from files, enter the address manually, use the in-app inbox.

The permission was for convenience. Losing it should cost convenience, not the feature.

## Deep link to Settings

```ts
Linking.openSettings();
```

This opens your app's settings page on both platforms and is the correct call. Two things to get
right around it:

**Say what to change.** "Open Settings" alone leaves the user hunting. "Turn on Camera in Settings →
Permissions" is a better instruction, even though you cannot deep link to the specific toggle.

**Re-check when they come back.** Otherwise they grant it, return, and your screen still says
denied — which is worse than the original state, because now the app looks broken rather than
merely restricted.

```tsx
useEffect(() => {
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') refresh();
  });
  return () => sub.remove();
}, [refresh]);
```

## Partial grants are not denials

**Limited photo access (iOS)** — the user picked specific photos. Your app works, over a subset.
Treating `limited` as denied blocks a user who said yes. Offer the picker to select more rather
than an error.

**Coarse location (Android)** — approximate rather than precise. Fine for a city-level feature,
insufficient for turn-by-turn. Handle it as a capability question, not a permission failure.

**Provisional notifications (iOS)** — delivered quietly without a prompt. Granted, but silent.

Each of these is "granted" to a boolean check and needs different behaviour.

## Do not nag

Re-prompting on every launch after a denial is hostile and, on iOS, pointless — the prompt does not
appear. If the user declined, let the feature sit behind an obvious affordance they can tap when
they want it.

Asking again is reasonable when the context has genuinely changed — they are now doing the specific
thing the permission enables. Asking again because they opened the app is not.
