# React Native Idioms and Smells

The things that are specific to React Native, that a generic React reviewer will miss.

## Styling

```tsx
// ✗ new object every render; breaks memoisation; scatters design values
<View style={{ padding: 16, backgroundColor: '#fff' }} />

// ✓ stable reference, one place to change
const styles = StyleSheet.create({
  container: { padding: spacing.md, backgroundColor: colors.surface },
});
<View style={styles.container} />
```

- Conditional styles as arrays: `style={[styles.base, isActive && styles.active]}` — the array
  literal is a new identity each render, so memoise it if the child is memoised.
- No magic numbers. `padding: 16` scattered through 40 files becomes unmaintainable; use a
  spacing scale.
- No hardcoded colours — they break dark mode (see the UI agent).
- `StyleSheet.absoluteFill` / `absoluteFillObject` instead of writing the four offsets.
- NativeWind/Tailwind is fine if the project uses it; don't mix three styling systems.

## Platform differences

```tsx
// Small divergence — inline
const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  android: { elevation: 4 },
});

// Large divergence — separate files, resolved automatically by Metro
// Picker.ios.tsx / Picker.android.tsx  →  import Picker from './Picker'
```

`Platform.OS === 'ios' ? A : B` sprinkled through a 300-line component is a sign the component
should be split. Also note `Platform.OS` can be `'web'` if the project uses react-native-web —
`=== 'ios' ? x : y` silently gives Android's branch to web.

Things that genuinely differ and get missed:
- Shadows (`shadowX` vs `elevation`) — and elevation also affects z-ordering on Android.
- `overflow: 'hidden'` with children that overflow — inconsistent on Android.
- Keyboard behaviour and `KeyboardAvoidingView` (`padding` on iOS, `height`/nothing on Android).
- Hardware back button — Android only, needs `BackHandler`.
- Text vertical centering, font rendering, and default font families.
- `TouchableOpacity` vs `Pressable` ripple (`android_ripple`).
- Status bar handling and edge-to-edge (mandatory on Android 15+).

## Dimensions and layout

```tsx
// ✗ captured once at module load; wrong after rotation, split-screen, foldable, or keyboard
const { width } = Dimensions.get('window');

// ✓ reactive
const { width, height } = useWindowDimensions();
```

- `window` vs `screen`: `window` excludes system UI on Android. Usually you want `window`.
- Percentage-of-screen sizing breaks on tablets. Use flex and `maxWidth` constraints.
- Never assume portrait.

## Safe areas

```tsx
// ✗ deprecated, iOS-only, doesn't handle rotation or Android cutouts
<SafeAreaView>

// ✓
const insets = useSafeAreaInsets();
<View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }} />
```

`react-native-safe-area-context` is the standard. Apply insets at the right level: a full-bleed
header image should extend under the status bar with only its *content* inset.

## Text

- All text must be inside `<Text>`. A bare string in a `<View>` crashes on both platforms.
- `numberOfLines` + `ellipsizeMode` for anything that could overflow — translations run 30%
  longer than English and this is where layouts break.
- `allowFontScaling` is `true` by default and should stay that way (accessibility). Constrain
  with `maxFontSizeMultiplier` rather than disabling.
- Nested `<Text>` inherits style; that's the correct way to do inline emphasis.

## Touchables

```tsx
// Prefer Pressable — it's the modern API with per-platform feedback and pressed state
<Pressable
  onPress={onPress}
  hitSlop={8}                                   // small targets need this
  android_ripple={{ color: colors.ripple }}
  style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
  accessibilityRole="button"
  accessibilityLabel="Add to cart"
/>
```

- Minimum touch target 44×44pt (iOS) / 48×48dp (Android). Use `hitSlop` when the visual is
  smaller.
- `TouchableWithoutFeedback` gives no feedback — usually the wrong choice.
- Debounce or guard rapid double-taps on anything that navigates or submits. Double-navigation
  pushing two identical screens is a very common bug.

## Lists

Covered in depth by the performance agent, but for review purposes: `ScrollView` with a `.map()`
over unbounded data is a bug; index `keyExtractor` is a bug; inline `renderItem` is a smell.

## Images

```tsx
// Remote images need explicit dimensions or the layout jumps on load
<Image source={{ uri }} style={{ width: 120, height: 80 }} />
```

`require()` for local assets (static path only — `require(variable)` doesn't work, since Metro
resolves at build time). This surprises people migrating from web.

## Navigation

- Type the param list (see `typescript.md`).
- Pass IDs, not objects. Objects go stale, bloat persisted state, and break deep links.
- `useFocusEffect` (not `useEffect`) for work that should run each time the screen is focused —
  screens stay mounted in a stack.
  ```tsx
  useFocusEffect(useCallback(() => {
    const sub = subscribe();
    return () => sub.remove();
  }, []));
  ```
- Handle the Android hardware back button where a custom flow needs it.
- `navigation.navigate` vs `push`: `navigate` reuses an existing instance; `push` always adds.
  Using `navigate` where you meant `push` breaks detail→detail flows.

## Async storage and I/O

- Everything is async; don't block first render on it.
- Wrap it — one module owns storage so it's mockable and swappable.
- Handle the failure case; storage can be full or unavailable.

## Dev-only code

```tsx
if (__DEV__) { /* stripped from release bundles */ }
```

- `console.log` in production: strip via `babel-plugin-transform-remove-console`.
- Test endpoints, mock toggles, and debug menus must be `__DEV__`-guarded or removed.

## Smell checklist for review

| Smell | Why it matters |
|---|---|
| `style={{ ... }}` inline | Breaks memoisation, scatters design tokens |
| `Dimensions.get()` at module scope | Wrong after rotation/foldable |
| `SafeAreaView` from `react-native` | Deprecated, iOS-only |
| Hardcoded hex colours | Breaks dark mode and theming |
| `Platform.OS` checks > 3 per file | Component wants splitting |
| Bare string outside `<Text>` | Crash |
| `TouchableWithoutFeedback` for a button | No feedback, poor a11y |
| Missing `numberOfLines` on dynamic text | Layout break under translation or large fonts |
| Object passed as a navigation param | Stale data, broken deep links |
| `useEffect` where `useFocusEffect` is meant | Runs once, not on re-focus |
| `console.log` | Ships to production |
| `any` on a native module | Undefined contract |

```bash
rg 'style=\{\{' --type tsx -c | sort -t: -k2 -rn | head
rg "Dimensions\.get" --type tsx
rg 'SafeAreaView' --type tsx | rg -v safe-area-context
rg "#[0-9a-fA-F]{3,8}\b" --type tsx | rg -v 'theme|colors|tokens'
rg 'Platform\.(OS|select)' --type tsx -c | sort -t: -k2 -rn | head
rg 'console\.(log|warn)' --type tsx -l
rg 'navigation\.navigate\(.*\{' --type tsx        # objects in params
rg 'TouchableWithoutFeedback' --type tsx
```
