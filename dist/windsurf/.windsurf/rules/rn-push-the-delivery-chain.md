---
trigger: manual
description: "RN Push: The Delivery Chain"
---

# The Delivery Chain

Push failures are located, not reasoned about. Walk the chain and find the last link you can prove.

## Prove each link

**1 — Permission.** Not "we call requestPermission" — the current status.

```ts
const settings = await messaging().hasPermission();
console.log('authorization status:', settings);
```

On iOS, a user who declined months ago will never see a prompt again. Your code runs, resolves, and
grants nothing.

**2 — Token exists.**

```ts
const token = await messaging().getToken();
console.log('token:', token);
```

No token means registration failed — capabilities, entitlements, or provisioning profile.

**3 — Token reached the backend.** Query your own database for it. This is the most common break
and the easiest to skip, because the client-side code looks fine: the token was obtained, the
network call was made, and nobody checked whether the write succeeded.

**4 — Token is current.** Compare the device's token against the stored one. If they differ, refresh
handling is broken — see `handlers-and-state.md`.

**5 — A vendor console send arrives.** Send directly from the Firebase console or an APNs tool to
that exact token.

This is the highest-value test in the whole process, because it **bisects the entire system**. If
it arrives, links 1–8 are fine and the problem is in your app's handling or your backend's sending.
If it does not, your app code is irrelevant and the problem is credentials, environment, or
capabilities.

Do this before reading any JavaScript.

**6 — Your backend's send arrives.** If the console works and yours does not, the difference is in
credentials, payload, or environment.

## The environment split

The single most common "we sent it and nothing happened".

| Build | APNs environment |
|---|---|
| Debug build from Xcode | Sandbox |
| TestFlight | Production |
| App Store | Production |

A backend configured for one and a build using the other produces a response that looks like
success and delivers nothing. An APNs **key** (`.p8`) works for both environments, which is one
reason to prefer it over a certificate — it removes an entire category of this mistake.

Firebase adds a layer: the APNs key must be uploaded to the Firebase project, and the bundle id
must match in three places — the app, the key's configuration, and the Firebase iOS app.

## Reading responses honestly

A 200 from FCM or APNs means **accepted for delivery**. Not delivered. Not displayed.

What each actually tells you:

- **`200` with a message id** — accepted. Says nothing about arrival.
- **`UNREGISTERED` / `InvalidRegistration`** — the token is dead. Delete it from your database.
  Continuing to send to it is how a sending reputation degrades.
- **`SenderIdMismatch`** — the token belongs to a different Firebase project.
- **`BadDeviceToken`** — usually the sandbox/production mismatch above.
- **`TooManyRequests`** — you are being throttled.

**Handle `UNREGISTERED` by deleting the token.** A backend that keeps sending to dead tokens
accumulates them indefinitely, and the failures are invisible because nobody reads the per-message
responses.

## Delivery is never guaranteed

Even a correctly sent push to a valid token may not arrive. The device may be offline, the OS may
throttle, the user may have restricted the app, or a low-priority push may be delayed indefinitely.

Design accordingly: **push is a hint to open the app, not a data transport.** Anything that must
be correct should be fetched by the app, not carried by the notification. Treating push as reliable
delivery produces bugs that are impossible to reproduce and impossible to fix.
