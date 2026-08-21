# The Read Path

Failed reads are the recoverable half. The user sees stale or missing data; nothing of theirs is
lost. Get this right and most of the app keeps working on a bad connection.

## Cache first, then revalidate

```ts
// Serve what we have immediately, refresh in the background
const { data, isStale } = useQuery({
  queryKey: ['orders', userId],
  queryFn: fetchOrders,
  staleTime: 60_000,
  gcTime: 24 * 60 * 60 * 1000,
});
```

A server-state library handles this better than hand-rolled effects, and it is worth recommending
for that reason alone: caching, deduplication, background refetch, and retry are all things people
implement badly by hand. Hand the state-architecture question to `rn-state`.

## Persist the cache, or it dies with the process

An in-memory cache is empty on every cold start, which is exactly when offline matters — the user
opened the app on a train.

Persist to storage, with a version so a schema change does not resurrect data your code can no
longer read:

```ts
persistQueryClient({
  persister: createAsyncStoragePersister({ storage: AsyncStorage }),
  buster: CACHE_SCHEMA_VERSION,   // bump to discard everything
  maxAge: 24 * 60 * 60 * 1000,
});
```

Two things to decide deliberately: **what not to persist** — anything sensitive should be excluded
rather than written to disk unencrypted — and **a maximum age**, so genuinely ancient data is
discarded rather than shown.

## Carry the age with the data

The user can accept stale data if they know it is stale. They cannot accept being misled.

```tsx
{isStale && <Text>Last updated {formatRelative(dataUpdatedAt)}</Text>}
```

This one line converts "the app is showing wrong prices" into "the app is showing me yesterday's
prices and told me so". The data is identical; the trust is not.

## Distinguish empty from unknown

```tsx
// ✗ conflates "no orders" with "we could not load orders"
if (!orders?.length) return <EmptyState>No orders yet</EmptyState>;

// ✓
if (isError && !data) return <ErrorState onRetry={refetch} />;
if (!orders.length)   return <EmptyState>No orders yet</EmptyState>;
```

Telling a user with a hundred orders that they have none is a serious bug, and it is a
one-conditional mistake that reviewers rarely flag.

## Pagination and offline

An infinite list backed by a cache that only holds page one will jump the user to the top when they
return. Persist the pages they had, or restore their position deliberately.

Requesting page five while offline should not clear pages one to four.

## Images

Images are usually the largest offline gap — the text renders and the screen is full of grey boxes.

`expo-image` caches by default. For anything the user should be able to see offline — their own
photos, a downloaded article — cache deliberately rather than relying on an HTTP cache you do not
control.

## Prefetch with restraint

Prefetching what the user will likely need next is the difference between a usable offline app and
a broken one. It also spends data and battery, and on a metered connection that is a real cost to
someone.

Prefetch what is small, likely, and valuable. Do not sync the entire dataset on launch because it
is simpler.
