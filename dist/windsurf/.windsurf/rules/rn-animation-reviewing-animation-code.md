---
trigger: manual
description: "RN Animation: Reviewing Animation Code"
---

# Reviewing Animation Code

What to look for, roughly in the order that finds real problems fastest.
Correctness before smoothness: a 60fps animation of the wrong value is not an
improvement on a janky correct one.

## 1. Versions, before anything else

```bash
node -p "Object.fromEntries(Object.entries({...require('./package.json').dependencies}).filter(([k])=>/reanimated|worklets|gesture-handler/.test(k)))"
rg -n "reanimated/plugin|worklets/plugin" babel.config.js
```

Reanimated 4 removed `useAnimatedGestureHandler` and `useWorkletCallback`,
renamed the Babel plugin, and re-shaped the threading functions. Commenting on
an API without knowing the major version produces confident, wrong findings.

## 2. The thread boundary

The highest-yield read. For each worklet — `useAnimatedStyle`,
`useDerivedValue`, `useAnimatedReaction`, gesture callbacks, anything with
`'worklet';` — ask what it captured.

| Look for | Why it is wrong |
|---|---|
| A `useState` value or prop inside a worklet with a **frozen dependency list** — `useMemo(…, [])`, a gesture built once, `useCallback(…, [])` | Captured by copy at creation. A Reanimated hook normally re-creates its worklet when its dependencies change, so the copy refreshes on re-render; an empty or hand-written dependency list is what stops that and pins the first value forever |
| A captured value that has to change **between** renders — driven by the gesture or the animation itself | No re-render happens, so nothing re-creates the worklet. This is what a shared value is for, and the one case where "use a shared value" is the answer regardless of dependencies |
| `ref.current` inside a worklet | Refs deliberately do not trigger a re-render, so the worklet is never re-created and the copy is genuinely frozen |
| `setState` called directly from a worklet | Does not cross the boundary; needs `scheduleOnRN`/`runOnJS` |
| `scheduleOnRN(fn)(args)` | Arguments are no longer curried — the call passes none |
| Scheduling back to JS inside `onUpdate` | Per-frame JS work, defeating the point of UI-thread gestures |
| `useAnimatedReaction` with no previous-value comparison | Fires every frame the prepared value changes |

## 3. Interruption and unmount

- Does the gesture reset on **cancellation**, not only on a normal end? Look for
  `.onFinalize`, not just `.onEnd`.
- Is a running animation **cancelled on unmount** if it schedules a callback?
- Does the component handle being re-rendered mid-animation?

The happy path is not where animation bugs live. Fingers lift, calls arrive,
users press back.

## 4. Lists

- A list keyed by **index** animates the wrong row. Index keys make the key set
  depend only on the length, so React reuses the surviving positions in place and
  mounts or unmounts at the end: the deleted row never plays `exiting`, the last
  row does, and a prepended row never plays `entering`. Look for `key={i}`.
- `layout` on a large list is expensive. On a virtualised list it may fight
  recycling.

## 5. Accessibility

- `useReducedMotion` honoured for large movement, spin, parallax or flashing.
- A gesture is not the *only* route to an action.
- Hit areas around 44×44pt or larger.

## 6. Only then, cost

Ask what runs per frame. A worklet doing layout maths every frame blocks the UI
thread — the same thread that draws — so it degrades exactly what it was
supposed to protect.

For frame budgets, profiling and measurement methodology, use **`rn-performance`**.
It owns the "why is this janky" question; this agent owns "is this correct".

## Severity, calibrated

| | Example |
|---|---|
| **P0** | Gesture leaves the UI unusable — a modal that can be dragged off-screen with no way back |
| **P1** | Worklet captures stale state, so the animation shows the wrong value; a removed-in-4 API on a 4.x app |
| **P2** | No cancellation path; index-keyed lists animating the wrong row; reduced motion ignored on large movement |
| **P3** | A spring config that could be tuned; a `withTiming` that would read better as a CSS transition |

Do not inflate. A janky animation is not a P0 unless the screen is unusable.

## What not to report

- **Style preferences.** "I would use `withSpring` here" is not a finding.
- **Library migrations nobody asked for.** Moving a working `Animated` API
  animation to Reanimated is a project, not a review comment — unless the code
  is *already* broken by it.
- **Invented numbers.** No frame counts, no millisecond figures, no "30% smoother"
  unless it was measured. Say what to measure with instead.
- **Confirmations.** "Correctly uses a shared value" is not a finding. If the
  code is right, say so in the summary or say nothing.

## The greps worth running first

```bash
# Removed in 4 — hard failures
rg -n "useAnimatedGestureHandler|useWorkletCallback|combineTransition" --glob "**/*.{ts,tsx,js,jsx}"

# Curried threading calls after a rename-only migration
rg -n "scheduleOn(RN|UI|Runtime)\([^)]*\)\s*\(" --glob "**/*.{ts,tsx,js,jsx}"

# Worklets capturing component state
rg -n "useAnimatedStyle|useDerivedValue|onUpdate|onEnd" -A 6 --glob "**/*.{tsx,jsx}" \
  | rg "useState|props\.|\.current"

# Gestures with no cancellation path
rg -n "Gesture\.\w+\(\)" -A 20 --glob "**/*.{tsx,jsx}" | rg -L "onFinalize"

# Index-keyed entering animations
rg -n "entering=" -B 3 --glob "**/*.{tsx,jsx}" | rg "key=\{(i|idx|index)\}"

# Motion with no reduced-motion path
rg -ln "entering=|withRepeat|SlideIn|ZoomIn" --glob "**/*.{tsx,jsx}" \
  | xargs -I{} sh -c 'rg -q "useReducedMotion" {} || echo {}'
```
