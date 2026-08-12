# Layout and Responsive Design

## Dimensions

```tsx
// ✗ captured once at import; wrong after rotation, on foldables, in split-screen
const { width } = Dimensions.get('window');

// ✓ reactive to every one of those
const { width, height, fontScale, scale } = useWindowDimensions();
```

`Dimensions.get()` at module scope is one of the most common RN layout bugs. It also breaks when
the keyboard resizes the window on Android.

`window` vs `screen`: `window` is the app's drawable area (excludes system bars on Android);
`screen` is the physical display. You almost always want `window`.

## Breakpoints, not device checks

```tsx
const BREAKPOINTS = { sm: 0, md: 600, lg: 905, xl: 1240 } as const;

export function useBreakpoint() {
  const { width } = useWindowDimensions();
  if (width >= BREAKPOINTS.xl) return 'xl';
  if (width >= BREAKPOINTS.lg) return 'lg';
  if (width >= BREAKPOINTS.md) return 'md';
  return 'sm';
}
```

Base decisions on available width, not on `isTablet` or `Platform.isPad`. A foldable is a phone
and a tablet at different moments; a phone in landscape has tablet-ish width; split-screen gives
a tablet phone-width.

Design floor: **320dp wide** (iPhone SE, older small Androids) and **~360dp** for most Android.
If a layout breaks under 360dp, it breaks for a large share of the global install base.

## Flexbox in RN

Differences from web that trip people up:

- `flexDirection` defaults to **`column`**, not `row`.
- `flex: 1` is the common idiom for "fill available space".
- `alignItems` defaults to `stretch`.
- No `gap` support in older RN; modern versions support `gap`, `rowGap`, `columnGap` — use it
  instead of margin hacks.
- `position: 'absolute'` is relative to the nearest positioned ancestor; there's no `fixed`.
- `zIndex` works, but on Android `elevation` also affects stacking order and can override it.
- Percentage heights need a parent with a definite height.

Patterns:

```tsx
// Fill remaining space
<View style={{ flex: 1 }} />

// Fixed header/footer with scrollable middle
<View style={{ flex: 1 }}>
  <Header />
  <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{children}</ScrollView>
  <Footer />
</View>

// Wrapping grid without a grid system
<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
  {items.map((i) => <Card key={i.id} style={{ width: '48%' }} />)}
</View>
```

`contentContainerStyle={{ flexGrow: 1 }}` on a `ScrollView` is the fix for "my empty state won't
centre" — `flex: 1` on the content container breaks scrolling instead.

## Safe areas

```tsx
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

// Root
<SafeAreaProvider><App /></SafeAreaProvider>

// Per screen — apply insets where they belong
function Screen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <HeroImage />                                          {/* extends under the status bar */}
      <View style={{ paddingTop: insets.top }}><Header /></View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} />
    </View>
  );
}
```

- `SafeAreaView` from `react-native` is iOS-only and deprecated in practice — use the context
  package.
- Insets are not just top/bottom: landscape on notched iPhones has meaningful left/right insets.
- **Android 15+ enforces edge-to-edge.** Your app draws behind the system bars whether you
  planned for it or not, so inset handling is mandatory, not optional polish. Test with gesture
  navigation *and* 3-button navigation — the bottom inset differs substantially.
- A bottom tab bar plus `insets.bottom` is a common double-padding bug; React Navigation already
  accounts for it.

## Keyboard

The most under-tested area in most apps.

```tsx
// Simple cases
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={headerHeight}
  style={{ flex: 1 }}
/>
```

`KeyboardAvoidingView` is unreliable in real layouts — different behaviour per platform, breaks
with tab bars and headers, and doesn't handle animation smoothly. For anything non-trivial use
**`react-native-keyboard-controller`**: it gives synchronised, interactive keyboard animation on
both platforms and a `KeyboardAwareScrollView` that actually works.

Checklist:
- Does the focused input stay visible? Including the *last* field in a long form.
- Is the submit button reachable without dismissing the keyboard?
- `keyboardShouldPersistTaps="handled"` on scroll views, or the first tap on a button just
  dismisses the keyboard and the user has to tap twice.
- `returnKeyType` + `onSubmitEditing` chaining focus between fields.
- Android `windowSoftInputMode` (`adjustResize` is usually right) in the manifest.
- Test with a large font size — the keyboard plus scaled text can leave almost no room.

## Scroll views

- `contentContainerStyle` for padding on content; `style` for the view itself. Mixing these up is
  the cause of most "my padding does nothing" confusion.
- `keyboardDismissMode="on-drag"` feels right in most scrolling forms.
- Nested same-direction scroll views don't work well — restructure.
- On Android, `overScrollMode` and bounce behaviour differ from iOS.

## Tablets, foldables, landscape

- Don't lock orientation without a reason; if you do, declare it consistently on both platforms.
- On wide layouts, cap content width — full-width body text on a tablet is unreadable. Use a
  `maxWidth` container, or a master/detail split.
- Foldables change size at runtime, mid-session. Any layout computed once will be wrong.
- Handle the multi-window / picture-in-picture resize path on Android.
- Preserve state across configuration changes — on Android, a rotation can recreate the activity.

## Images and aspect ratios

```tsx
<Image source={{ uri }} style={{ width: '100%', aspectRatio: 16 / 9 }} />
```

`aspectRatio` is the clean way to size responsively without computing heights from `width`.
Always reserve space for remote images so the layout doesn't jump on load.

## Audit grep

```bash
rg "Dimensions\.get" --type tsx
rg 'SafeAreaView' --type tsx | rg -v safe-area-context
rg 'KeyboardAvoidingView' --type tsx
rg 'keyboardShouldPersistTaps' --type tsx -c
rg 'height:\s*[0-9]{2,}' --type tsx | head -30      # fixed heights that clip scaled text
rg 'width:\s*[0-9]{3,}' --type tsx | head -30       # fixed widths that overflow small screens
rg 'isTablet|Platform\.isPad' --type tsx            # device checks instead of width
rg 'windowSoftInputMode' android/app/src/main/AndroidManifest.xml
rg 'enableEdgeToEdge|edgeToEdge' android/ app.json app.config.*
```
