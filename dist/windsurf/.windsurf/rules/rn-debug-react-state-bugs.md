---
trigger: manual
description: "RN Debug: State and Render Bugs"
---

# State and Render Bugs

The largest category of "it builds but behaves wrong", and most of it reduces to a small number of
patterns.

## "My state isn't updating"

Nearly always one of four things.

**Reading state immediately after setting it.** `setState` schedules; it does not assign. The
variable in the current scope is still the old value, and it always will be.

```tsx
const [count, setCount] = useState(0);
setCount(count + 1);
console.log(count);        // still the old value — this is correct behaviour
```

**A stale closure.** A callback captured `state` from the render in which it was created. If it is
memoised with an incomplete dependency array, it keeps that value forever.

```tsx
// ✗ captures `items` from the first render and never sees another
const onPress = useCallback(() => submit(items), []);

// ✓ updater form, no capture at all
setItems((current) => [...current, next]);
```

**Mutation instead of replacement.** React compares by identity. Mutating an object or array leaves
the identity unchanged, so nothing re-renders.

```tsx
items.push(next); setItems(items);          // ✗ same reference, no render
setItems((current) => [...current, next]);  // ✓
```

**Two sources of truth.** The same data in component state and in a store, updated in one place and
read from the other.

## Infinite re-render loops

The shape is always the same: an effect sets state, that state is in the effect's dependency array,
and around it goes.

```tsx
// ✗ new object identity every render → effect runs → setState → render → ...
useEffect(() => { setData(transform(items)); }, [items, options]);
const options = { includeArchived: false };
```

The culprit is usually an object, array, or function literal in the dependency array. It is a new
reference on every render, so the effect always considers it changed.

Fixes, in order of preference: derive the value during render instead of storing it, hoist the
constant out of the component, or memoise it with `useMemo`/`useCallback` — and if you reach for
memoisation, the dependency array has to be genuinely complete or you have swapped a loop for a
stale closure.

**Most `useEffect` that sets state is unnecessary.** If a value can be computed from props and
state, compute it during render. No effect, no extra render pass, no loop to debug.

## "It re-renders too much"

Do not guess. The Components panel tells you which prop changed, and the answer is usually an
inline object, array, or arrow function creating a fresh identity each render.

Confirm the cause first, then hand the optimisation to `rn-performance` — that agent owns the
tradeoffs, including when memoising makes things worse.

## Lists behaving strangely

Wrong item expanded, state attached to the wrong row, animations on the wrong element, input losing
focus — this is almost always **unstable keys**.

Using the array index as a key means the key changes whenever the array reorders, so React reuses
the wrong component instance. Use a stable id from the data. If there genuinely isn't one, that is
worth fixing upstream rather than working around.

## Effects firing at the wrong time

- Empty dependency array runs once on mount. If you meant "when x changes", say so.
- No dependency array runs after **every** render.
- Cleanup runs on unmount and before each re-run — subscriptions and timers need it.
- Under React 19 concurrent rendering, do not assume an effect runs exactly once. Effects should be
  idempotent; if one is not, that is a real bug rather than a framework quirk to work around.
