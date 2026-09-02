# Layout Animations and the CSS API

Two ways to animate without writing a shared value at all. Both are cheaper to
write than a `useAnimatedStyle`, and both have edges worth knowing.

## Entering and exiting

```tsx
import Animated, { FadeIn, FadeOutLeft, LinearTransition } from 'react-native-reanimated';

<Animated.View
  entering={FadeIn.duration(200)}
  exiting={FadeOutLeft.duration(150)}
  layout={LinearTransition}
/>
```

Modifiers chain: `.duration(ms)`, `.delay(ms)`, `.easing(fn)`, `.springify()`,
`.damping(n)`, `.withCallback(finished => …)`.

`layout` animates a component's *position and size* when the surrounding layout
changes — the thing that otherwise snaps.

## The trap: lists keyed by index

Entering and exiting animations fire on **mount** and **unmount**, and React
decides which is which from the `key`. With an index key, the key set is always
`0..n-1` — so what changes on a deletion is only the *length*.

Delete `b` from `[a, b, c, d]` and the result is keyed `0,1,2`. React sees keys
0, 1 and 2 on both sides, reuses those three components in place with new props,
and unmounts only key 3. So:

- **`b` never plays its exiting animation.** It was never unmounted — its
  component was reused to render `c`.
- **`d` plays the exiting animation instead**, at the bottom of the list, which
  is nowhere near what the user deleted.
- **The tail does not re-enter.** Positions 1 and 2 are updated, not remounted,
  so their content swaps instantly with no transition at all.

Insertion is the mirror image: prepend `z` to `[a, b, c]` and key 3 is the new
one, so the *last* row plays the entering animation while `z` appears at the top
with none.

```tsx
// ✗ the wrong row animates, and the row that changed does not
{items.map((item, i) => (
  <Animated.View key={i} entering={FadeIn} exiting={FadeOut} layout={LinearTransition} />
))}

// ✓ identity follows the data, so the animation lands on the row that moved
{items.map((item) => (
  <Animated.View key={item.id} entering={FadeIn} exiting={FadeOut} layout={LinearTransition} />
))}
```

This is the single most common layout-animation bug, and it reads as "Reanimated
animates the wrong row" rather than as a keying mistake. The same reuse also
carries component state — a half-open swipe or a running spring — across to
whichever item now occupies that position.

For virtualised lists, see the library's list layout-animation guidance — a
recycling list has its own rules, because a "new" row may be a reused one.

## Entry/exit transitions

`combineTransition` was removed in Reanimated 4. The replacement:

```tsx
EntryExitTransition.entering(FadeIn).exiting(FadeOut)
```

## CSS animations and transitions (Reanimated 4)

Reanimated 4 added a declarative API modelled on CSS. It works alongside shared
values — you can adopt it incrementally, and mix both in one app.

```tsx
<Animated.View
  style={{
    transitionProperty: 'opacity',
    transitionDuration: 200,
  }}
/>
```

```tsx
<Animated.View
  style={{
    animationName: {
      from: { opacity: 0, transform: [{ scale: 0.9 }] },
      to: { opacity: 1, transform: [{ scale: 1 }] },
    },
    animationDuration: 300,
    animationIterationCount: 1,
  }}
/>
```

Reach for it when the animation is a **property changing over time with no
interaction driving it** — a fade-in, a colour change on state, a pulse. Reach
for shared values when a *gesture or scroll position* drives the value, because
that is a continuous input the CSS API has no way to read.

Not everything is animatable. Check the library's supported-properties list
rather than assuming a style property works; an unsupported one fails quietly
rather than loudly.

## Spring behaviour changed in Reanimated 4

If you are porting spring configs, three things moved at once:

- `restDisplacementThreshold` and `restSpeedThreshold` were replaced by a single
  **`energyThreshold`**, which is relative rather than absolute. Removing the
  old two is usually sufficient — you rarely need to set the new one.
- **`duration` is now perceptual.** The animation actually takes about 1.5× it.
  To reproduce previous timing, divide your old value by 1.5.
- **The defaults changed.** If you relied on them, import
  `Reanimated3DefaultSpringConfig` (or
  `Reanimated3DefaultSpringConfigWithDuration`) rather than trying to
  reconstruct them.

## Reduced motion

`reduceMotion` is a system accessibility setting. For some users, large motion
causes nausea — this is not a stylistic preference.

```tsx
const reduceMotion = useReducedMotion();

<Animated.View entering={reduceMotion ? undefined : SlideInRight} />
```

Honour it for anything that moves a large area, spins, parallaxes or flashes.
A short cross-fade is usually an acceptable substitute for a large translation;
removing feedback entirely is not, because the user still needs to know
something changed.

## Auditing

```bash
# Index-keyed lists — the animation lands on the wrong row
rg -n "entering=" -B 3 --glob "**/*.{tsx,jsx}" | rg "key=\{(i|idx|index)\}"

# Removed in Reanimated 4
rg -n "combineTransition" --glob "**/*.{ts,tsx,js,jsx}"

# Spring configs carrying the removed thresholds
rg -n "restDisplacementThreshold|restSpeedThreshold" --glob "**/*.{ts,tsx,js,jsx}"

# Motion with no reduced-motion path anywhere in the file
rg -ln "entering=|withRepeat|SlideIn|ZoomIn" --glob "**/*.{tsx,jsx}" \
  | xargs -I{} sh -c 'rg -q "useReducedMotion|ReducedMotionConfig" {} || echo {}'
```
