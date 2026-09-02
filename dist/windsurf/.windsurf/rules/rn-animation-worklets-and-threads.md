---
trigger: manual
description: "RN Animation: Worklets and the Thread Boundary"
---

# Worklets and the Thread Boundary

Everything in this file follows from one fact: **Reanimated runs your animation
code in a second JavaScript runtime on the UI thread.** Not a worker, not a
callback — a separate runtime with its own copy of the values it captured.

Almost every "my animation is broken" question is a boundary mistake.

## Three separate questions

These get conflated constantly, including by people who have used Reanimated for
years. They are independent:

1. **Is the function workletized?** The `'worklet';` directive, or automatic
   handling by the Worklets Babel plugin, makes a function *serializable* — able
   to be copied into the UI runtime.
2. **Where is it scheduled?** The API you hand it to decides. `useAnimatedStyle`
   schedules on the UI thread. `scheduleOnRN` schedules on the React Native JS
   thread. A workletized function you simply *call* runs wherever the caller is.
3. **Where is it running right now?** Not always the same answer twice. The
   `useAnimatedStyle` callback runs **first on the JS thread, then immediately
   on the UI thread**. Code that assumes UI-thread-only will break on that first
   pass. Reanimated exposes `global._WORKLET` precisely because the answer is
   not static:

```js
const style = useAnimatedStyle(() => {
  if (global._WORKLET) {
    // UI thread
  } else {
    // the first, JS-thread pass
  }
});
```

Being workletized does **not** mean "runs on the UI thread". Gesture Handler can
be told to run its callbacks on the JS thread instead. The directive is about
serializability; the scheduling API is about placement.

## Where things usually run

Treat this as the default, not a guarantee — the section above is why.

| Usually the **UI thread** | The **JS thread** |
|---|---|
| `useAnimatedStyle` body (after its first pass) | Component render |
| `useAnimatedProps` body | `useEffect`, state setters |
| `useDerivedValue` body | Anything scheduled with `scheduleOnRN` |
| `useAnimatedReaction` bodies | A worklet you call directly from JS |
| `useAnimatedScrollHandler` body | Gesture callbacks configured to run on JS |
| Gesture callbacks (by default) | |

## What a worklet captures, and when it refreshes

This is the part most often stated too strongly — including in earlier versions
of this document.

A **serialized worklet instance** captures its variables by copy. But the
Reanimated hooks **re-create their worklet when their dependencies change**, and
the Babel plugin infers those dependencies from the function body. The official
description of `useAnimatedStyle` is that styles update "whenever an associated
shared value **or React state** changes".

So this works:

```tsx
// ✓ `opacity` is captured, but the hook re-creates the worklet on re-render,
//    so a state change is reflected.
const [opacity, setOpacity] = useState(1);
const style = useAnimatedStyle(() => ({ opacity }));
```

What captured values **cannot** do is change *between* renders. That is the real
distinction, and it is what shared values are for:

```tsx
// ✗ The UI thread cannot move this. Only a re-render can, and a gesture
//   running at 120Hz must not cause 120 re-renders.
const [x, setX] = useState(0);

// ✓ A shared value is written from the UI thread with no render at all.
const x = useSharedValue(0);
```

**Where staleness does bite** is when a worklet is created once and kept:

```tsx
// ✗ Empty dependency array: this gesture object is built on the first render
//   and never again, so `isDeleting` is pinned to its first value forever.
const pan = useMemo(
  () => Gesture.Pan().onEnd(() => {
    if (!isDeleting) scheduleOnRN(onDelete, id);
  }),
  [],
);

// ✓ Either list the dependencies, or read from a shared value.
const pan = useMemo(() => Gesture.Pan().onEnd(() => { … }), [isDeleting, id]);
```

The rule to apply, then, is not "captured values are frozen". It is:

- **Driven by React?** A captured prop or state value is fine — the hook
  refreshes it.
- **Driven by the UI thread between renders** — a gesture, a running animation?
  It must be a shared value.
- **Memoised with a stale dependency list?** That is where a genuine stale
  capture comes from, and it is a dependency-array bug, not a Reanimated one.

## Calling back into React

The UI thread cannot touch React state. Scheduling is explicit, and **this is
the API that changed in Reanimated 4**:

