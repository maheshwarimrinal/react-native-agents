# Animations and Gestures

The rule is simple: **animations must run on the UI thread.** If a frame's value has to make a
round trip to the JS thread, any JS work — a render, a fetch callback, a JSON parse — drops
frames. On a 120Hz display you have 8.3ms per frame; a single React commit can eat all of it.

## Library choice

| Library | Use |
|---|---|
| **Reanimated 3/4** | Default for anything non-trivial. Worklets run on the UI thread. |
| **Gesture Handler** | Default for all touch handling. Runs on the UI thread, composes with Reanimated. |
| `Animated` (core) | Fine for simple one-shot transitions **with `useNativeDriver: true`**. |
| `LayoutAnimation` | Legacy; unreliable on Fabric. Prefer Reanimated layout animations. |
| `PanResponder` | Legacy. JS-thread gesture handling — replace it. |

## Reanimated correctness

```tsx
const offset = useSharedValue(0);

const style = useAnimatedStyle(() => ({
  transform: [{ translateX: offset.value }],
}));

// driving it
offset.value = withSpring(100, { damping: 15, stiffness: 120 });
```

Common mistakes:

- **Reading `.value` during render.** `<View style={{ left: offset.value }} />` reads once and
  never updates, and warns. Always go through `useAnimatedStyle`.
- **`runOnJS` inside a per-frame callback.** Every call schedules work on the JS thread; in a
  `useAnimatedReaction` or scroll handler that's 60–120 JS hops per second. Only call `runOnJS`
  at gesture boundaries (start/end) or debounced.
- **Capturing non-worklet values.** Worklets serialise their closure. Capturing a large object,
  or a function that isn't a worklet, either throws or copies more than you expect. Capture
  primitives and shared values.
- **Missing the Babel plugin.** `react-native-reanimated/plugin` must be **last** in
  `babel.config.js` plugins. Without it, worklets silently run on JS.
- **Animating layout properties.** `width`, `height`, `top`, `left`, `margin`, `padding` trigger
  layout on every frame. Animate `transform` and `opacity` — they're composited, not laid out.

```tsx
// ✗ layout pass per frame
useAnimatedStyle(() => ({ width: w.value, marginTop: m.value }))

// ✓ composited
useAnimatedStyle(() => ({
  transform: [{ scaleX: sx.value }, { translateY: ty.value }],
  opacity: o.value,
}))
```

## Scroll-driven animation

```tsx
const scrollY = useSharedValue(0);
const onScroll = useAnimatedScrollHandler((e) => {
  scrollY.value = e.contentOffset.y;   // stays on UI thread
});
<Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} />
```

Never `onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}` — that's a React state
update per scroll event, which is a re-render per frame.

## Core `Animated`

```tsx
Animated.timing(value, {
  toValue: 1,
  duration: 200,
  useNativeDriver: true,   // ← non-negotiable
}).start();
```

`useNativeDriver: true` only supports non-layout properties (`opacity`, `transform`). If you
find `useNativeDriver: false`, that animation is running frame-by-frame on the JS thread — either
switch the animated property or move to Reanimated.

## Gesture Handler

```tsx
const pan = Gesture.Pan()
  .onUpdate((e) => { offset.value = e.translationX; })     // worklet, UI thread
  .onEnd(() => { offset.value = withSpring(0); });

<GestureDetector gesture={pan}>
  <Animated.View style={style} />
</GestureDetector>
```

- Compose with `Gesture.Simultaneous`, `Gesture.Race`, `Gesture.Exclusive` instead of manual
  flag juggling.
- `Pressable`/`TouchableOpacity` are fine for taps; don't rebuild them with gestures.
- Gestures nested inside scrollables need explicit relations (`.blocksExternalGesture`,
  `.simultaneousWithExternalGesture`) or you get scroll-vs-drag fights.

## Navigation transitions

- `@react-navigation/native-stack` uses native navigation primitives and animates on the UI
  thread. The JS `stack` navigator animates in JS. Prefer native-stack unless you need a custom
  transition it can't express.
- Heavy mount work on the incoming screen makes the transition stutter even if the animation
  itself is native. Defer non-critical work:
  ```tsx
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => t.cancel();
  }, []);
  ```
- Shared element transitions: Reanimated's or `react-native-screens`' native implementation, not
  a hand-rolled measure-and-animate.

## Reduced motion

Respect the OS setting — it's an accessibility requirement, not a preference.

```tsx
const reduceMotion = useReducedMotion();          // from react-native-reanimated
const config = reduceMotion ? { duration: 0 } : { damping: 15 };
```

## Frame budget checklist

- 60fps → 16.6ms/frame. 120fps → 8.3ms. Both threads must stay under budget.
- Blur, large shadows, and `overflow: hidden` with rounded corners are expensive to composite —
  especially on Android. Measure before using them in a scrolling context.
- `shouldRasterizeIOS` / `renderToHardwareTextureAndroid` can help for a view that moves without
  changing content, and hurt otherwise. Measure.
- Android: enable "Profile HWUI rendering" in developer options for a live jank bar chart.

## Audit grep

```bash
rg 'useNativeDriver:\s*false'
rg 'PanResponder'
rg 'LayoutAnimation'
rg 'runOnJS' -B 3                       # check the calling context
rg 'onScroll=\{\(' --type tsx           # JS-thread scroll handlers
rg 'reanimated/plugin' babel.config.js  # must be last in the list
```
