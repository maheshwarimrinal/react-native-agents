---
trigger: manual
description: "RN Platform Parity: Keyboard and Layout"
---

# Keyboard and Layout

The most common platform bug in React Native, and the most damaging, because it makes forms
impossible to complete rather than merely ugly.

## Why it diverges

On iOS the keyboard **overlays** your content. Nothing about your layout changes; a view that was
at the bottom of the screen is now behind the keyboard.

On Android the behaviour depends on `windowSoftInputMode` in `AndroidManifest.xml`. With
`adjustResize` the window shrinks and your layout reflows. With `adjustPan` it scrolls instead.

These are different enough that a single `KeyboardAvoidingView` configuration cannot be right for
both.

## The standard shape

```tsx
<KeyboardAvoidingView
  style={{ flex: 1 }}
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
>
  <ScrollView keyboardShouldPersistTaps="handled">{/* form */}</ScrollView>
</KeyboardAvoidingView>
```

Three things people miss:

- **`behavior` is required on iOS** and does nothing useful undefined. Omitting it is the single
  most common cause of "the keyboard covers my input on iPhone".
- **`keyboardVerticalOffset` must account for the header.** Without it the avoidance is off by
  exactly the header height, which looks like it half-works.
- **`keyboardShouldPersistTaps="handled"`** — without it, the first tap only dismisses the keyboard
  and your button appears unresponsive. Users tap twice and think the app is broken.

## Check the manifest

```bash
rg -n "windowSoftInputMode" android/app/src/main/AndroidManifest.xml
```

If it is missing, you are on the platform default, which may not be what your layout assumes. This
is worth reading explicitly rather than inferring from behaviour on one device.

## Safe areas are not the keyboard, and both are involved

```tsx
// ✗ hardcoded — wrong on most devices, and wrong differently on each
<View style={{ paddingTop: 44 }}>

// ✓ ask
const insets = useSafeAreaInsets();
<View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
```

`SafeAreaView` handles the simple case. `useSafeAreaInsets` is what you want as soon as you need
the number for anything — a scroll view's content inset, a floating button's offset, a sticky
footer.

The bottom inset matters more than people expect: iOS home-indicator devices and Android gesture
navigation both need it, and a button flush to the bottom edge is partly unreachable without it.

## Audit

```bash
# Inputs with no keyboard avoidance anywhere in the file
rg -l "TextInput" --glob "**/*.{tsx,jsx}" | while read -r f; do
  rg -q "KeyboardAvoidingView|useHeaderHeight|KeyboardAwareScrollView" "$f" || echo "  no avoidance: $f"
done

# KeyboardAvoidingView without a behavior prop
rg -n "KeyboardAvoidingView" -A3 --glob "**/*.{tsx,jsx}" | rg -B1 -A2 -v "behavior"

# Hardcoded insets
rg -n "(paddingTop|marginTop|top):\s*(20|24|44|47|48|59|88)\b" --glob "**/*.{tsx,jsx}"
```

That last pattern catches the specific numbers people hardcode for status bars and notches. A match
is not automatically a bug — but a literal 44 near the top of a screen is worth a look.
