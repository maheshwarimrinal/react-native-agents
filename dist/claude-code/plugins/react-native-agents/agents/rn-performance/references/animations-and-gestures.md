# Animations and Gestures

The goal is that **per-frame values are produced without a round trip to the JS
thread.** When a frame's value has to make that trip, any JS work — a render, a
fetch callback, a JSON parse — can delay it and drop frames. On a 120Hz display
the budget is 8.3ms per frame; a single React commit can eat all of it.

"Runs on the UI thread" is a property of the *API and how it was configured*, not
of the library. Reanimated schedules worklets on the UI thread, but a
`useAnimatedStyle` callback also runs once on the JS thread, gesture callbacks
can be configured to run on JS, and core `Animated` runs natively only with
`useNativeDriver: true`. Check the configuration before assuming the thread.

## Library choice

| Library | Use |
|---|---|
| **Reanimated 3/4** | Default for anything non-trivial. Worklets are scheduled on the UI thread by the animation APIs. |
| **Gesture Handler** | Default for all touch handling. Recognition is native and callbacks are worklets by default, so they can be kept off JS; composes with Reanimated. |
| `Animated` (core) | Fine for simple one-shot transitions **with `useNativeDriver: true`**. |
| `LayoutAnimation` | Legacy; unreliable on Fabric. Prefer Reanimated layout animations. |
| `PanResponder` | Legacy. JS-thread gesture handling — replace it. |

## Cost, not correctness

**Whether the animation code is *correct* — worklets, the thread boundary, the
Gesture API, `scheduleOnRN` vs `runOnJS`, the Reanimated 4 migration — belongs to
`rn-animation`.** That agent owns authoring and review; this one owns "why is it
janky". Sending a stale-closure bug here produces a frame-budget answer to a
correctness question.

What matters *for performance* is which properties you animate:

```tsx
// ✗ layout pass per frame
useAnimatedStyle(() => ({ width: w.value, marginTop: m.value }))

// ✓ composited — no layout, no paint
useAnimatedStyle(() => ({
  transform: [{ scaleX: sx.value }, { translateY: ty.value }],
  opacity: o.value,
}))
```

`width`, `height`, `top`, `left`, `margin` and `padding` trigger layout on every
frame. `transform` and `opacity` are composited.

Two other costs worth measuring before assuming:

- **Scheduling back to the JS thread per frame.** In a scroll handler or a
  `useAnimatedReaction`, that is 60–120 hops a second, and it puts the work back
  on the thread the animation was moved off. Schedule at boundaries, not on
  every update.
- **Heavy work inside a worklet.** The UI thread also draws. A worklet doing
  real computation every frame degrades exactly what it was meant to protect.

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

## Gesture Handler — the performance angle

The Gesture API itself, composition, cancellation and scroll-view relations are
`rn-animation`'s. What matters here is that gesture recognition and the
resulting updates stay on the UI thread:

- A gesture callback is a worklet by default. Writing a shared value in
  `.onUpdate` is cheap — it stays on the UI thread and does not re-render — but
  it is not free: it still drives the style recomputation and whatever that
  callback does. Scheduling back to JS there costs a hop per frame on top.
- Gestures nested inside scrollables need explicit relations
  (`.blocksExternalGesture`, `.simultaneousWithExternalGesture`) or both
  recognisers stay alive and the list feels like it is sticking.
- `Pressable`/`TouchableOpacity` are fine for taps. Rebuilding them with
  gestures buys nothing and costs correctness.

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
# Reanimated 4 renamed this to react-native-worklets/plugin; either way it must
# be last in the list. A config with neither is a config where no worklet works.
rg 'react-native-(reanimated|worklets)/plugin' babel.config.js
```
