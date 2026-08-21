# Deep Linking from a Notification

A notification that opens the app to the home screen has failed at its job. The user tapped for a
reason and that intent is now lost.

## Put a route in the payload

```json
{
  "notification": { "title": "New message", "body": "Sam replied" },
  "data": { "type": "conversation", "id": "c_8213", "deepLink": "acme://chat/c_8213" }
}
```

Send **structured data**, not a rendered URL alone — a `type` and an `id` let the client decide how
to route, which survives changes to your URL scheme and lets the app apply its own logic (is the
user logged in, is this conversation still visible, do they have access).

## The cold-start race

The hardest case. When a tap launches a killed app, the notification data is available before the
navigation container has mounted. Navigating immediately silently does nothing.

```tsx
const pending = useRef<PushTarget | null>(null);
const [navReady, setNavReady] = useState(false);

useEffect(() => {
  messaging().getInitialNotification().then((msg) => {
    if (msg) pending.current = toTarget(msg.data);
  });
}, []);

useEffect(() => {
  if (navReady && pending.current) {
    navigate(pending.current);
    pending.current = null;
  }
}, [navReady]);

<NavigationContainer onReady={() => setNavReady(true)}>
```

The pattern generalises: **hold the intent, consume it when the destination is ready.** The same
applies to auth — a notification pointing at a screen behind a login wall must survive the login
flow rather than being dropped at the gate.

## Validate the target

A notification payload is **untrusted input**. It arrives from your server, but the path from your
server to your navigation stack is longer than it looks, and treating it as trusted is how a
notification navigates somewhere it should not.

```ts
function toTarget(data: Record<string, string> = {}): PushTarget | null {
  switch (data.type) {
    case 'conversation':
      return data.id?.startsWith('c_') ? { screen: 'Chat', params: { id: data.id } } : null;
    case 'order':
      return data.id ? { screen: 'Order', params: { id: data.id } } : null;
    default:
      return null;   // unknown types open the app normally
  }
}
```

Never pass a raw URL from a payload into a generic deep-link handler without checking it against
routes you expect. Hand anything involving authentication or account state to `rn-security`.

## Handle the unauthorised and unavailable cases

A notification may point at something the user can no longer see — a deleted message, an order
belonging to a signed-out account, content in a workspace they left. Navigating blindly produces an
error screen at the worst moment.

Route to something sensible: the relevant list, or the login screen with the target preserved for
after sign-in.

## Unify with your other deep links

Notification taps, universal links, and app links should converge on **one routing function**. Three
parallel implementations drift, and the notification path is the one nobody tests.

Platform association differs — Universal Links need `apple-app-site-association`, App Links need
`assetlinks.json` and `autoVerify` — but that is configuration, not routing logic. Hand the
configuration to `rn-navigation` and keep the resolution in one place.

## Test all three states

- **Foreground** — displayed by you, tap handled by `onMessage` flow
- **Background** — displayed by the OS, tap handled by `onNotificationOpenedApp`
- **Killed** — displayed by the OS, tap handled by `getInitialNotification`

The killed case is the one that breaks and the one nobody tests, because testing it means force
quitting the app every time. It is also the state most real users are in when a notification
arrives.
