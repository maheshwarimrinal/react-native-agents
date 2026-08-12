---
trigger: manual
description: "RN Performance: Startup Time and Bundle Size"
---

# Startup Time and Bundle Size

Cold start is the first impression and the metric users notice most. It decomposes into:

```
process start → native init → JS bundle load → JS execute → first render → TTI
```

Measure each segment before deciding where to spend effort (`references/measurement.md`).

## Segment 1 — Native init

- **Autolinked native modules** all register at startup. Audit `package.json` for libraries you
  no longer use; each one costs registration time and binary size. TurboModules initialise
  *lazily*, so the cost is smaller than it was pre-0.76 — verify with a trace rather than
  assuming.
- **Custom Application/AppDelegate work** — analytics SDKs, crash reporters, ad SDKs, and
  feature-flag clients frequently do blocking network or disk I/O in `didFinishLaunching`.
  Defer everything that isn't needed for first paint.
- **Splash screen** — keep it up until the first meaningful screen has data, but no longer.
  `expo-splash-screen`'s `preventAutoHideAsync` / `hideAsync` should bracket real work, not a
  fixed `setTimeout`.

## Segment 2 — Bundle load and execute

### Inline requires

The biggest single lever in most apps. Instead of evaluating every module at bundle load,
modules are evaluated on first use.

```js
// babel.config.js
module.exports = {
  presets: [
    ['module:@react-native/babel-preset', { unstable_transformProfile: 'hermes-stable' }],
  ],
};
```

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config'); // or @react-native/metro-config
const config = getDefaultConfig(__dirname);
config.transformer.getTransformOptions = async () => ({
  transform: { inlineRequires: true, experimentalImportSupport: true },
});
module.exports = config;
```

Enabled by default in recent RN and Expo templates — check before "adding" it. Caveat: modules
with import-time side effects (polyfills, global registration, `i18n` setup) may need explicit
eager imports in `index.js`.

### Lazy screens

```tsx
const Settings = React.lazy(() => import('./screens/Settings'));
// with Expo Router, file-based routes are already code-split per route
```

Only worthwhile for screens users rarely reach (settings, onboarding, legal, admin). Lazily
loading the home screen just moves the cost to where it hurts more.

### Barrel files

`export * from './Button'` re-exports pull in the whole directory when you import one thing.
With inline requires the damage is reduced but circular-import risk goes up. Import from the
concrete module path in hot paths.

```bash
npx madge --circular src/    # circular imports also break inline-require laziness
```

## Segment 3 — First render

- Don't block first paint on a network request. Render a skeleton, then fill.
- Don't do synchronous storage reads at startup. `AsyncStorage` is async by design; MMKV is
  synchronous and fast, but reading 200 keys at boot still costs. Read lazily.
- Hydrating a large persisted Redux store at boot is a classic 300–800ms tax. Persist a
  whitelist, not the whole store, and consider hydrating non-critical slices after first paint.
- Font loading (`expo-font`) blocks if you await it before render. Load the critical subset,
  defer the rest.

## Bundle size

### Find the weight

```bash
npx react-native-bundle-visualizer
EXPO_UNSTABLE_ATLAS=true npx expo start && npx expo-atlas
npx knip            # unused files, exports, dependencies
npx depcheck
```

### Usual offenders and replacements

| Heavy | Lighter | Note |
|---|---|---|
| `moment` (+ locales) | `dayjs`, `date-fns`, or `Intl` | `Intl` is built into Hermes now |
| `lodash` (full) | `lodash-es` cherry-picked, or native methods | `import _ from 'lodash'` pulls everything |
| `react-native-vector-icons` (all sets) | Only the set you use, or inline SVG | Each font family is a real asset |
| Full `firebase` | Modular `@react-native-firebase/*` | Only the modules you use |
| `crypto-js` | `expo-crypto` / native | JS crypto is both big and slow |
| Full-locale `Intl` polyfills | Hermes `Intl` | Check before polyfilling |

Before removing a dependency, confirm it's actually in the bundle — `devDependencies` and
test-only imports aren't.

### App download size (what users see)

- **Android:** ship an **App Bundle (AAB)**, not a universal APK. Google Play generates
  per-device splits by ABI, density, and language. Enable R8 with shrinking:
  ```gradle
  buildTypes { release { minifyEnabled true; shrinkResources true } }
  ```
  Measure real download size with `bundletool get-size total`.
- **iOS:** App Thinning handles slicing. Check the App Thinning Size Report in the Xcode
  organiser after an archive. `Assets.xcassets` with correct @2x/@3x variants matters.
- **Assets** dominate in most apps. Compress PNGs, prefer WebP/AVIF, drop unused images, ship
  remote assets for anything not needed at first launch, and don't bundle video.
- **Hermes bytecode** is precompiled at build time — good for startup, and roughly comparable in
  size to minified JS. Don't disable Hermes to "save space".

## Source maps

Always generate and upload them to your crash reporter, and always keep them **out of the
shipped bundle**. A `.map` next to your production bundle is a gift to anyone reverse-engineering
your app (see the security agent).

## Quick audit

```bash
rg 'from .lodash.$' --type ts               # full lodash import
rg 'from .moment.' --type ts
rg "require\('\./" index.js                  # eager side-effect imports
rg 'inlineRequires' metro.config.js
rg 'minifyEnabled|shrinkResources' android/app/build.gradle
rg 'preventAutoHideAsync|hideAsync' src/     # splash bracketing
```
