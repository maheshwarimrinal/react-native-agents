---
trigger: manual
description: "RN Code Quality: Architecture and Module Boundaries"
---

# Architecture and Module Boundaries

## Folder structure

Organise by **feature**, not by file type. Type-based folders (`components/`, `hooks/`,
`utils/`) mean every feature change touches five directories, and nothing tells you what the app
actually does.

```
src/
  app/                    # or app/ at root for Expo Router — routing only
  features/
    checkout/
      components/         # used only by checkout
      hooks/
      api/                # checkout endpoints + response schemas
      model/              # types, state, pure business logic
      index.ts            # the public surface of this feature
    profile/
    feed/
  shared/
    ui/                   # design system primitives — Button, Text, Card
    hooks/                # genuinely cross-cutting
    lib/                  # http client, storage, analytics wrappers
    theme/
  navigation/
```

The rule that makes this work: **a feature may import from `shared/`, never from another
feature's internals.** Cross-feature needs go through `features/x/index.ts`, or the shared layer.
When two features need each other's internals, that's a sign the boundary is drawn in the wrong
place — usually there's a third concept trying to get out.

Enforce it rather than hoping:

```js
// eslint.config.js — import/no-restricted-paths
{
  zones: [{
    target: './src/features/checkout',
    from: './src/features',
    except: ['./checkout'],
    message: 'Import other features through their index.ts only.',
  }],
}
```

Route files should be thin. If a screen component is 600 lines, the business logic belongs in
hooks and the layout in components.

## Barrel files

`index.ts` re-exports are good for defining a public surface and bad when applied to every
directory:

- They create circular imports easily, which breaks Metro's inline requires and produces
  baffling `undefined is not a function` errors at module init.
- They pull in more than you asked for.

Use barrels at feature and package boundaries. Don't use them for every folder. Check with:

```bash
npx madge --circular src/
```

## Layering

```
screens / routes      →  presentation, wiring, navigation
  ↓
hooks                 →  orchestration; owns state and effects
  ↓
services / api        →  network, storage, platform access; returns validated data
  ↓
model                 →  pure functions and types; no I/O, trivially testable
```

Dependencies point one way. The rules that follow:

- **Business logic is pure and I/O-free.** Price calculation, validation, formatting, state
  transitions — these should be plain functions you can test without a renderer or a mock server.
  Logic buried inside a component is untestable and unreusable.
- **Components never call `fetch` directly.** They call a hook, which calls a service.
- **Native and platform access is wrapped.** One module owns `AsyncStorage`, one owns the HTTP
  client, one owns analytics. Swapping AsyncStorage for MMKV should be a one-file change, and
  mocking analytics in tests should be trivial.

## The abstraction rule

Don't abstract until the third occurrence. Two similar things are frequently coincidence; the
premature shared abstraction becomes a component with eleven boolean props that nobody can
change safely.

Signals you abstracted too early: props named `variant`, `mode`, `isX`, `showY` accumulating;
conditionals inside the shared component that only one caller triggers; a "generic" component
that only ever has two call sites.

Signals you abstracted too late: the same 40 lines in five files, and a bug fixed in three of
them.

## Navigation architecture

- Keep the navigator tree in one place; don't scatter `Stack.Screen` definitions.
- Type the param list once and use it everywhere (see `typescript.md`).
- Screens receive params, not objects. Passing a whole entity through navigation params means it
  goes stale, bloats persisted navigation state, and breaks deep links. Pass an `id` and read
  from the cache.
- Deep-link config lives next to the navigator so routes and links can't drift apart.

## Monorepos

Only if you actually share code across apps. The cost is real: Metro resolver config, hoisting
issues, symlink handling, and slower CI.

If you do: `pnpm` or `yarn` workspaces, explicit `package.json` per package, `metro.config.js`
with `watchFolders` and correct `nodeModulesPaths`, and no reaching into another package's `src/`.

## Configuration and environments

- One typed config module, validated at startup, that everything imports.
  ```ts
  export const config = ConfigSchema.parse({
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    env: process.env.EXPO_PUBLIC_ENV,
  });   // fails loudly at boot rather than mysteriously at runtime
  ```
- No `process.env` reads scattered through feature code.
- Remember: nothing in this config is secret (see the security agent).
- Feature flags behind one interface so removing a flag is a single change.

## Smells worth flagging

| Smell | What it usually means |
|---|---|
| `utils/index.ts` with 40 unrelated functions | No real home for these concepts yet |
| A component file over ~300 lines | Multiple responsibilities; extract hooks and subcomponents |
| A hook with 8 `useState` calls | Use `useReducer`, or the state belongs elsewhere |
| Props threaded through 4+ levels | Composition (`children`) or context is warranted |
| `any` at a module boundary | The contract is undefined; that's the real problem |
| Circular imports | Layering violation |
| Business logic inside `useEffect` | Untestable; extract a pure function |
| A "manager"/"helper"/"service" class holding state | Usually a module with functions plus a store |
