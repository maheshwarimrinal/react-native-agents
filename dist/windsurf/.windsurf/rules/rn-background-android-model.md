---
trigger: manual
description: "RN Background: Android"
---

# Android

Android's model has two layers: the platform's own restrictions, and whatever the manufacturer
added on top. The second layer is the one that surprises teams, because it does not appear in any
documentation and varies by device.

## WorkManager is the answer for deferrable work

It handles Doze, App Standby buckets, process death, reboots, and API-level differences. Anything
that must survive those should go through it rather than through alarms or raw services.

Two things to internalise:

- **Periodic work has a platform minimum interval**, and asking for less does not get you less.
- **Constraints are how you get scheduled at all.** Work that requires charging and an unmetered
  network runs far more predictably than unconstrained work, because it aligns with what the system
  wants to do anyway.

## Doze and App Standby

When the device is idle, work is batched into maintenance windows. When a user rarely opens your
app, it moves into a more restricted standby bucket and gets less. Both are the system doing its
job, and both mean your task runs less often than you scheduled it.

The pattern is the same as iOS: **the users who open your app least get the least background
execution**.

## Foreground services need a declared type

Apps **targeting SDK 34 or higher** must declare a foreground service type in the manifest, and the
declared type must match what the service does. A missing or mismatched type throws at runtime
rather than warning.

Separately — and this is a distinct outcome, not the same one — Play reviews foreground-service
usage against its policy. A type that is technically valid can still be rejected if the use does not
justify it. Treat "will it run" and "will it be approved" as two questions.

```xml
<service
  android:name=".SyncService"
  android:foregroundServiceType="dataSync"
  android:exported="false" />
```

A foreground service also requires a persistent notification the user can see and act on. That is
the trade: reliability in exchange for visibility. Legitimate for navigation, playback, an active
workout, or a large user-initiated upload. Not legitimate for polling, and using it that way is
both a rejection risk and a battery complaint.

## OEM battery managers

Several manufacturers apply restrictions beyond stock Android — killing background work, ignoring
alarms, and in some cases requiring the user to grant an app-specific exemption buried in settings.
Behaviour differs by manufacturer and by version.

The practical consequences:

- **Testing on one flagship proves nothing** about the fleet.
- If reports of missing background work cluster on particular brands, this is the likely cause and
  it is largely outside your control.
- Asking users to whitelist your app is a poor experience and many will not.

Design so the feature degrades rather than breaks — see `designing-for-failure.md`.

## Battery optimisation exemptions

`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` exists, and Play restricts which app categories may use it.
Requesting it without a qualifying use is a policy violation, and even when granted, several OEM
layers do not honour it.

Treat it as a last resort for a genuinely qualifying feature, not as a fix for unreliable syncing.

## Headless JS

```js
// index.js — module scope, before AppRegistry.registerComponent
AppRegistry.registerHeadlessTask('SyncTask', () => require('./src/tasks/sync').default);
```

Registered anywhere else it does not exist when the task fires. The task runs with a cold runtime
and no UI, and must return a promise that settles — an unsettled promise holds the process open and
is eventually killed.

## Permissions and exact alarms

Exact alarms require a specific permission on recent versions and are intended for user-facing
scheduled events like alarms and calendar reminders. Using them for periodic sync is both a misuse
and a rejection risk.

```bash
rg -n "uses-permission|foregroundServiceType" android/app/src/main/AndroidManifest.xml
rg -n "merged_manifests" -l android/app/build/intermediates 2>/dev/null | head -1
```

Check the **merged** manifest — libraries add permissions and services you did not declare.
