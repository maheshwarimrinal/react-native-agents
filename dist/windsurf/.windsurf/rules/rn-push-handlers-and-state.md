---
trigger: manual
description: "RN Push: Handlers and App State"
---

# Handlers and App State

Three app states, three code paths. "Push doesn't work" almost always means one of them, and
knowing which narrows the problem immediately.

| State | What happens by default | Handler |
|---|---|---|
| **Foreground** | Nothing is displayed | `onMessage` — you must display it yourself |
| **Background** | OS displays it | `setBackgroundMessageHandler` for data |
| **Killed** | OS displays it | Background handler, if registered at module scope |

## The background handler must be at module scope

The single most common structural bug in React Native push.

```ts
// index.js — module scope, before AppRegistry.registerComponent
import messaging from '@react-native-firebase/messaging';

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await handleDataMessage(remoteMessage);
});
```

Registered inside a component or a `useEffect`, it does not exist when the app is killed — which is
precisely the case it was written for. The app appears to work in testing, because testing is
usually done with the app open.

## Foreground notifications are not displayed for you

Neither platform shows a notification while your app is in the foreground. If a user reports "I only
get notifications when the app is closed", this is why — and it is working as designed.

```ts
useEffect(() => {
  const unsubscribe = messaging().onMessage(async (remoteMessage) => {
    await notifee.displayNotification({
      title: remoteMessage.notification?.title,
      body: remoteMessage.notification?.body,
      android: { channelId: 'default' },
      data: remoteMessage.data,
    });
  });
  return unsubscribe;
}, []);
```

Note the cleanup. Without it, a remounted component stacks listeners and each notification is
handled several times.

## Notification versus data messages

A distinction that decides which handler runs:

- **Notification message** — has a `notification` block. The OS displays it in background/killed.
  Your background handler may not run at all.
- **Data-only message** — no `notification` block. The OS displays nothing; your handler runs and
  decides.
- **Both** — the OS displays the notification *and* passes the data.

If your background handler is not firing, check whether the backend is sending a notification block.
On iOS a data-only message also needs `content-available: 1` and the Background Modes capability, or
it will not wake the app.

## Token refresh

```ts
useEffect(() => messaging().onTokenRefresh((token) => syncToken(token)), []);
```

Tokens rotate — on reinstall, on restore to a new device, on data clear, and at the OS's
discretion. Handling only the initial token means users silently stop receiving pushes over time,
which shows up as slow decay in delivery rates rather than as a bug report.

Store tokens **per install, not per user**. One user with a phone and a tablet has two, and
overwriting one with the other silently disables push on the first device.

## Tap handling in three states

```ts
// App in background, user taps
messaging().onNotificationOpenedApp((msg) => navigateFrom(msg));

// App was killed, launched by the tap — must be checked explicitly
messaging().getInitialNotification().then((msg) => { if (msg) navigateFrom(msg); });
```

`getInitialNotification` is the one people forget. Without it, tapping a notification on a killed
app opens the home screen and the user's intent is lost — which reads as the notification being
broken.

Cold-start tap handling is also a race: the notification data is available before navigation is
mounted. Hold the pending target and consume it once the navigator is ready rather than navigating
immediately. See `deep-linking.md`.

## Badge counts

```ts
await notifee.setBadgeCount(unreadCount);
```

A badge that only increments and is never cleared is a common reason users disable notifications
entirely. Derive it from real unread state and clear it when the user has seen the content — not
when the app opens.
