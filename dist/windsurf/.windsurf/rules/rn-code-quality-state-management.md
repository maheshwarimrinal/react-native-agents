---
trigger: manual
description: "RN Code Quality: State Management"
---

# State Management

## The distinction that resolves most arguments

**Server state** and **client state** are different problems, and using one tool for both is why
state management feels hard.

| | Server state | Client state |
|---|---|---|
| Owner | The backend | The app |
| Examples | User profile, feed, orders | Theme, form drafts, modal open, selected tab |
| Properties | Async, shared, can go stale, needs caching/retry/dedupe | Synchronous, owned, always current |
| Tool | TanStack Query / RTK Query / SWR | `useState` → context → Zustand/Jotai |

Putting API responses in Redux means hand-writing caching, invalidation, loading flags, retry,
and dedupe — a large amount of code that a query library gives you correctly. Most "our Redux
store is a nightmare" situations are this.

## Choose the smallest thing that works

```
useState  →  useReducer  →  lifted state  →  Context  →  external store
```

Escalate only when you hit a real limit:

- **`useState`** — the default. Most state is local.
- **`useReducer`** — when transitions are interdependent or a component has 5+ related `useState`
  calls. Also makes the state machine testable in isolation.
- **Lift** — when exactly one ancestor and its subtree need it.
- **Context** — cross-cutting, low-frequency values: theme, locale, auth session, feature flags.
  Not for anything that changes many times per second.
- **External store** (Zustand, Jotai, Redux Toolkit) — genuinely global, frequently updated, or
  needs selector-level subscriptions and access outside React.

Reaching for Redux on a five-screen app is over-engineering. Threading state through six levels
of props because "we don't need a store yet" is under-engineering. Judge by the actual shape.

## Context correctly

```tsx
// ✗ new object every render → every consumer re-renders
<AuthContext.Provider value={{ user, login, logout }}>

// ✓
const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
```

Split contexts by update frequency. A consumer re-renders when *any* part of the value changes,
including parts it never reads. `ThemeContext` and `CartContext` should not be the same provider.

Split state from dispatch when readers and writers differ:

```tsx
<StateContext.Provider value={state}>
  <DispatchContext.Provider value={dispatch}>   {/* dispatch is stable */}
```

Provide a hook, not the raw context, so misuse fails loudly:

```tsx
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

## Store discipline

```ts
// zustand
export const useCart = create<CartState>((set, get) => ({
  items: [],
  add: (item) => set((s) => ({ items: [...s.items, item] })),
  clear: () => set({ items: [] }),
}));

// ✓ subscribe to a slice
const count = useCart((s) => s.items.length);

// ✗ subscribes to everything
const { items } = useCart();

// ✗ new object identity every call → renders on every store change
const { a, b } = useCart((s) => ({ a: s.a, b: s.b }));
// use useShallow(...) or two separate selectors
```

Rules:
- **Selectors return primitives or stable references.** This is the #1 store performance bug.
- **Actions live in the store**, not spread across components. The store owns its transitions.
- **Derived data is computed in selectors** (or Reselect for Redux), not duplicated into state.
- **Slice the store by domain**, don't build one god-object.
- **Don't put server data in it** — see above.

## Server state with TanStack Query

```tsx
const { data, isPending, error } = useQuery({
  queryKey: ['order', orderId],       // the cache key IS the dependency array — include everything
  queryFn: () => fetchOrder(orderId),
  staleTime: 30_000,
  select: (d) => d.items,             // derive without re-rendering on unrelated changes
});

const mutation = useMutation({
  mutationFn: updateOrder,
  onMutate: async (next) => {         // optimistic update with rollback
    await qc.cancelQueries({ queryKey: ['order', next.id] });
    const prev = qc.getQueryData(['order', next.id]);
    qc.setQueryData(['order', next.id], next);
    return { prev };
  },
  onError: (_e, next, ctx) => qc.setQueryData(['order', next.id], ctx?.prev),
  onSettled: (_d, _e, next) => qc.invalidateQueries({ queryKey: ['order', next.id] }),
});
```

Mobile-specific settings people miss:
- `focusManager` / `onlineManager` need wiring to `AppState` and NetInfo, or focus refetching
  doesn't behave sensibly on mobile.
- Default `staleTime: 0` plus refetch-on-mount produces refetch storms as users navigate. Set a
  real `staleTime`.
- Persist the cache to MMKV and hydrate at boot — the app opens with content instead of spinners.

## Forms

Don't hand-roll. `react-hook-form` with a zod resolver gives you uncontrolled inputs (fewer
re-renders), validation, and error state.

```tsx
const { control, handleSubmit, formState: { errors } } = useForm<Values>({
  resolver: zodResolver(Schema),
  mode: 'onBlur',
});
```

Watch for: validating on every keystroke (annoying and expensive), storing form state in a global
store (it's local by nature), and not handling the submit-in-flight state (double submissions are
a real bug on slow networks).

## Persistence

- Persist a **whitelist**, never the whole store. Persisting everything means hydrating everything
  at boot and shipping stale garbage forward.
- **Version and migrate.** A persisted shape from v1.2 will be loaded by v2.0. Without a
  migration path that's a crash on launch for existing users — one of the worst bugs you can
  ship, because updating again doesn't fix the corrupt local state.
  ```ts
  persist(store, { name: 'app', version: 3, migrate: (s, v) => migrations[v](s) })
  ```
- **Validate on hydrate.** Treat persisted data as untrusted input (see the security agent).
- **Never persist auth tokens** to AsyncStorage/MMKV-unencrypted.
- Hydration is async: render a splash or skeleton until it completes, or the first frame shows
  logged-out UI to a logged-in user.

## Audit

```bash
rg 'createContext' --type tsx -A 15 | rg 'value=\{\{'         # unmemoised context
rg 'useSelector\(\(.*\) => \(\{|useStore\(\(.*\) => \(\{'      # object-returning selectors
rg 'useEffect' --type tsx -A 8 | rg 'fetch\(|axios'            # server state in effects
rg 'persist|redux-persist' --glob "**/*.{js,jsx,ts,tsx}" -A 6 | rg -i 'version|migrate'
rg -i 'token|auth' --glob "**/*.{js,jsx,ts,tsx}" | rg -i 'persist|AsyncStorage'
rg 'useState' --type tsx -c | sort -t: -k2 -rn | head          # components with many useStates
```
