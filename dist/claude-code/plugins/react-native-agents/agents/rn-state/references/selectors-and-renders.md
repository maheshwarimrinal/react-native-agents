# Selectors and Re-renders

The state layer's main performance failure, and it is nearly always one of three things.

## Subscribing to the whole store

```ts
// ✗ re-renders on ANY change to ANY field, anywhere in the app
const store = useStore();
const user = store.user;

// ✓ re-renders only when user changes
const user = useStore((s) => s.user);
```

The first form is easy to write, works correctly, and quietly couples every component to every
piece of state. It is the most common state performance bug and it does not show up until the app
is large enough that something changes often.

```bash
rg -n "= use[A-Z]\w*Store\(\)" --glob "**/*.{ts,tsx}"
```

## Selectors that return a new reference every call

```ts
// ✗ new array every call — never equal, so this re-renders on every store change
const active = useStore((s) => s.items.filter((i) => i.isActive));

// ✗ new object every call, same problem
const { name, email } = useStore((s) => ({ name: s.user.name, email: s.user.email }));
```

The selector runs on every store update and its result is compared by reference. A fresh array or
object is never reference-equal, so the component re-renders every time — which defeats the entire
point of using a selector.

Three ways out:

```ts
// 1. Select primitives separately — simplest and usually best
const name = useStore((s) => s.user.name);
const email = useStore((s) => s.user.email);

// 2. Shallow comparison for a small object
const { name, email } = useStore(useShallow((s) => ({ name: s.user.name, email: s.user.email })));

// 3. Derive outside the subscription
const items = useStore((s) => s.items);
const active = useMemo(() => items.filter((i) => i.isActive), [items]);
```

## Context for values that change

Covered in `choosing.md` and worth repeating because it is so common: every consumer re-renders on
every change, with no selector escape hatch. A Context holding a cart, a form, or anything
keystroke-driven re-renders the entire subtree that consumes it.

## Derived state stored instead of derived

```ts
// ✗ two sources of truth that will diverge
const useStore = create((set) => ({
  items: [],
  activeCount: 0,
  addItem: (i) => set((s) => ({
    items: [...s.items, i],
    activeCount: i.isActive ? s.activeCount + 1 : s.activeCount,
  })),
}));
```

Every mutation must now remember to update the derived value, and the one that forgets produces a
count that is wrong with no error. Derive it instead — from the store, or in a selector.

The general rule: **if it can be computed from other state, do not store it.**

## Confirm before optimising

Do not guess which component re-renders too much. React DevTools' Components panel reports what
actually changed, and the Profiler shows what it cost. Hand the broader optimisation question to
`rn-performance`, which owns the tradeoffs — including when memoising makes things worse.

Describe the mechanism rather than inventing numbers. "This selector returns a new array on every
call, so the component re-renders on any store change" is checkable. "This causes 40 unnecessary
renders per second" is not, unless you measured it.
