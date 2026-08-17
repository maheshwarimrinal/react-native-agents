# Navigation and Input

## The Android hardware back button

There is no iOS equivalent, so it is routinely never considered. On Android it is a global control
the user presses constantly, and the default behaviour is to pop the navigation stack — or, at the
root, to exit the app.

The damage: a user filling in a form presses back expecting to dismiss the keyboard, and instead
loses the screen. Or a user in a checkout flow presses back and exits the app entirely.

```tsx
useEffect(() => {
  if (Platform.OS !== 'android') return;

  const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    if (hasUnsavedChanges) {
      confirmDiscard();
      return true;    // handled — do not pop
    }
    return false;     // let the default happen
  });

  return () => sub.remove();
}, [hasUnsavedChanges, confirmDiscard]);
```

Two rules. **Return `true` only when you actually handled it** — returning `true` unconditionally
traps the user on the screen, which is a worse bug than the one you were fixing. And **always
remove the listener**, or stale handlers from unmounted screens keep firing.

Where it matters most: modals and bottom sheets, multi-step flows, forms with unsaved input, and
anything where "back" is ambiguous.

```bash
rg -n "BackHandler" --glob "**/*.{ts,tsx}" -A8
rg -ln "Modal|BottomSheet" --glob "**/*.tsx" | while read -r f; do
  rg -q "BackHandler" "$f" || echo "  modal without back handling: $f"
done
```

## Gestures

**iOS swipe-back** is a system-level edge gesture that users rely on heavily. Disabling it
(`gestureEnabled: false`) to prevent leaving a flow removes an interaction iOS users treat as
universal — do it deliberately, and provide a visible alternative.

**Android gesture navigation** puts the system back gesture on the same screen edges. A horizontal
swipe control near the edge competes with it, and the system usually wins.

Both platforms therefore punish edge-anchored horizontal gestures, for different reasons.

## Deep links need per-platform configuration

The JS side is shared; the native association is not.

| | iOS | Android |
|---|---|---|
| Mechanism | Universal Links | App Links |
| Native config | `associatedDomains` entitlement | `intent-filter` + `autoVerify` |
| Server file | `apple-app-site-association` | `assetlinks.json` |
| Served from | `/.well-known/`, HTTPS, no redirects | `/.well-known/`, HTTPS |

Configured on one platform only, the link opens in the browser on the other — which looks like the
link is simply broken, and is frequently diagnosed as a JS routing problem for hours before anyone
checks the native side. Hand the routing detail to `rn-navigation`.

## Alerts

Button order and styling differ, and the destructive-action position is not the same. An `Alert`
whose confirm and cancel are positionally assumed will place the destructive option where the other
platform's users expect the safe one.

Use the `style` property (`'destructive'`, `'cancel'`) rather than relying on order, and let each
platform place them.

## Text input details

- **`autoCorrect` / `autoCapitalize`** defaults differ. Explicitly disable both for email, username,
  and code fields, or Android will helpfully capitalise an email address.
- **`returnKeyType`** renders differently and some values are platform-specific.
- **`keyboardType`** — several values exist on only one platform; verify the one you chose.
- **Multiline input height** behaves differently; Android needs `textAlignVertical: 'top'` to look
  correct.
