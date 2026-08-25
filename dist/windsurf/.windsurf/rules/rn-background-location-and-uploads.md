---
trigger: manual
description: "RN Background: Location and Uploads"
---

# Location and Uploads

The two background categories with genuine guarantees — and the two with the most scrutiny.

## Background location

Requires its own permission, requested **after** foreground location has been granted, and both
stores review it closely. Expect to justify it.

- **Request foreground first.** Asking for background up front is a rejection risk and users decline
  it at a much higher rate.
- **Android needs `ACCESS_BACKGROUND_LOCATION`** declared and requested separately, and Play
  requires a declaration form describing the use.
- **iOS distinguishes when-in-use from always.** Escalating to always has its own prompt and the
  system periodically reminds the user your app is using it — a reminder that produces revocations
  if the value is not obvious.
- **Significant-change and geofencing are far cheaper** than continuous updates and are sufficient
  for most "notify me near X" features. Continuous tracking should be a deliberate choice with a
  visible reason.

The battery cost is real and users attribute drain to whichever app they suspect. A location
feature that drains the battery gets uninstalled regardless of how useful it is.

If the feature is "track a delivery while the user watches", that is a **foreground service** with a
visible notification, not silent background tracking. See `android-model.md`.

## Uploads that outlive the screen

A file upload started in the app and continued by the system is the strongest background mechanism
iOS offers, because the work is already in flight and the system owns it rather than your process.

**It is not unconditional.** On iOS a background `URLSession` transfer survives the app being
suspended or terminated *by the system* — and the system relaunches the app so it can collect the
result. A user force-quitting from the app switcher is different: Apple cancels the session's
transfers, and does not relaunch the app afterwards. Nothing resumes until the user opens it again.

Treat it as "very likely to finish without you", not as delivery. Concretely: keep the pending queue
on disk, reconcile it on next launch, and let the server be the thing that decides whether a file
arrived.

```ts
// The OS owns the transfer, so it survives backgrounding and system termination.
// A user force-quit still cancels it — reconcile on next launch rather than
// assuming this completed.
await BackgroundUpload.startUpload({
  url,
  path: fileUri,
  method: 'POST',
  type: 'multipart',
  notification: { enabled: true },   // Android requires visibility for long work
});
```

Three things to get right:

- **Start it while the app is in the foreground.** You cannot reliably begin new work from the
  background; you can only continue what is already running.
- **Make it resumable.** Large uploads on mobile networks fail part-way as a matter of course.
  Chunked or resumable protocols turn a failure into a pause.
- **Persist the intent first.** If the process dies before the upload is registered, the only record
  that the user asked for it must already be on disk. That is `rn-offline`'s durable queue.

## The pattern that fails

```ts
// ✗ scheduling a background task to *start* an upload later
scheduleBackgroundTask(() => uploadPendingPhotos());
```

This inverts the guarantee. The task may not run, so the upload may never start. Start the transfer
while you have the foreground and let the system carry it — then the only thing that can go wrong is
the network, which is recoverable.

## Progress and completion

Both platforms can deliver completion callbacks to a killed app, but the callback runs in a cold
context — see `what-actually-runs.md`. Write the result to storage and let the UI read it on next
open rather than assuming any in-memory state survives.

And tell the user. An upload that completed silently while the app was closed should be visible
next time they look, not silently absent.
