# What Actually Runs

Pick the mechanism by what the work *is*. Most background bugs start as the wrong choice here.

| The work | Mechanism | Runs? |
|---|---|---|
| Refresh content for next open | iOS BGAppRefresh / Android WorkManager periodic | Sometimes, on the OS's schedule |
| Longer processing, deferrable | iOS BGProcessing / WorkManager | Usually when charging and idle |
| Finish an upload started in-app | Background upload session | Reliably, it is already in flight |
| Active navigation, playback, workout | Foreground service / iOS background mode | Yes — with a visible notification |
| React to a server event | Push notification | Best-effort delivery |
| At a specific time | Local notification | Yes — but it notifies, it does not run code |
| Continuous location | Background location + permission | Yes, with scrutiny and battery cost |

**The most useful row is the last-but-one.** A great deal of work scheduled as a background task is
really "tell the user something at a time", which a local notification does reliably and cheaply.
Scheduling a task to then post a notification is strictly worse: the notification only appears if
the task ran.

## The guarantee gradient

From most to least reliable:

1. **Work already in flight** — a background upload session continues even if the app is killed.
2. **User-visible ongoing work** — foreground service or an iOS background mode. Reliable because
   the user can see it and stop it.
3. **Push-triggered** — best-effort; both platforms throttle, and low-priority pushes can be
   delayed indefinitely.
4. **Scheduled periodic work** — genuinely discretionary. Influenced by battery, charging, usage
   patterns, and how recently the user opened your app.
5. **Anything on an aggressively-managed Android device** — several OEMs apply their own restriction
   layers beyond stock Android.

Design so that the important thing sits as high on this list as possible.

## Cold start is the normal case

A headless task starts with **no warm JS runtime, no navigation, no store, no React tree**. Code
that reaches for a context, a hook, or module state populated during app startup will fail — and
fail silently, because nobody is watching.

Background entry points should be self-contained: read what they need from storage, do one thing,
write the result, exit.

## The time budget

iOS gives a background refresh task a small window and expects the completion handler to be called.
Overrunning has a compounding cost — the system deprioritises apps that misbehave, so a task that
takes too long today runs less often tomorrow.

```ts
// Always call it, on every path.
async function onBackgroundFetch(taskId) {
  try {
    await syncOneThing();          // one thing, not everything
  } catch (error) {
    report(error);
  } finally {
    BackgroundFetch.finish(taskId);  // never skip this
  }
}
```

The `finally` is the load-bearing part. A thrown error that skips `finish()` is worse than the
error itself.

## Do one thing

Background windows are short and may be cut off. A task that syncs everything will be killed
part-way and achieve nothing; a task that syncs the single most valuable thing will usually
complete.

Prefer many small idempotent units over one large one, and make each safe to run twice.
