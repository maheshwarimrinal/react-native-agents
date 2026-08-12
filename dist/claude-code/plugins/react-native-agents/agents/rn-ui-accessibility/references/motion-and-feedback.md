# Motion, States, and Feedback

## Every async surface has four states

Missing one of these is a bug report waiting to happen.

```tsx
if (isPending)      return <Skeleton />;
if (error)          return <ErrorState error={error} onRetry={refetch} />;
if (!data?.length)  return <EmptyState />;
return <Content data={data} />;
```

### Loading

- **Skeletons over spinners** for content that has a known shape. Skeletons communicate what's
  coming and avoid the layout shift that happens when a centred spinner is replaced by a list.
- **Nothing for under ~200ms.** A spinner that flashes for 80ms reads as a glitch. Delay showing
  it, or use `placeholderData: keepPreviousData` so the previous content stays.
- **Inline, not full-screen**, when only part of the screen is loading. Blanking a whole screen
  to refresh one section is jarring.
- **Announce it**: `accessibilityState={{ busy: true }}`, or the screen reader hears silence.
- **Disable the trigger** while a mutation is in flight — double submissions are a real and
  common bug on slow networks.

### Empty

An empty state is not an error. It needs: what's empty, why, and what to do about it.

```tsx
<EmptyState
  illustration={<InboxIcon />}
  title="No orders yet"
  body="When you place an order it'll show up here."
  action={<Button title="Browse products" onPress={browse} />}
/>
```

Distinguish **empty because new** ("Add your first item") from **empty because filtered** ("No
results for 'xyz'" + a clear-filters action). Same component, very different message.

### Error

- Say what happened and what to do, in plain language. "Couldn't load your orders. Check your
  connection and try again."
- Always offer a retry.
- Never show a stack trace or raw error code as the primary message. A small support reference is
  fine.
- Distinguish offline from server error — the user's action differs.

### Offline

Show it persistently (a banner), not as a one-shot toast the user might miss. Show cached content
with a "last updated" timestamp rather than an empty screen.

## Feedback for actions

Every action needs a response within ~100ms, even if the work takes longer.

| Duration | Feedback |
|---|---|
| Instant | Press state (opacity/ripple) |
| < 1s | Optimistic update or inline spinner on the control |
| 1–5s | Progress indicator, keep the UI interactive |
| > 5s | Progress with an estimate, allow backgrounding/cancel |

**Optimistic updates** for things that almost always succeed (like, favourite, reorder). Roll
back visibly and explain if they fail — a silent revert is confusing.

**Haptics** (`expo-haptics`) reinforce meaning; they don't replace it:

```ts
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);        // selection, toggle
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);  // completed action
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);    // failed action
```

Use sparingly — haptics on every tap becomes noise and drains battery. Respect the system
setting; on Android check vibration permission.

**Toasts** for confirmation that doesn't need action. Not for errors that need a decision — those
need an inline message or a dialog. Toasts must be announced to screen readers and must not be
the only way to learn something important.

## Motion

Motion should explain a change, not decorate it. Every animation answers "where did this come
from / go to?"

| Purpose | Duration |
|---|---|
| Micro-interaction (press, toggle) | 100–150ms |
| Standard transition (fade, slide) | 200–300ms |
| Large / full-screen | 300–400ms |

Longer than ~400ms feels sluggish once the novelty wears off, and it's worst for power users who
see it a hundred times a day.

**Easing:** ease-out for entering (fast start, gentle settle), ease-in for exiting. Linear only
for continuous motion like a progress bar or a loop. Spring physics feel better than duration
curves for anything gesture-driven, because they carry velocity:

```tsx
offset.value = withSpring(target, { damping: 15, stiffness: 150, mass: 1 });
```

**Run on the UI thread.** See the performance agent — a JS-thread animation drops frames whenever
anything else happens.

### Reduce motion

```tsx
const reduceMotion = useReducedMotion();

// Replace movement with a cross-fade, don't just shorten it
const style = useAnimatedStyle(() =>
  reduceMotion
    ? { opacity: withTiming(visible ? 1 : 0, { duration: 150 }) }
    : { transform: [{ translateY: withSpring(visible ? 0 : 40) }], opacity: withTiming(visible ? 1 : 0) },
);
```

Under reduce-motion: no parallax, no auto-advancing carousels, no large slide or zoom transitions,
no looping background animation. Vestibular disorders make these genuinely nauseating.

### Layout animations

```tsx
<Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut} layout={LinearTransition} />
```

Reanimated's layout animations handle list insert/remove/reorder cleanly. Prefer them to
`LayoutAnimation`, which is unreliable on Fabric.

Don't animate list item mounts during scroll — items entering the window will animate on every
scroll, which looks broken and costs frames.

## Gestures

- Follow platform conventions: swipe-back from the left edge on iOS, hardware/gesture back on
  Android. Don't break either.
- Any gesture-only action needs a visible alternative — gestures are undiscoverable and
  inaccessible to switch-control and screen-reader users.
- Give affordances: a drag handle, a peeking edge, a hint animation on first use.
- Gestures should be interruptible and follow the finger 1:1, with velocity carried into the
  release animation. A gesture that snaps to a fixed animation on release feels dead.

## Pull-to-refresh

```tsx
<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.textSecondary} />
```

Set `tintColor` / `colors` from the theme or the spinner is invisible in dark mode — a very
common oversight.

## Audit grep

```bash
rg 'isLoading|isPending' --type tsx -A 8 | rg -c 'Empty|empty'
rg 'ActivityIndicator' --type tsx -c                    # spinners where skeletons belong?
rg 'RefreshControl' --type tsx -A 3 | rg -v 'tintColor|colors'
rg 'useReducedMotion|isReduceMotionEnabled' --type tsx -c
rg 'duration:\s*([5-9][0-9]{2}|[0-9]{4,})' --type tsx   # animations over 500ms
rg 'Haptics\.' --type tsx -c
rg 'onPress' --type tsx -A 4 | rg -c 'disabled'         # double-submit protection
```
