---
trigger: manual
description: "RN Background: iOS"
---

# iOS

Apple's model is a budget, not a schedule. The system decides when — and whether — to run your
task, based on how the user actually uses your app.

## Declare the modes, or nothing runs

`Info.plist` must declare `UIBackgroundModes` for the categories you use — background fetch,
processing, remote notifications, location, audio, and so on. Without the declaration the API
silently does nothing.

```bash
rg -n "UIBackgroundModes" -A8 ios/*/Info.plist
```

Declaring modes you do not genuinely use is a review rejection, so this is a place to be exact
rather than generous.

For Expo, declare through config rather than editing the plist, or a prebuild overwrites it.

## Scheduling is discretionary

You register a task and request that it run no earlier than some point. The system then decides,
weighing battery, charging state, network, Low Power Mode, and — importantly — **how often the user
opens your app**.

The practical consequence is a feedback loop worth understanding: apps the user opens frequently
get scheduled more; apps they rarely open get scheduled rarely. So background refresh is least
reliable for exactly the users you most wanted it for.

The user can also disable Background App Refresh globally or per-app, and many do.

## Call the completion handler

Every task must tell the system it finished, including on the error path. An overrun or a missed
completion is remembered and reduces future scheduling.

Treat the budget as seconds, not minutes, and structure the work so partial progress is still
useful.

## Silent pushes are throttled

`content-available: 1` wakes the app to do a little work, and is genuinely useful — but the rate is
limited by heuristics you cannot inspect, and low-priority pushes may be delayed indefinitely. It
is a hint that something changed, not a scheduler. See `rn-push`.

## What survives termination, and what a force-quit cancels

A user force-quitting from the app switcher stops background activity for that app until they open
it again, on most task types. This is deliberate and not something to design around — it is the
user saying stop.

**Background URL sessions survive more than anything else here, but not force-quit.** The two kinds
of termination behave differently, and conflating them is how teams end up promising delivery they
cannot make:

| The app is… | Transfers | On relaunch |
|---|---|---|
| suspended or terminated **by the system** | continue in the system's process | relaunched automatically; recreate the session with the same identifier to collect results |
| force-quit **by the user** from the app switcher | **cancelled** | no automatic relaunch — the user must open the app before anything resumes |

So "the OS finishes it for you" holds for the ordinary case, which is a real and useful guarantee:
memory pressure, a reboot, or the system reclaiming your process will not lose the transfer. It does
not hold when the user swipes the app away, and Apple is explicit that the system will not relaunch
a force-quit app on its own.

Design for it: keep the queue durable on disk, reconcile on next launch, and never treat "handed to
`URLSession`" as "delivered". See `location-and-uploads.md`.

## Testing

The simulator does not reproduce real scheduling. Xcode can trigger a background task on demand,
which verifies your code path but tells you nothing about frequency.

For frequency, the only honest test is a real device, used normally, over days — and instrumenting
whether the task ran, because otherwise you cannot tell. Hand that to `rn-observability`.

## Version-specific behaviour

Restrictions have tightened across successive iOS releases and continue to. Where behaviour depends
on a specific version, say which, or say you are not certain — a confident claim about a threshold
that changed is worse than an acknowledged gap, because it will be designed around.
