---
trigger: manual
description: "RN Background: Designing for the Task Not Running"
---

# Designing for the Task Not Running

The most valuable thing this agent does. Everything else is detail.

## The test question

For any background work, ask:

> **What does the user see if this does not run until they next open the app?**

Three possible answers:

- **"Nothing — it catches up on open."** Correct design. The background task is an optimisation.
- **"Slightly stale data."** Acceptable, if the UI is honest about it.
- **"The feature is broken."** The design is wrong, and no amount of background API will fix it.

The third answer is the finding. It will happen for a meaningful share of users regardless of what
you do, and it will happen silently.

## Foreground sync is the safety net

```ts
// The background task is a bonus. This is the guarantee.
useEffect(() => {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncIfStale();
  });
  void syncIfStale();
  return () => sub.remove();
}, []);
```

If `syncIfStale` exists and is correct, the background task becomes a nice-to-have and the feature
works for everyone. That single change converts most background bugs from user-visible failures
into invisible non-events.

## Say when the data is from

```tsx
{isStale && <Text>Updated {formatRelative(lastSyncedAt)}</Text>}
```

Users tolerate stale data they know about. They do not tolerate being misled. This one line is
often the difference between "the app is broken" and "the app is honest", with identical data
underneath.

## Never let the user's work depend on it

A draft, a queued message, a pending upload — none of these should require a background task to
survive. Persist immediately, sync opportunistically. See `rn-offline`, which owns the durable-queue
side of this.

The background task's job is to make the sync happen *sooner*, never to make it happen *at all*.

## Instrument whether it ran

You cannot improve what you cannot see, and background failure is silent by construction.

```ts
async function onBackgroundFetch(taskId) {
  const started = Date.now();
  try {
    await syncOneThing();
    track('background_task', { outcome: 'ok', ms: Date.now() - started });
  } catch (error) {
    track('background_task', { outcome: 'error' });
    report(error);
  } finally {
    BackgroundFetch.finish(taskId);
  }
}
```

The number that matters is not the failure rate — it is **how often the task ran at all**, compared
to how often you scheduled it. Teams are routinely surprised by that ratio. Hand the reporting side
to `rn-observability`.

## Degrade by platform, not by hope

If a feature genuinely needs reliable background execution, be honest about which platforms can
deliver it and what the user-visible fallback is elsewhere. A feature that works on one platform and
silently does not on the other is worse than one that is explicitly foreground-only.

## The redesign that usually works

When background execution is genuinely required, the answer is usually to move the trigger
server-side: the server knows something changed, sends a push, and the app syncs when it opens or
when the push wakes it. That converts "poll on a schedule the OS will not honour" into "react to an
event", which both platforms support far better.
