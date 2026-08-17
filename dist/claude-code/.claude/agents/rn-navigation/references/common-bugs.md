# Common Navigation Bugs

## Double navigation from a fast double-tap

Two taps before the transition starts push two copies of the screen. The user then has to go back
twice, which reads as the app being broken.

```tsx
// Guard on the navigation state rather than a local flag
const navigation = useNavigation();
const onPress = useCallback(() => {
  if (navigation.isFocused()) navigation.navigate('Order', { id });
}, [navigation, id]);
```

`isFocused()` is more reliable than a `useRef` debounce because it reflects what the navigator
actually did, not what you assumed it did.

## Navigating during render

```tsx
// ✗ side effect during render
if (!user) navigation.navigate('Login');
return <Profile />;
```

Move it into an effect, or better, express it in the tree — see `auth-and-guards.md`. Navigation
during render produces warnings, inconsistent behaviour under concurrent rendering, and occasionally
an infinite loop.

## Persisted state that references a route you removed

```tsx
<NavigationContainer
  initialState={restoredState}
  onStateChange={(s) => persist({ version: STATE_VERSION, state: s })}
>
```

Persisting navigation state without versioning it is a launch crash waiting for a rename. A user on
the old build has state referencing `OrderDetails`; you rename it to `OrderDetail`; they update, and
the app crashes on launch — **only for existing users**, which means it passes every test on a fresh
install and reaches production.

Store a version alongside the state and discard on mismatch. Wrap restoration in a try/catch and
fall back to the default tree.

## Screens that do not re-render on focus

A screen mounted once keeps its data. Returning to it after changing something elsewhere shows the
old view.

```tsx
useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
```

`useFocusEffect` runs on every focus, unlike `useEffect` which runs on mount. The `useCallback` is
required — without it the effect re-runs constantly.

Do not add it everywhere. A server-state library usually handles this better, and refetching on
every focus is its own performance problem.

## Modals and the Android back button

A modal presented as a screen is dismissed by the hardware back button by default, which is usually
right. A modal rendered as a component inside a screen is **not** — back navigates away from the
underlying screen instead, leaving the user somewhere unexpected with the modal gone.

If you render modals as components, handle back explicitly. Coordinate with `rn-platform-parity`.

## Tab bar covering content

The tab bar overlays content unless accounted for. A list whose last item sits under it, or a
floating button behind it, is the usual symptom.

```tsx
const tabBarHeight = useBottomTabBarHeight();
<ScrollView contentContainerStyle={{ paddingBottom: tabBarHeight + insets.bottom }} />
```

Both terms matter — the tab bar height and the safe-area inset.

## Header options recomputed every render

```tsx
// ✗ new object every render
useLayoutEffect(() => {
  navigation.setOptions({ headerRight: () => <Button onPress={save} /> });
});

// ✓ with dependencies
useLayoutEffect(() => {
  navigation.setOptions({ headerRight: () => <Button onPress={save} /> });
}, [navigation, save]);
```

Missing the dependency array sets options on every render, which is a real performance problem on a
screen that renders often. Hand the broader question to `rn-performance`.

## Going back when there is nowhere to go

`navigation.goBack()` from the first screen of a stack does nothing — and on a screen reached by a
deep link, it is frequently the first screen. A back button that silently does nothing is a dead
end.

```tsx
if (navigation.canGoBack()) navigation.goBack();
else navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
```

This is specifically a deep-link bug: it never reproduces in normal in-app use, because in-app
there is always something to go back to.
