# Network Detection

## The states people forget

`isConnected` answers "is there a network interface with a route". It does not answer "can I reach
my API".

| Situation | `isConnected` | Reality |
|---|---|---|
| Airplane mode | false | Offline — the only case it gets right |
| Wifi, no internet | **true** | Nothing works |
| Captive portal | **true** | Every request returns the portal's page |
| Very slow cellular | **true** | Requests hang for a minute |
| VPN reconnecting | true | Intermittent |
| API down | true | Network fine, your server is not |

Four of these report connected. Gating on `isConnected` therefore lets through the cases that fail
and, when the flag is briefly wrong, blocks the ones that would work.

```ts
// ✗ blocks a request that would have succeeded, and permits four that will not
if (!isConnected) return showOffline();
const res = await fetch(url);

// ✓ the request is the test
try {
  const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
  if (!res.ok) throw new ApiError(res.status);
} catch (e) {
  await queueForRetry(request);
  showQueuedState();
}
```

**Use detection as a hint, not a gate.** It is good for deciding when to *try* a flush of the queue,
or whether to warn before a large download. It is not good for deciding whether a request is
possible.

## `isInternetReachable` is better and still not proof

NetInfo's `isInternetReachable` performs an actual reachability check, which catches wifi-with-no-
internet. It is a genuine improvement over `isConnected` and it still does not prove your API is
reachable — different host, different path, possibly a different network policy.

```ts
const { isConnected, isInternetReachable } = useNetInfo();
const probablyOnline = isConnected && isInternetReachable !== false;
```

Note `!== false`: the value is `null` while unknown, and treating unknown as offline blocks the app
during the first moments after launch.

## Timeouts are mandatory

`fetch` has no default timeout. A request on a bad connection can hang indefinitely, and the user
watches a spinner that will never resolve. This is the single worst offline failure mode because it
has no end state.

```ts
export async function fetchWithTimeout(url: string, { timeoutMs = 15000, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

Every request needs one. Long-running uploads may need a longer value, not no value.

## Flapping

A connection that comes and goes produces repeated transitions. Code that reacts to every change —
refetching, flushing a queue, showing a banner — will thrash.

Debounce the transition, and make the reaction idempotent so running it twice is harmless.

```ts
// React to a settled state, not to every edge
const debouncedOnline = useDebouncedValue(probablyOnline, 2000);
```

## Do not show a banner you cannot substantiate

An "offline" banner driven by `isConnected` will appear while the app is working and stay hidden
while it is not. If the banner is wrong, it trains users to ignore it.

Prefer telling the truth about *what happened to their action* — "saved locally, will sync" — over a
global claim about the network. That statement is one you can actually verify.
