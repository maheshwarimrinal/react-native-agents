# State Shape

## Split stores by domain

One store that everything imports means every module depends on every piece of state, and any
change can affect anything.

```ts
// Separate concerns, separate stores
export const useAuth = create<AuthState>(...);
export const useCart = create<CartState>(...);
export const useSettings = create<SettingsState>(...);
```

Independent stores are independently testable, independently persistable, and independently
clearable on logout.

## Normalise when there is a reason

```ts
// Denormalised — fine for a list you render and replace
{ orders: [{ id: '1', customer: { id: 'c1', name: 'Sam' } }, ...] }

// Normalised — the same customer exists once
{
  orders:    { byId: { '1': { id: '1', customerId: 'c1' } }, allIds: ['1'] },
  customers: { byId: { c1: { id: 'c1', name: 'Sam' } } },
}
```

Normalise when the same entity appears in several places and must stay consistent, when you update
individual entities frequently, or when a list is large enough that scanning it is a cost.

**Do not normalise a list of twelve items you fetch and render.** The indirection costs more than
it saves, and a server-state library already deduplicates by query key — which removes much of the
original motivation.

## Model states as a union, not as flags

```ts
// ✗ sixteen combinations, most of them meaningless
{ isLoading: boolean; isError: boolean; isEmpty: boolean; data: T | null }

// ✓ four states, all of them real
type Result<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: T };
```

The flag version permits `isLoading && isError`, which means nothing, and the code that handles it
will be wrong. The union makes the impossible states unrepresentable and lets the compiler check
exhaustiveness.

This is the single most valuable shape change available in most codebases.

## Auth needs a third state

```ts
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
```

`loading` is not optional. Restoring a session from storage is async, so for the first frames the
user appears signed out. Conflating that with `unauthenticated` produces a login screen flashing on
every launch, and any deep link evaluated in that window is dropped. See `rn-navigation`.

## Keep actions next to their state

Colocating the mutations with the state they mutate keeps the invariants in one readable place, and
means a component never has to know how a change is performed.

```ts
const useCart = create<CartState>((set, get) => ({
  items: [],
  add: (item) => set((s) => ({ items: [...s.items, item] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
  get total() { return get().items.reduce((n, i) => n + i.price, 0); },
}));
```

Note `total` is derived rather than stored — see `selectors-and-renders.md`.

## Clear on logout

Every store holding anything user-specific needs a reset, and it must run on logout including the
persisted copy. Otherwise the next account on that device inherits the previous one's cart,
filters, or cached profile — which is a privacy incident, not a bug.
