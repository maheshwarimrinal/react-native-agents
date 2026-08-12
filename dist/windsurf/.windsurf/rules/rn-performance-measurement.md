---
trigger: manual
description: "RN Performance: Measurement Toolchain"
---

# Measurement Toolchain

You cannot optimise what you have not measured. This is the toolbox.

## Ground rules

- **Release builds only.** `npx expo run:android --variant release` / `--configuration Release`.
  Dev builds run un-minified JS, extra warning machinery, and no Hermes AOT bytecode.
- **Real devices, low end.** A Pixel 6a or an older mid-range Android tells you the truth. iOS
  simulators run on desktop-class CPUs and will hide almost every JS bottleneck.
- **n ≥ 5, report p50 and p95.** Single runs are noise. Cold start especially varies wildly.
- **Change one thing at a time.** Otherwise you cannot attribute the delta.
- **Airplane mode or a fixed mock server** when measuring anything non-network, so network
  variance doesn't pollute the numbers.

## React Native DevTools

The modern replacement for Flipper (Flipper is deprecated for RN — do not recommend it).
Open with `j` in the Metro terminal.

- **React DevTools Profiler** — record an interaction, read the flame graph. The columns you
  care about: how many components committed, which ones rendered without their props changing
  ("Why did this render?" panel), and total commit duration. This is the fastest way to find
  wasted renders.
- **Console / Network / Sources** — standard Chrome DevTools panels backed by Hermes.
- **Memory** — heap snapshots; diff two snapshots taken before and after a suspected leak cycle.

## Hermes sampling profiler

The tool for "the JS thread is pegged and I don't know why".

```bash
# Start a profile from the dev menu ("Start Sampling Profiler"), reproduce, then stop.
# Pull the trace off the device:
npx react-native profile-hermes ./profiles
# Produces a Chrome-devtools-compatible .cpuprofile — open at chrome://tracing or in DevTools.
```

Look for wide plateaus in the flame graph — those are your long synchronous tasks. Common
offenders: `JSON.parse` on a large payload, `Array.prototype.sort` on thousands of items,
date formatting in a render loop, regex over large strings, synchronous crypto.

## Frame timing / jank

- **Android — Perfetto** (`https://ui.perfetto.dev`). Record with
  `adb shell perfetto -o /data/misc/perfetto-traces/trace -t 20s sched freq idle am wm gfx view`.
  Look at `Choreographer#doFrame`, `Expected Timeline` vs `Actual Timeline`, and jank slices.
  Also cheap: `adb shell dumpsys gfxinfo <package> framestats`.
- **iOS — Xcode Instruments.** *Time Profiler* for CPU, *Animation Hitches* for dropped frames,
  *Allocations* / *Leaks* for memory, *App Launch* for startup breakdown.
- **In-app** — `PerformanceObserver`-style monitoring via `react-native-performance`, or Sentry
  Mobile Vitals / Firebase Performance for field data. Field p95 beats lab p50 every time for
  knowing whether users are actually suffering.

## Startup / TTI

```js
// Earliest reliable JS timestamp
import { AppRegistry } from 'react-native';
const jsStart = Date.now();

// Mark when the first meaningful screen has content
useEffect(() => {
  const tti = Date.now() - jsStart;
  analytics.track('tti_ms', { tti });
}, []);
```

Better: `react-native-performance` exposes native start marks
(`performance.getEntriesByName('nativeLaunchStart')`) so you can measure process-start → first
paint, not just JS-start → first paint. Expo apps can use `expo-updates` timing plus a manual
mark.

Android cold start baseline: `adb shell am start -W -n <pkg>/<activity>` reports
`TotalTime` / `WaitTime`. Run it 10 times after `adb shell am force-stop`.

## Bundle size

```bash
# Visualise what's in the JS bundle
npx react-native-bundle-visualizer

# Expo: Atlas gives an interactive treemap
EXPO_UNSTABLE_ATLAS=true npx expo start
npx expo-atlas

# Raw bundle, minified + Hermes bytecode
npx react-native bundle --platform android --dev false --minify true \
  --entry-file index.js --bundle-output /tmp/main.jsbundle
ls -la /tmp/main.jsbundle
```

App size: `bundletool build-apks` + `get-size total` for Android AAB download size, and Xcode's
App Thinning Size Report for iOS. What matters to users is *download* size, not the artifact
size on your CI machine.

## Dependency weight

```bash
npx depcheck                      # unused deps
npx knip                          # unused files, exports, and deps
npx madge --circular src/         # circular imports (a real bundle-bloat cause)
npx howfat <package>              # transitive weight of a candidate dependency
```

## Re-render detection in development

```js
// index.js — dev only, never ship this
if (__DEV__) {
  const whyDidYouRender = require('@welldone-software/why-did-you-render');
  whyDidYouRender(require('react'), { trackAllPureComponents: true });
}
```

Cheaper alternative with zero deps — a hook that logs which prop changed:

```ts
export function useWhyDidYouUpdate(name: string, props: Record<string, unknown>) {
  const prev = useRef<Record<string, unknown>>();
  useEffect(() => {
    if (prev.current) {
      const changed = Object.entries(props).filter(([k, v]) => prev.current![k] !== v);
      if (changed.length) console.log(`[${name}] changed:`, Object.fromEntries(changed));
    }
    prev.current = props;
  });
}
```

## Reporting a measurement

State the device, build type, sample size, and both p50 and p95:

> Pixel 6a, release build, n=10, cold start after `force-stop`:
> before p50 2410ms / p95 2890ms → after p50 1630ms / p95 1810ms.

Anything less specific is not a measurement, it's an impression.
