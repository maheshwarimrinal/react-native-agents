---
trigger: manual
description: "RN Animation: Gestures"
---

# Gestures

Gesture Handler runs recognition on the UI thread. Paired with Reanimated, a
drag can follow the finger without a single JS-thread frame. Paired badly, it
fights the scroll view, never fires, or leaves the UI mid-animation.

## The API, and the one that was removed

`useAnimatedGestureHandler` was deprecated in Reanimated 3 and **removed in
Reanimated 4**. Code using it does not warn on 4.x; it fails to import. The
replacement is the `Gesture` API from Gesture Handler 2:

```tsx
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';

function Draggable() {
  const x = useSharedValue(0);
  const start = useSharedValue(0);

  const pan = Gesture.Pan()
    .onStart(() => {
      // Capture where we began, so the drag is relative rather than absolute.
      start.value = x.value;
    })
    .onUpdate((e) => {
      x.value = start.value + e.translationX;
    })
    .onEnd((e) => {
      // Hand the velocity to the spring so the movement stays continuous
      // with the finger rather than restarting from zero.
      x.value = withSpring(0, { velocity: e.velocityX });
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style} />
    </GestureDetector>
  );
}
```

Three things are load-bearing and easy to miss:

- **`GestureDetector` must wrap an `Animated.*` component** for the style to
  apply, and the app must be wrapped in `GestureHandlerRootView` at the root. A
  gesture that "does nothing at all" is usually one of these two.
- **`onStart` capturing the current value** is what makes a second drag continue
  from where the first ended. Without it every drag jumps back to zero first.
- **Gesture callbacks are worklets.** Everything in
  `references/worklets-and-threads.md` applies — no direct `setState`, and be
  deliberate about captured props and state. A `Gesture.Pan()` built inline is
  rebuilt on every render, so what it captured is current as of the last render.
  Freeze it — `useMemo(…, [])`, or a gesture stored in a ref — and the capture
  freezes with it. Anything that has to change *between* renders, because the
  gesture itself is driving it, needs a shared value either way.

## Composition

Gestures compose explicitly, and which one you choose decides how it feels:

| | Behaviour | Use when |
|---|---|---|
| `Gesture.Simultaneous(a, b)` | Both run at once | Pinch and pan on a photo |
| `Gesture.Race(a, b)` | First to activate wins, cancels the other | Tap or long-press on one item |
| `Gesture.Exclusive(a, b)` | `a` gets priority; `b` only if `a` fails | Double-tap before single-tap |

```tsx
const zoom = Gesture.Simultaneous(Gesture.Pinch(), Gesture.Pan());
```

## Living inside a scroll view

The most common real problem: a horizontal swipe inside a vertical list, where
both want the same finger.

- Give the gesture an **activation threshold** so a small movement stays with
  the scroll view: `.activeOffsetX([-10, 10])`.
- Use **`.failOffsetY([-5, 5])`** so a mostly-vertical movement abandons the
  horizontal gesture rather than competing with it.

```tsx
const swipe = Gesture.Pan()
  .activeOffsetX([-10, 10])   // horizontal intent required to activate
  .failOffsetY([-5, 5]);      // vertical intent gives up immediately
```

Without these, swipe-to-delete inside a `FlatList` feels like the list is
sticking, because both recognisers are alive at once.

## The cases people forget

**Interruption.** A finger can lift anywhere. `.onEnd` runs on a normal release;
`.onFinalize` runs on release *and* cancellation. Reset state in `onFinalize`,
or a cancelled gesture strands the view off-screen.

```tsx
.onFinalize(() => {
  isPressed.value = false;
});
```

**Unmount mid-animation.** If a spring is running when the screen goes away,
cancel it — particularly one that schedules back to JS on completion:

```tsx
useEffect(() => () => cancelAnimation(x), []);
```

**Thresholds belong on velocity as well as distance.** A fast, short flick is a
dismissal; a slow, long drag may not be. Judging on `translationX` alone makes
the interaction feel unresponsive to quick gestures:

```tsx
.onEnd((e) => {
  const dismissed = e.translationX > width * 0.4 || e.velocityX > 800;
  x.value = withSpring(dismissed ? width : 0);
  if (dismissed) scheduleOnRN(onDismiss, id);
});
```

**Hit targets.** A gesture area smaller than roughly 44×44pt is hard to hit and
fails accessibility guidance. `rn-ui-accessibility` owns the wider surface.

## Accessibility

A gesture that is the *only* way to reach an action excludes anyone who cannot
perform it. Swipe-to-delete needs a reachable alternative — a long-press menu, a
button in an expanded row — and the container needs an accessibility action so
screen-reader users get there at all.

## Auditing

```bash
# Removed in Reanimated 4 — this does not warn, it fails to import
rg -n "useAnimatedGestureHandler" --glob "**/*.{ts,tsx,js,jsx}"

# Gestures that never reset on cancellation
rg -n "Gesture\.\w+\(\)" -A 20 --glob "**/*.{tsx,jsx}" | rg -L "onFinalize"

# Horizontal gestures inside a scrollable, with no activation threshold
rg -n "Gesture\.Pan\(\)" -A 8 --glob "**/*.{tsx,jsx}" | rg -L "activeOffset|failOffset"

# The root wrapper, without which nothing fires
rg -n "GestureHandlerRootView" --glob "**/{App,index,_layout}.{ts,tsx,js,jsx}"
```
