---
trigger: manual
description: "RN Code Quality: React and Hook Patterns"
---

# React and Hook Patterns

## You probably don't need that effect

`useEffect` is for synchronising with something *outside* React: a subscription, a native API, a
timer, an imperative animation, analytics. It is not a general-purpose "run some code" hook, and
most misuse traces to treating it as one.

### Deriving state — just compute it

```tsx
// ✗ extra render, stale for one frame, more code
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// ✓
const fullName = `${first} ${last}`;
```

Same for filtered lists, totals, and validity flags. If it's expensive, `useMemo` it — but
measure first; string concatenation and array filters over 50 items are not expensive.

### Resetting state on prop change — use `key`

```tsx
// ✗ renders once with stale state, then corrects
useEffect(() => { setDraft(''); }, [userId]);

// ✓ let React remount the subtree
<CommentBox key={userId} />
```

### Responding to an event — put it in the handler

```tsx
// ✗ runs on any render where the flag happens to be true; hard to reason about
useEffect(() => { if (submitted) toast('Saved'); }, [submitted]);

// ✓
async function onSubmit() {
  await save();
  toast('Saved');
}
```

### Fetching data — use a query library

Hand-rolled `useEffect` + `fetch` misses cancellation, race conditions (the older request
resolving last and overwriting), dedupe, retry, and caching. See `state-management.md`.

### When an effect *is* right

```tsx
useEffect(() => {
  const sub = AppState.addEventListener('change', onChange);
  return () => sub.remove();            // cleanup is mandatory
}, [onChange]);
```

## Hook rules that actually bite

- **No conditional hooks.** Not after an early return, not in a loop, not in a callback. The
  lint rule catches this; don't disable it.
- **Cleanup everything.** Listeners, timers, subscriptions, animations, in-flight requests. On
  mobile, screens unmount constantly.
- **`exhaustive-deps` is right more often than you are.** When you disable it, you're usually
  hiding a stale closure. If the dep genuinely shouldn't retrigger, use a ref or restructure —
  and comment why.
- **Stale closures:**
  ```tsx
  // ✗ always logs 0
  useEffect(() => { setInterval(() => console.log(count), 1000); }, []);

  // ✓ functional update, or a ref for the latest value
  setCount((c) => c + 1);
  ```
- **`useLayoutEffect`** blocks paint; use it only for measurement-then-mutate. On RN it's mostly
  for avoiding a visible flicker after `onLayout`.
- **Custom hooks are for stateful logic reuse.** A hook that takes props and returns JSX should
  be a component. A hook with no hooks in it should be a plain function.

## Component decomposition

Split when a component has more than one reason to change, or when a piece re-renders for
reasons unrelated to the rest.

```tsx
// ✗ the whole screen re-renders on every keystroke
function Screen() {
  const [query, setQuery] = useState('');
  return <><TextInput value={query} onChangeText={setQuery} /><ExpensiveList /></>;
}

// ✓ fast-changing state is isolated
function Screen() {
  return <><SearchBar onSubmit={search} /><ExpensiveList /></>;
}
```

Prefer **composition over configuration**. When a component grows boolean props (`showHeader`,
`isCompact`, `withBorder`, `variant`), it usually wants `children` or slots instead:

```tsx
// ✗
<Card showHeader title="x" headerAction={<X/>} compact bordered />

// ✓
<Card>
  <Card.Header title="x" action={<X/>} />
  <Card.Body>…</Card.Body>
</Card>
```

## Refs

- Refs for values that shouldn't trigger renders (timers, previous values, latest-callback,
  imperative handles).
- Never read or write `ref.current` during render — it breaks concurrent rendering.
- `useImperativeHandle` sparingly; a component with an imperative API is harder to compose.
- Forwarding: React 19 passes `ref` as a normal prop for function components, so `forwardRef` is
  no longer needed in new code. Existing `forwardRef` is fine.

## Lists and keys

- `key` must be stable and unique among siblings. Index keys break on reorder, insert, and
  delete — a classic "why does my input lose its text" bug.
- Never `key={Math.random()}`.
- Keys go on the outermost element returned by the map, including inside fragments
  (`<React.Fragment key={id}>`).

## Common React bugs in RN codebases

| Bug | Symptom |
|---|---|
| State update after unmount | Wasted work and, historically, warnings; usually an uncancelled request |
| Race in manual data fetching | Older response overwrites newer — "the wrong data flashes in" |
| Effect with a missing dep | Stale value used; works in dev, fails in a specific flow |
| Mutating state directly | `items.push(x); setItems(items)` — no re-render, since identity is unchanged |
| Object/array literal in deps | Effect fires every render |
| Not handling the empty/loading/error triad | Blank screen or crash on first load |
| `setState` in render | Infinite loop |

```tsx
// Race-condition-safe manual fetch, if you must write one
useEffect(() => {
  let active = true;
  load(id).then((d) => { if (active) setData(d); });
  return () => { active = false; };
}, [id]);
```

## React 19 / concurrent notes

- `use()` for reading promises and context conditionally.
- `useOptimistic` for optimistic UI without hand-rolled rollback.
- `useActionState` / form actions for submit flows.
- `useDeferredValue` and `startTransition` for keeping input responsive.
- **React Compiler** auto-memoises. If it's enabled, stop hand-writing `useMemo`/`useCallback`
  for referential stability — and flag redundant existing ones as removable noise. Check
  `babel.config.js` before advising either way.
- StrictMode double-invokes effects in dev to surface missing cleanup. If something breaks under
  StrictMode, the cleanup is wrong — don't disable StrictMode.

## Audit

```bash
rg 'useEffect\(' --type tsx -A 6 | rg 'set[A-Z]'          # derived-state effects
rg 'eslint-disable.*exhaustive-deps'                       # each needs justification
rg 'useEffect' --type tsx -A 8 | rg 'addListener|setInterval|subscribe' -A 4 | rg -v 'return'
rg 'key=\{(index|i|Math\.random)' --type tsx
rg '\.(push|splice|sort|reverse)\(' --type tsx -B 2 | rg -i 'set[A-Z]'   # state mutation
rg 'forwardRef' --type tsx                                  # removable in React 19
```
