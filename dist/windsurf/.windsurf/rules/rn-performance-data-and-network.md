---
trigger: manual
description: "RN Performance: Data and Network Performance"
---

# Data and Network Performance

On a phone, the network is slow, unreliable, and expensive. Most "the app feels slow" complaints
are really "the app waits on the network badly".

## Request waterfalls

The most common structural problem: requests that could run in parallel run in sequence because
each depends on the previous render.

```tsx
// ✗ three round trips in series — 3× latency
const user = useQuery(['user'], fetchUser);
const org = useQuery(['org', user.data?.orgId], fetchOrg, { enabled: !!user.data });
const perms = useQuery(['perms', org.data?.id], fetchPerms, { enabled: !!org.data });

// ✓ one round trip: ask the backend for what the screen needs
const screen = useQuery(['dashboard'], fetchDashboardBundle);
```

If you can't change the backend, at least parallelise what's independent (`Promise.all`,
`useQueries`) and start the fetch before render (prefetch on the previous screen or on route
focus intent).

## Use a server-state library

Hand-rolled `useEffect` + `fetch` + `useState` re-implements caching, dedupe, retry,
cancellation, and staleness — badly. TanStack Query (or SWR, or RTK Query) gives you:

- **Request deduplication** — five components asking for the same key produce one request.
- **Cache with staleness** — instant render from cache, background refetch.
- **Automatic cancellation** on unmount.
- **Retry with backoff** and offline awareness.
- **Pagination / infinite queries** with correct cache keys.

```tsx
const { data } = useQuery({
  queryKey: ['feed', page],
  queryFn: fetchFeed,
  staleTime: 60_000,          // don't refetch for a minute
  gcTime: 5 * 60_000,         // then evict
  placeholderData: keepPreviousData,   // no spinner flash on page change
});
```

Watch for `staleTime: 0` (the default) combined with `refetchOnWindowFocus`/`refetchOnMount` —
on mobile this produces a refetch storm every time the user tabs around.

## Payload size and parsing

- **Ask for less.** Field selection (GraphQL, sparse fieldsets, `?fields=`) beats compression.
- **Paginate everything.** A list endpoint with no limit is a bug waiting for a power user.
- **`JSON.parse` on a multi-megabyte payload blocks the JS thread** for hundreds of milliseconds.
  If you must handle big payloads, paginate, stream, or parse off the JS thread
  (`react-native-worklets-core`, or a native module).
- **Enable gzip/brotli** server-side. Both platforms handle it transparently.
- Don't base64 binary data into JSON — it inflates by 33% and costs decode time.

## Caching layers

| Layer | Tool | Note |
|---|---|---|
| HTTP | `Cache-Control`, `ETag` | Free; both platforms honour it. Frequently unset by backends. |
| Query cache | TanStack Query | In-memory, per session |
| Persisted cache | `@tanstack/query-async-storage-persister` + MMKV | Survives restart — huge for perceived startup speed |
| Offline DB | WatermelonDB, Realm, op-sqlite, Drizzle+SQLite | For genuinely offline-first apps |

Persisting the query cache to MMKV and hydrating at boot is one of the highest
perceived-performance wins available: the app opens with content instead of spinners.

## Storage engine

- `AsyncStorage` — async, fine for small values, slow for many keys or large blobs.
- `react-native-mmkv` — synchronous, memory-mapped, ~30× faster. Good default for settings and
  cache. Supports encryption (see the security agent).
- **SQLite** (op-sqlite, expo-sqlite) — for relational or large data. Do queries off the main
  thread and index your columns.
- Never store large blobs in `AsyncStorage`; use the filesystem.

## Realtime

- WebSocket / SSE beats polling for anything that updates more than once a minute.
- Throttle high-frequency messages before they hit React state — 60 messages/second becomes 60
  re-renders/second. Batch into an interval, or push into a shared value.
- Disconnect on background (`AppState`) and reconnect with backoff on foreground; a socket
  hammering reconnects in the background drains battery and gets your app killed.

## Offline and flaky networks

- `@react-native-community/netinfo` for connectivity, but don't trust it as a reachability
  oracle — captive portals report "connected".
- Retries need exponential backoff and jitter, and a cap. Naive `retry: 3` on a timeout triples
  the user's wait.
- Set explicit timeouts. `fetch` has no default timeout — a request can hang indefinitely.
  ```ts
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 10_000);
  try { return await fetch(url, { signal: c.signal }); } finally { clearTimeout(t); }
  ```
- Queue mutations while offline and replay them with idempotency keys.

## Audit grep

```bash
rg 'useEffect' -A 8 --type tsx | rg 'fetch\(|axios\.'      # hand-rolled data fetching
rg 'fetch\(' --type ts -A 3 | rg -v 'signal'                # no timeout / cancellation
rg 'JSON\.parse' --type ts
rg 'setInterval' --type ts -B 2 -A 2 | rg -i 'poll|refresh|fetch'
rg 'staleTime|refetchOnWindowFocus|refetchInterval' --type ts
rg 'AsyncStorage\.(set|get)Item' --type ts                  # candidates for MMKV
```
