---
trigger: manual
description: "RN Animation: Reanimated 3 → 4"
---

# Reanimated 3 → 4

The release notes say the API is compatible and most code needs no changes.
That is true of *animation logic* and misleading about everything around it:
the package set, the Babel plugin, the threading functions and two hooks all
moved or went away.

**Check `package.json` and `babel.config.js` before commenting on any API in
this area.** The same line is correct on one major and broken on the other.

## The blockers

**New Architecture only.** Reanimated 4 drops the legacy renderer (Paper)
entirely. An app that cannot move off Paper stays on the latest 3.x — that is a
supported position, not a failure, and it is the right advice for a large app
mid-upgrade.

**There is no single React Native floor.** Support is a *moving window* per
Reanimated minor, not a minimum you clear once. At the time of writing the table
starts at RN 0.78, and newer Reanimated minors **drop** older React Native
versions as they add new ones — 4.7.x supports 0.85–0.87 and does *not* support
0.78, while 4.1.x supports 0.78–0.82 and not 0.83+. `react-native-worklets` has
its own matrix on top, pinned tightly: 4.7.x wants worklets 0.13.x.

Never quote a floor from memory, including from this page. Read the official
compatibility table for the exact pair, or the `compatibility.json` shipped
inside the installed Reanimated package — the table assumes the latest patch of
each minor, and older patches differ.

**Worklets are a separate package now.** Install `react-native-worklets` and
rebuild the native apps. Match the version to the compatibility table rather
than taking the newest.

**The Babel plugin was renamed.** This one breaks everything at once and the
error rarely names the cause:

```diff
 plugins: [
-  'react-native-reanimated/plugin',
+  'react-native-worklets/plugin',
 ],
```

The old path is still exported for compatibility, but the new one is what to
use. If an upgraded app behaves as though no function is a worklet, check here
first.

## Threading functions: renamed *and* re-shaped

All of these moved to `react-native-worklets`. They are re-exported from
`react-native-reanimated` and marked deprecated.

| Reanimated 3 | Reanimated 4 |
|---|---|
| `runOnJS(fn)(a, b)` | `scheduleOnRN(fn, a, b)` |
| `runOnUI(fn)(a)` | `scheduleOnUI(fn, a)` |
| `executeOnUIRuntimeSync(fn)(a)` | `runOnUISync(fn, a)` |
| `runOnRuntime(rt, fn)(a)` | `scheduleOnRuntime(rt, fn, a)` |
| `makeShareableCloneRecursive` | `createSerializable` |

`createWorkletRuntime`, `WorkletRuntime` and `isWorkletFunction` moved with no
API change.

**The argument shape changed too.** These were curried; they are not any more.
A rename-only migration compiles and runs, and passes no arguments:

```js
scheduleOnRN(onDismiss)(item.id);   // ✗ schedules onDismiss with no arguments
scheduleOnRN(onDismiss, item.id);   // ✓
```

Worth grepping for specifically, because the callback *does* fire — it just
receives `undefined`, which surfaces later and somewhere else.

## Removed

| Removed | Replacement |
|---|---|
| `useAnimatedGestureHandler` | The `Gesture` API from Gesture Handler 2 — see `gestures.md` |
| `useWorkletCallback` | `useCallback` with a `'worklet';` directive and a dependency array |
| `combineTransition` | `EntryExitTransition.entering(e).exiting(x)` |
| `react-native-v8` support | — (the engine project appears abandoned) |

```jsx
// useWorkletCallback replacement
useCallback(() => {
  'worklet';
  // …
}, [deps]);
```

If the app uses `gorhom/react-native-bottom-sheet`, it needs **5.1.8 or newer**;
older versions depend on the removed hook.

## Renamed and deprecated

- `useScrollViewOffset` → **`useScrollOffset`**. The old name still works and is
  deprecated.
- `addWhitelistedNativeProps` / `addWhitelistedUIProps` are **no-ops** now —
  Reanimated 4 dropped the native/UI prop distinction. Delete the calls.
- `useAnimatedKeyboard` is marked deprecated.
- Shared Element Transitions remain **experimental**. Treat them as such in
  production advice.

## `withSpring` behaves differently

Three changes at once, which is why springs "feel wrong" after upgrading:

- `restDisplacementThreshold` and `restSpeedThreshold` are gone, replaced by a
  single relative **`energyThreshold`**. Removing the old two is normally
  enough; you rarely need to set the new one.
- **`duration` is perceptual.** Real completion takes about 1.5× the value.
  Divide previous durations by 1.5 to match.
- **Defaults changed.** To restore the old ones:

```js
import { Reanimated3DefaultSpringConfig } from 'react-native-reanimated';
import { Reanimated3DefaultSpringConfigWithDuration } from 'react-native-reanimated';
```

## New in 4

CSS animations and transitions — a declarative API alongside shared values,
adoptable incrementally. See `layout-and-css.md`.

## A migration order that works

1. Confirm the New Architecture is on, then look up your exact React Native
   version in the compatibility table to find which Reanimated 4 minor supports
   it. If none does, stop here and stay on 3.x — everything below is wasted.
2. Install `react-native-worklets` at the matching version; rebuild native.
3. Change the Babel plugin. Clear the Metro cache (`--reset-cache`).
4. Replace `useAnimatedGestureHandler` and `useWorkletCallback` — these are hard
   failures, so they surface immediately.
5. Update the threading calls, **checking the argument shape at each one**, not
   just the name.
6. Delete `addWhitelistedNativeProps` / `addWhitelistedUIProps` calls.
7. Remove `restDisplacementThreshold` / `restSpeedThreshold`; divide spring
   `duration` values by 1.5.
8. Exercise every gesture and spring by hand. None of the above is caught by a
   type check, and most of it is not caught by tests either.

## Auditing

```bash
# Hard failures on 4.x
rg -n "useAnimatedGestureHandler|useWorkletCallback|combineTransition" --glob "**/*.{ts,tsx,js,jsx}"

# Deprecated threading imports still coming from reanimated
rg -n "import \{[^}]*(runOnJS|runOnUI|runOnRuntime|executeOnUIRuntimeSync)[^}]*\} from 'react-native-reanimated'"

# The curried-call hazard after a rename-only migration
rg -n "scheduleOn(RN|UI|Runtime)\([^)]*\)\s*\(" --glob "**/*.{ts,tsx,js,jsx}"

# Spring configs and no-ops that no longer do anything
rg -n "restDisplacementThreshold|restSpeedThreshold|addWhitelisted\w+Props" --glob "**/*.{ts,tsx,js,jsx}"

# The plugin, and the versions that decide all of the above
rg -n "reanimated/plugin|worklets/plugin" babel.config.js
node -p "Object.fromEntries(Object.entries(require('./package.json').dependencies).filter(([k])=>/reanimated|worklets|gesture-handler/.test(k)))"
```
