---
trigger: manual
description: "RN Navigation: Navigation Structure"
---

# Navigation Structure

## Get the nesting order right

Most confusing navigation behaviour is a nesting problem, and the two arrangements are not
interchangeable.

**Tabs inside a stack** — the usual choice. A screen pushed from a tab covers the tab bar, which is
what people expect when they open a detail screen.

**Stack inside each tab** — each tab keeps its own history. Switching tabs and returning preserves
where you were.

Most apps want both: a root stack, containing a tab navigator, where each tab contains its own
stack. Getting this wrong produces symptoms that look inexplicable — a detail screen rendering
*under* the tab bar, or a tab resetting every time you leave it.

```
RootStack
├── AuthStack           (unauthenticated)
├── MainTabs            (authenticated)
│   ├── HomeStack
│   ├── SearchStack
│   └── ProfileStack
└── Modals              presentation: 'modal'
```

## Keep it shallow

Every level of nesting makes params harder to pass, back behaviour harder to predict, and the code
harder to reason about. Three levels is usually enough. If you need four, the structure is probably
compensating for something that should be solved with a screen rather than a navigator.

## Route names must be unique

Duplicate names across nested navigators make `navigate('Details')` ambiguous — it resolves to
whichever the navigator finds first, which is not necessarily the one you meant, and it changes as
the tree changes.

Namespace them: `OrderDetails`, `ProductDetails`. Boring and unambiguous.

```bash
rg -o "name=\"[A-Za-z]+\"" --glob "**/*.tsx" | sed 's/.*name="//;s/"//' | sort | uniq -d
```

Any output from that is worth looking at.

## React Navigation and Expo Router

Both are reasonable. They differ in where the route tree comes from.

| | React Navigation | Expo Router |
|---|---|---|
| Route tree | Declared in code | Derived from the filesystem |
| Deep link config | A `linking` config object | Implicit in the file layout |
| Typing | Manual param list types | Generated from routes |
| Learning curve | Explicit, more boilerplate | Convention-driven |

Expo Router is built on React Navigation, so the underlying concepts transfer. Its main advantage is
that deep linking follows from the file structure rather than being a parallel configuration that
can drift from the actual routes — which removes a real class of bug.

The main cost is that the routing is implicit, so a misplaced file changes routing with nothing in
any code to indicate it.

**Do not recommend migrating between them without a reason beyond preference.** It is a large
change touching every screen, and both work.

## Group by feature, not by type

```
src/features/orders/
  screens/OrderList.tsx
  screens/OrderDetail.tsx
  navigation/OrdersStack.tsx
```

beats a top-level `screens/` directory holding forty unrelated files. The navigator for a feature
belongs with the feature — it changes when the feature changes.

## One place that knows how to route

Deep links, notification taps, and in-app navigation should converge on a single routing function.
Three parallel implementations drift, and the one that drifts is always the one nobody tests.

```ts
export function resolveTarget(input: RouteIntent): Target | null { ... }
```

Everything else — `Linking`, notification handlers, in-app buttons — calls it.
