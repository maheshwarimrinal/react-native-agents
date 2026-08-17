# Network and Async Bugs

## Requests that silently fail

`fetch` does not throw on HTTP error status. A 404 or a 500 resolves normally, and code that only
catches rejections treats it as success.

```ts
// ✗ a 500 lands in the success path
const res = await fetch(url);
const data = await res.json();

// ✓
const res = await fetch(url);
if (!res.ok) throw new ApiError(res.status, await res.text());
const data = await res.json();
```

The symptom is a screen rendering empty or with defaults, no error state, and nothing in the
console.

## Unhandled rejections

A promise rejection with no `catch` may produce nothing visible in release. An async function
called without `await` and without `.catch()` fails invisibly.

```ts
// ✗ fire-and-forget: if it rejects, nothing anywhere reports it
syncUserData();

// ✓ deliberate
void syncUserData().catch((e) => report(e));
```

Audit for it:

```bash
rg -n "^\s*[a-zA-Z_$][\w.]*\([^)]*\);?\s*$" --glob "**/*.{ts,tsx}" | rg -i "sync|fetch|load|save|upload|refresh"
```

## Platform network differences

An Android-only network failure that works on iOS is usually one of:

- **Cleartext HTTP blocked** — Android blocks it by default. Check `android:usesCleartextTraffic`
  and `network_security_config.xml`.
- **Certificate pinning** rejecting a certificate rotation.
- **Localhost** — `localhost` on an Android emulator is the emulator itself, not your machine. Use
  `10.0.2.2`.
- **Self-signed certificates** in staging, trusted on one platform and not the other.

## Races

The classic: two requests in flight, the slower one started first, and it resolves last and
overwrites the newer result. The user sees stale data, intermittently, and only when the network is
uneven.

```ts
// ✓ ignore a response whose request has been superseded
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal })
    .then((r) => r.json())
    .then(setData)
    .catch((e) => { if (e.name !== 'AbortError') report(e); });
  return () => controller.abort();
}, [url]);
```

If the code uses a server-state library, this is handled for you — which is a good reason to prefer
one over hand-rolled effects for data fetching.

## Bugs that only appear on slow networks

Test on a throttled connection deliberately. Development on fast wifi hides an entire class of bug:
missing loading states, double submissions from an un-disabled button, timeouts that are too
aggressive, and any race whose window is normally too small to hit.

Both platforms have throttling tools — Network Link Conditioner on iOS, the emulator's network
settings on Android. Use them before release, not after a user reports it.

## Backgrounding

An app backgrounded mid-request behaves differently per platform, and iOS may suspend the process
entirely. Requests that were in flight may never resolve, and their `finally` blocks may never run.
If cleanup or a loading flag lives only in `finally`, the app can return to the foreground stuck in
a loading state — which is a bug users hit constantly and teams reproduce rarely, because nobody
backgrounds the app during testing.
