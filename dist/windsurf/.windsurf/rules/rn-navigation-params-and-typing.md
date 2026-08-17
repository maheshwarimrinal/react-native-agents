---
trigger: manual
description: "RN Navigation: Params and Typing"
---

# Params and Typing

## Type the param list

```tsx
export type RootStackParamList = {
  Home: undefined;
  Order: { id: string };
  Profile: { userId: string; tab?: 'posts' | 'likes' };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
```

The global declaration is what makes `useNavigation()` typed everywhere without passing generics at
each call site. Without it, most codebases end up with `any` navigation objects and lose the benefit
entirely.

Expo Router generates this from the file tree, which removes the drift between declared types and
actual routes.

## Types do not validate deep link params

This is the important asymmetry. `{ id: string }` is checked at compile time for **in-app**
navigation. A deep link supplies params at runtime, from outside, and TypeScript has no involvement.

```tsx
// The type says string. The link can say anything.
const { id } = route.params;
```

Validate at the boundary where external input becomes a route — see `deep-linking.md` — not in the
screen. One validated entry point beats defensive checks in every screen.

## Pass ids, not objects

```tsx
// ✗ a snapshot that goes stale, bloats persisted state, and may carry PII
navigation.navigate('Order', { order });

// ✓
navigation.navigate('Order', { id: order.id });
```

The screen fetches or selects from the store. Three reasons: the object is stale the moment
anything changes it, navigation state may be persisted to disk (so personal data ends up there),
and a deep link can only ever supply an id anyway — so passing an object gives you two different
code paths into the same screen.

## Nested navigation params

Easy to get subtly wrong:

```tsx
navigation.navigate('MainTabs', {
  screen: 'HomeStack',
  params: { screen: 'Order', params: { id: '123' } },
});
```

Each level needs `screen` and `params`. A missing level silently navigates to the parent's default
screen rather than erroring, which is why this is usually discovered by a user.

## Params are not state

Params describe *which* screen this is. They are not a place to keep changing values.

```tsx
// ✗ params as mutable state
navigation.setParams({ isEditing: true });

// ✓
const [isEditing, setIsEditing] = useState(false);
```

`setParams` re-renders, participates in navigation state, and can be persisted. Local UI state
should be local UI state.

The legitimate use is a value the header needs, since header options are configured from params.

## Returning data to a previous screen

```tsx
// ✗ passing a callback — not serialisable, breaks state persistence, leaks
navigation.navigate('Picker', { onSelect: (v) => setValue(v) });

// ✓ navigate back with the result, or use shared state
navigation.navigate('Form', { selectedId: value });
```

Function params break navigation state serialisation, which breaks persistence and produces a
warning most people suppress rather than fix. For anything beyond a single value, shared state is
cleaner than threading results through routes.
