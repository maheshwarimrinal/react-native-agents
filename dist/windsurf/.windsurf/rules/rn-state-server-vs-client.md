---
trigger: manual
description: "RN State: Server State Is Not Client State"
---

# Server State Is Not Client State

The single highest-leverage distinction in the whole state layer.

| | Client state | Server state |
|---|---|---|
| Owner | You | The server |
| Can go stale | No | **Constantly** |
| Needs caching | No | Yes |
| Needs refetching | No | Yes |
| Shared across devices | No | Yes |
| Examples | Theme, filters, form drafts, onboarding step | Users, orders, messages, products |

Server state is a **cache of something you do not control**. Treating it as ordinary state means
hand-implementing caching, invalidation, deduplication, retry, and background refresh — badly,
because those are hard and nobody set out to write them.

## What it looks like when it goes wrong

```ts
// A store full of server state and hand-rolled cache machinery
const useStore = create((set) => ({
  orders: [],
  ordersLoading: false,
  ordersError: null,
  ordersLastFetched: null,

  fetchOrders: async () => {
    set({ ordersLoading: true });
    try {
      const orders = await api.getOrders();
      set({ orders, ordersLoading: false, ordersLastFetched: Date.now() });
    } catch (e) {
      set({ ordersError: e, ordersLoading: false });
    }
  },
}));
```

Repeat per entity. Each one needs invalidation on mutation, deduplication of concurrent calls,
refetch on focus, retry, and a stale check — none of which are here, all of which will be added
inconsistently over the next year.

## What it looks like when it does not

```ts
const { data: orders, isPending, error } = useQuery({
  queryKey: ['orders'],
  queryFn: api.getOrders,
  staleTime: 60_000,
});
```

Caching, deduplication, background refetch, retry, and focus behaviour come with it. The store
shrinks to what is genuinely client state, and that is usually very little.

## What remains after the split

Real client state in a typical app: auth status, theme, onboarding progress, a few filters or
sort orders, feature flags, and draft form input. That is a small object, and it does not need much
machinery — which is why the library debate matters less than people think.

## Where the boundary is genuinely unclear

Two honest cases:

**Optimistic local edits.** A note edited offline is server state that the server has not seen yet.
It belongs with the mutation queue rather than in either place — see `rn-offline`.

**Derived-and-filtered server data.** The filter is client state; the data is server state. Keep them
separate and compute the result — do not store the filtered list.

## Recommending the move

The change is real work: every screen touching that data changes. Do not present it as free.

Recommend it when the store contains loading flags per entity, when cache bugs are recurring, or
when data goes stale and nobody knows why. Do not recommend it because the pattern is fashionable —
an app with three endpoints and no staleness problems does not need it.
