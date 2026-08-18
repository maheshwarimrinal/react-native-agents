---
trigger: manual
description: "RN Platform Parity: Styling Differences"
---

# Styling Differences

## Shadows

The most frequent cosmetic divergence, and it is one-directional: iOS shadow props do nothing on
Android.

```tsx
// ✗ renders flat on Android — no error, no warning
card: {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.2,
  shadowRadius: 4,
}

// ✓ both
card: {
  ...Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
    },
    android: { elevation: 4 },
  }),
}
```

They are not equivalent controls. `elevation` is a single number driving a Material shadow — you
cannot match an iOS shadow exactly, and trying to produces worse results than accepting each
platform's idiom.

`elevation` also affects **stacking order** on Android, independently of `zIndex`. An element with
higher elevation can render above one with higher `zIndex`, which produces overlay bugs that make
no sense if you are only thinking about `zIndex`.

```bash
rg -n "shadowColor|shadowOffset|shadowRadius|shadowOpacity" --glob "**/*.{js,jsx,ts,tsx}" -A4 | rg -B4 -v "elevation"
```

## Text

- **Line height** is applied differently; text vertically centred on one platform may sit slightly
  off on the other. Tight layouts and single-line buttons are where this shows.
- **Font weights** — the numeric range is fully supported on iOS; older Android versions collapse
  intermediate weights, so 500 and 600 may render identically.
- **Custom fonts** are linked differently, and the family name that works on one platform is often
  not the one Android expects. A font that silently falls back to the system default is the usual
  symptom.
- **`includeFontPadding: false`** is Android-only and is frequently needed to make text align the
  way the design intends.
- **Truncation** metrics differ, so a label that fits on one platform may ellipsize on the other.

## Borders and radii

- `borderRadius` larger than half the element behaves differently at the extremes.
- Individual corner radii are supported on both, but combined with `overflow: 'hidden'` the
  clipping differs.
- `borderStyle: 'dashed'` and `'dotted'` render inconsistently and are best avoided where precision
  matters.

## StatusBar

```tsx
<StatusBar
  barStyle="dark-content"                                    // both
  backgroundColor={Platform.OS === 'android' ? '#fff' : undefined}  // Android only
  translucent={Platform.OS === 'android'}
/>
```

`backgroundColor` is ignored on iOS. Translucency is the default on iOS and opt-in on Android, and
with `translucent` your content renders behind the status bar — which needs the safe-area top inset
to compensate. Setting translucent without adjusting padding puts your header under the clock.

## Colours and theming

`PlatformColor` gives you real system colours, which respond correctly to dark mode and
accessibility settings. Hardcoded hex values do not.

Dark mode is a system setting on both platforms, but the timing of the change event and the
behaviour while backgrounded differ. Anything that caches a resolved colour rather than reading it
per render can end up with a stale theme after a system switch.
