---
trigger: manual
description: "RN Performance: Re-render Elimination"
---

# Re-render Elimination

A re-render is not automatically a problem. A re-render of an expensive subtree, sixty times a
second, is. Profile first: React DevTools Profiler tells you which components committed and
whether their props actually changed.

## Check for React Compiler first

```bash
rg 'babel-plugin-react-compiler|reactCompiler' babel.config.js app.json app.config.* 2>/dev/null
```

If React Compiler is enabled (common on React 19.2 projects), it auto-memoises components and
hooks. Manual `useMemo` / `useCallback` / `React.memo` becomes largely redundant, and adding
more is noise that makes the code worse. In that case, focus on the causes the compiler
*cannot* fix: state placement, context shape, and store subscriptions.

## The seven usual causes

### 1. Context value recreated every render

```tsx
// ✗ every consumer re-renders whenever Provider's parent renders
<AuthContext.Provider value={{ user, login, logout }}>

// ✓
const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
<AuthContext.Provider value={value}>
```

### 2. One fat context instead of several thin ones

Any consumer of a context re-renders when *any* part of its value changes, even parts it never
reads. Split by change frequency:

```tsx
// ✗ theme consumers re-render whenever the cart changes
<AppContext.Provider value={{ theme, user, cart, notifications }}>

// ✓ separate providers; a theme consumer is untouched by cart updates
<ThemeContext.Provider value={theme}>
  <UserContext.Provider value={user}>
    <CartContext.Provider value={cart}>
```

For high-frequency values (scroll position, animated progress, form field state), don't use
context at all — use a Reanimated shared value, or an external store with selectors.

### 3. State living too high

State that only one leaf uses, held at the screen root, re-renders the entire screen on every
keystroke. Push state down to the component that owns it. Conversely, if you're syncing two
sibling states with an effect, lift it — but only that one value.

```tsx
// ✗ every keystroke re-renders the whole screen including the list
function Screen() {
  const [query, setQuery] = useState('');
  return <><SearchInput value={query} onChange={setQuery} /><HugeList /></>;
}

// ✓ isolate the fast-changing state
function SearchInput({ onSubmit }) {
  const [query, setQuery] = useState('');   // local
  ...
}
```

### 4. Store subscriptions without selectors

```tsx
// ✗ re-renders on any store change
const state = useStore();
const count = state.cart.items.length;

// ✓ re-renders only when the derived value changes
const count = useStore((s) => s.cart.items.length);

// ✗ new object identity every call → always re-renders
const { a, b } = useStore((s) => ({ a: s.a, b: s.b }));
// ✓ use the shallow comparator (zustand) or separate selectors
const a = useStore((s) => s.a);
const b = useStore((s) => s.b);
```

Redux: same rule with `useSelector` + `createSelector` from Reselect for derived data.

### 5. Unstable props

Object literals, array literals, and inline functions create a new identity every render,
which defeats `React.memo` on the child.

```tsx
// ✗
<Card style={{ margin: 8 }} tags={[]} onPress={() => go(id)} />

// ✓
const styles = StyleSheet.create({ card: { margin: 8 } });
const EMPTY: readonly string[] = [];
const onPress = useCallback(() => go(id), [go, id]);
<Card style={styles.card} tags={EMPTY} onPress={onPress} />
```

`StyleSheet.create` is not just style — it produces a stable reference. Inline style objects are
a top-three cause of broken memoisation in RN codebases.

### 6. `key` churn

Changing a `key` unmounts and remounts the subtree, throwing away state and native views.
`key={Math.random()}` or `key={JSON.stringify(item)}` are catastrophic. If someone used a
changing key to "force a refresh", that's a state-management bug wearing a disguise.

### 7. Effects that set state on every render

```tsx
// ✗ infinite-ish render loop
useEffect(() => { setFullName(`${first} ${last}`); });

// ✓ derive during render — no state, no effect
const fullName = `${first} ${last}`;
```

If a value can be computed from props/state, compute it. Don't mirror it into state. This is the
single most common React mistake and it is a performance problem as well as a correctness one.

## Concurrent React (React 19.2 + Fabric)

Fabric supports concurrent rendering, so these are real tools now, not theory:

```tsx
// Keep the input responsive while an expensive list re-filters
const [query, setQuery] = useState('');
const deferredQuery = useDeferredValue(query);
const results = useMemo(() => filterHuge(data, deferredQuery), [data, deferredQuery]);

// Mark a state update as non-urgent
startTransition(() => setTab(next));

// Show stale content while new content loads instead of a spinner flash
<Suspense fallback={<Skeleton />}>
```

Prefer these over hand-rolled `setTimeout(..., 0)` deferrals and `InteractionManager` gymnastics.
`InteractionManager.runAfterInteractions` is still useful for genuinely post-animation work
(analytics, prefetch), but not as a general scheduling primitive.

## Screen-level freezing

```tsx
// react-navigation: stop re-rendering screens that aren't visible
<Stack.Screen options={{ freezeOnBlur: true }} />

// or globally, via react-native-screens
import { enableFreeze } from 'react-native-screens';
enableFreeze(true);
```

Big win on tab navigators where background tabs subscribe to live data. Watch for screens that
legitimately need to keep running (a timer, a media player) and exclude them.

## Memoisation discipline

Do memoise:
- Values passed to `React.memo` children, context providers, or list `renderItem`.
- Genuinely expensive computations (sorting/filtering thousands of items, parsing).
- Callback identities that feed into dependency arrays.

Do **not** memoise:
- Primitives. `useMemo(() => a + b, [a, b])` costs more than it saves.
- Values used only in the same component's JSX with no memoised consumer.
- Everything, reflexively. Each `useMemo` allocates, stores a dep array, and runs a comparison.

If you cannot name the component that benefits from a given `useMemo`, delete it.

## Audit grep

```bash
rg '<\w+Context\.Provider value=\{\{'      # unmemoised context value
rg 'style=\{\{' --type tsx                  # inline style objects
rg 'useEffect\(\(\) => \{[^}]*set[A-Z]' -U  # state-setting effects
rg 'key=\{(Math\.random|index|JSON)'        # key churn
rg 'useSelector\(\(.*\) => \(\{'            # object-returning selectors
```
