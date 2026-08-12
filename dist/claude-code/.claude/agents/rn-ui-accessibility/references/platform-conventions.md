# Platform Conventions

A cross-platform app doesn't have to look identical on both platforms — it has to feel *native*
on each. Users have expectations formed by every other app on their device.

## Navigation

| | iOS | Android |
|---|---|---|
| Back | Swipe from left edge + back button in the header | System back gesture / button — **must** be handled |
| Primary nav | Bottom tab bar | Bottom navigation bar (Material 3) or navigation rail on wide screens |
| Secondary nav | Modal sheets, segmented controls | Navigation drawer, tabs under the app bar |
| Header title | Centred | Left-aligned (start-aligned) |
| Transition | Slide from right | Fade-through / shared-axis |

The Android back button is not optional. Every screen must handle it sensibly, and a custom flow
(a multi-step form, a media viewer) needs explicit handling:

```tsx
useEffect(() => {
  const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    if (step > 0) { setStep(s => s - 1); return true; }   // handled
    return false;                                          // default behaviour
  });
  return () => sub.remove();
}, [step]);
```

Never trap the user with `return true` unconditionally, and never exit the app from a mid-flow
screen without warning about unsaved work.

`@react-navigation/native-stack` gives you the correct native transition and gesture on both
platforms for free — prefer it over the JS `stack` navigator.

## Modals and sheets

- **iOS:** sheets that slide up and can be dismissed by dragging down. Detents (half/full) are
  the current idiom. `react-native-bottom-sheet` or the native modal presentation styles.
- **Android:** full-screen dialogs for complex tasks, bottom sheets for choices, alert dialogs
  for confirmations.
- Both: dismiss on backdrop tap where the action is non-destructive; confirm before discarding
  unsaved input.
- A modal must trap accessibility focus (see `accessibility-checklist.md`).

## Controls

| Concept | iOS | Android |
|---|---|---|
| Toggle | `Switch` (green) | `Switch` (Material, themed) |
| Choose one from few | Segmented control | Tabs or chips |
| Choose one from many | Picker wheel / list sheet | Dropdown menu / list dialog |
| Date/time | Wheel or inline calendar | Material date picker dialog |
| Destructive confirm | Action sheet with a red option | Alert dialog |
| Text field | Underline-free, rounded | Material outlined/filled with floating label |

Use `Platform.select` for the divergence, or `.ios.tsx` / `.android.tsx` files when the
implementations differ substantially.

## Feedback

- **iOS:** subtle opacity change on press. `TouchableOpacity`, or `Pressable` with a pressed
  style.
- **Android:** ripple emanating from the touch point. `Pressable` with `android_ripple`, or
  `TouchableNativeFeedback`.

```tsx
<Pressable
  android_ripple={{ color: theme.ripple, borderless: false }}
  style={({ pressed }) => [styles.btn, pressed && Platform.OS === 'ios' && { opacity: 0.7 }]}
/>
```

An Android app with iOS-style opacity feedback and no ripple feels subtly wrong to Android users
in a way they usually can't articulate.

## System integration

- **Share:** `Share.share()` maps to the native share sheet on both.
- **Status bar:** style must match the background in both themes; on Android also set the
  background colour and translucency.
- **Edge-to-edge:** required on Android 15+. Content draws behind system bars; inset handling is
  mandatory.
- **Haptics:** iOS has a richer taptic vocabulary; Android varies widely by device and may have
  vibration disabled.
- **Notifications:** Android needs channels (created before first notification, with the right
  importance); iOS needs explicit permission and supports provisional authorisation.
- **Permissions:** iOS asks once — a denial is permanent until the user goes to Settings, so
  request in context and handle the denied path by deep-linking to Settings. Android allows
  re-prompting but adds "don't ask again", and Android 13+ requires a runtime permission for
  notifications.
- **App icon and splash:** both platforms have specific size and safe-area requirements; Android
  adaptive icons need foreground/background layers with the correct safe zone or they get
  cropped.

## Typography and spacing

- iOS: San Francisco, generally larger default body size (17pt), tighter tracking.
- Android: Roboto, 16sp body, Material 3 type scale.
- Material 3 uses an 8dp grid; iOS is looser but similar in practice.

Using one type scale across both is fine and common. Using iOS's exact letter-spacing on Android
is not — it looks cramped.

## Where to converge vs diverge

**Diverge** on navigation patterns, back behaviour, feedback, pickers, and system integration —
these are muscle memory.

**Converge** on your brand, your content layout, your colour system, and your core interaction
model. Users of both platforms should recognise the same product.

**Never diverge** on features. Platform parity in *functionality* is expected; shipping a feature
on iOS only is a product decision that will generate support load.

## Audit grep

```bash
rg 'BackHandler' --type tsx -c
rg 'TouchableNativeFeedback|android_ripple' --type tsx -c
rg 'Platform\.(OS|select)' --type tsx -c | sort -t: -k2 -rn | head
rg '@react-navigation/(native-)?stack' package.json
rg 'headerTitleAlign' --type tsx
rg 'createChannel|setNotificationChannel' --type ts        # Android channels
rg 'openSettings|Linking\.openSettings' --type ts          # denied-permission path
ls **/*.ios.tsx **/*.android.tsx 2>/dev/null
```
