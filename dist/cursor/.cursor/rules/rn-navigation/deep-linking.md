# Deep Linking

Three separate things must work, and they fail differently.

1. **Native association** — the OS decides your app should handle the URL.
2. **Route resolution** — the URL maps to a screen and params.
3. **Timing** — the navigator exists when you try to use it.

## Native association is configuration, not code

| | iOS | Android |
|---|---|---|
| Mechanism | Universal Links | App Links |
| App side | `associatedDomains` entitlement | `intent-filter` with `android:autoVerify="true"` |
| Server side | `/.well-known/apple-app-site-association` | `/.well-known/assetlinks.json` |
| Requirements | HTTPS, no redirects, correct content type, no file extension | HTTPS, no redirects, SHA-256 cert fingerprint |
| Verified | On install | On install |

**The symptom of a missing association is that the link opens in the browser.** This is routinely
diagnosed as a JS routing problem, and hours are lost in the app before anyone checks the server
file — which is where it almost always is.

Two details that cause silent failure: the iOS file must be served with **no file extension** and
must not redirect (a redirect from `http` to `https`, or from apex to `www`, breaks it), and the
Android fingerprint must match the certificate the app was **actually signed with** — which for
Play App Signing is Google's certificate, not your upload key. That last one catches almost
everyone once.

```bash
curl -sI https://example.com/.well-known/apple-app-site-association | head -5
curl -s  https://example.com/.well-known/assetlinks.json | head -20
```

Verify against the deployed site, not the repository.

## Custom schemes are not a substitute

`myapp://` always works and has no verification, which is exactly the problem: any app can claim
your scheme. Use it as a fallback, never for anything security-relevant, and never as the primary
mechanism for links you send by email or SMS.

## Route resolution

```tsx
const linking = {
  prefixes: ['https://acme.com', 'acme://'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          HomeStack: { screens: { Home: '', Order: 'order/:id' } },
        },
      },
      NotFound: '*',
    },
  },
};
```

Keep a **catch-all**. Without one, an unrecognised URL — an old link, a marketing typo, a route you
removed — does nothing at all, and the user sees the app open to nowhere.

## The cold-start race is the bug

When a link launches a killed app, the URL is available before the navigation container mounts.
Navigating immediately silently does nothing, and this is the single most common deep-link bug.

```tsx
const pending = useRef<string | null>(null);
const [ready, setReady] = useState(false);

useEffect(() => {
  Linking.getInitialURL().then((url) => { if (url) pending.current = url; });
  const sub = Linking.addEventListener('url', ({ url }) => handle(url));
  return () => sub.remove();
}, []);

useEffect(() => {
  if (ready && pending.current) {
    handle(pending.current);
    pending.current = null;
  }
}, [ready]);

<NavigationContainer onReady={() => setReady(true)}>
```

`getInitialURL` covers the cold start; the `url` listener covers a link arriving while the app runs.
**Both are needed** and handling only one produces a bug in exactly half the cases.

## Params are untrusted

A deep link is external input. It may be crafted, stale, or point at something the user cannot
access.

```ts
function toTarget(url: string): Target | null {
  const { hostname, path } = parse(url);
  if (hostname !== 'acme.com') return null;

  const m = /^\/order\/([A-Za-z0-9_-]{6,32})$/.exec(path ?? '');
  return m ? { screen: 'Order', params: { id: m[1] } } : null;
}
```

Validate shape before navigating, and never pass a URL from a link into anything that fetches,
redirects, or renders it without checking. Hand anything auth-adjacent to `rn-security`.

## Test the state that breaks

- App running, foreground — easiest, usually works
- App backgrounded — usually works
- **App killed** — where it breaks

```bash
npx uri-scheme open "https://acme.com/order/123" --ios
adb shell am start -W -a android.intent.action.VIEW -d "https://acme.com/order/123" <applicationId>
```

Force quit the app before each test, or you are testing the case that already works.
