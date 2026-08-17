# Choosing a Library

After the server-state split, what remains is small. Any of these handle it. The differences matter
less than the split did.

| | Zustand | Redux Toolkit | Jotai | Context |
|---|---|---|---|---|
| Boilerplate | Minimal | Moderate | Minimal | Minimal |
| Selectors | Yes | Yes | Atom-level | **No** |
| DevTools | Via middleware | Excellent | Good | None |
| Mental model | One store, hooks | Slices, actions, reducers | Bottom-up atoms | Provider tree |
| Best for | Most apps | Large teams, complex flows, auditability | Fine-grained independent state | Rarely-changing values |

## Zustand for most apps

Small API, no providers, selector support, and it works outside React — which matters more than it
sounds, because interceptors, background handlers, and navigation code often need store access
where hooks are unavailable.

```ts
const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  signIn: (user) => set({ status: 'authenticated', user }),
  signOut: () => set({ status: 'unauthenticated', user: null }),
}));

// Narrow subscription — this component re-renders only when status changes
const status = useAuth((s) => s.status);
```

## Redux Toolkit when you need the ceremony

Its costs are real and so are its benefits: a strict action log, time-travel debugging, excellent
DevTools, and a structure that scales across a large team. For complex multi-step flows where you
need to know exactly what changed and why, that auditability is worth the boilerplate.

RTK is a long way from the Redux people remember — `createSlice` removed most of the ceremony. If
an app already uses it and works, there is no reason to move.

## Jotai for genuinely atomic state

Bottom-up rather than top-down. Each atom is independent and components subscribe to individual
atoms, so re-render scoping is automatic rather than a selector discipline.

Suits state that is naturally fragmented — per-item toggles, independent form fields. Less suited
to state with many interdependencies, where the atom graph becomes hard to follow.

## Context is not a state manager

Worth stating plainly, because this is the most common architectural mistake in React Native state.

**Context has no selector mechanism.** Every consumer re-renders when the value changes, and there
is no way to subscribe to part of it. This is not a limitation to work around — it is what Context
is for: dependency injection of values that rarely change.

```tsx
// ✗ every consumer re-renders on every keystroke, anywhere in the tree
<AppContext.Provider value={{ user, theme, cart, filters, setFilters }}>

// ✓ Context for the stable thing; a store for the changing thing
<ThemeContext.Provider value={theme}>
```

Splitting into many contexts mitigates it and produces a provider tree ten levels deep. At that
point you have built a worse state manager.

## Do not migrate without a reason

Switching libraries touches every screen, introduces new bugs, and leaves the team less fluent for a
while. Reasons that justify it: a measured performance problem the current approach cannot fix, or a
library that is genuinely unmaintained.

Reasons that do not: it is more popular now, the API is nicer, a blog post. **"It works and the team
knows it" is a strong position.**