```tsx
// Reanimated 4 — from react-native-worklets. Arguments are NOT curried.
import { scheduleOnRN } from 'react-native-worklets';

const gesture = Gesture.Pan().onEnd((e) => {
  'worklet';
  if (e.translationX > THRESHOLD) {
    scheduleOnRN(onDismiss, item.id);
  }
});
```

```tsx
// Reanimated 3 — the curried form. Still re-exported in 4, but deprecated.
import { runOnJS } from 'react-native-reanimated';

runOnJS(onDismiss)(item.id);
```

Note the shape change: `runOnJS(fn)(args)` became `scheduleOnRN(fn, args)`. A
mechanical find-and-replace of the *name* alone produces a call that schedules a
function with no arguments — which usually fails silently, because the callback
does run.

Going the other way:

| Reanimated 3 | Reanimated 4 (`react-native-worklets`) |
|---|---|
| `runOnJS(fn)(a, b)` | `scheduleOnRN(fn, a, b)` |
| `runOnUI(fn)(a)` | `scheduleOnUI(fn, a)` |
| `executeOnUIRuntimeSync(fn)(a)` | `runOnUISync(fn, a)` |
| `runOnRuntime(rt, fn)(a)` | `scheduleOnRuntime(rt, fn, a)` |

Two things worth saying about scheduling back to JS:

- **It is asynchronous.** Do not schedule and then read the result on the next
  line of the worklet.
- **It costs a hop per call.** Scheduling on every frame of a gesture defeats
  the reason the gesture is on the UI thread at all. Schedule on
  *transitions* — `onEnd`, a threshold being crossed — not on `onUpdate`.

## Reacting to a shared value without rendering

`useAnimatedReaction` watches a value on the UI thread and runs when it changes.
Use it when a change should cause something other than a style update:

```tsx
useAnimatedReaction(
  () => scrollY.value > HEADER_HEIGHT,          // prepare: cheap, pure
  (isCollapsed, wasCollapsed) => {              // react: only when it changes
    if (isCollapsed !== wasCollapsed) {
      scheduleOnRN(setHeaderCollapsed, isCollapsed);
    }
  },
);
```

The guard matters. The reaction fires on every change of the *prepared* value,
and without comparing against the previous one you will schedule a React state
update on every frame — reintroducing exactly the JS-thread work the animation
was moved off it to avoid.

## Deriving instead of duplicating

`useDerivedValue` produces a shared value computed from others, on the UI
thread. Prefer it to keeping two shared values in sync by hand:

```tsx
const progress = useDerivedValue(() => clamp(scrollY.value / HEADER_HEIGHT, 0, 1));
```

## What breaks and how it looks

| Symptom | Usual cause |
|---|---|
| Animation ignores a state change | The worklet is not being re-created: a frozen dependency list (`useMemo(…, [])`, a gesture built once), or a value that has to change between renders and so needs a shared value |
| Callback never runs | Called a JS function directly from a worklet instead of scheduling it |
| Callback runs with `undefined` arguments | Migrated `runOnJS(fn)(a)` to `scheduleOnRN(fn)(a)` — arguments are no longer curried |
| "Tried to synchronously call a non-worklet function" | A non-worklet function called from the UI thread |
| Value updates but nothing moves | Style not applied via `useAnimatedStyle`, or the component is not an `Animated.*` |
| Works in dev, janky in release | Heavy work inside a worklet — it blocks the UI thread |
| Everything broke after upgrading | Babel plugin still `react-native-reanimated/plugin`; Reanimated 4 needs `react-native-worklets/plugin` |

## Auditing

```bash
# State setters called from somewhere that may be the UI thread
rg -n "set[A-Z]\w*\(" --glob "**/*.{ts,tsx,js,jsx}" -B 4 | rg -B 4 "worklet|onUpdate|onEnd|useAnimatedStyle"

# The un-curried migration hazard: a name change without a shape change
rg -n "scheduleOn(RN|UI)\([^)]*\)\s*\(" --glob "**/*.{ts,tsx,js,jsx}"

# Worklets capturing component state
rg -n "useAnimatedStyle|useDerivedValue" -A 6 --glob "**/*.{tsx,jsx}" | rg "useState|props\.|\.current"

# The Babel plugin, which decides whether any of this works at all
rg -n "reanimated/plugin|worklets/plugin" babel.config.js
```
