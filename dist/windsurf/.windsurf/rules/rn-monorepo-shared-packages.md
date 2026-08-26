---
trigger: manual
description: "RN Monorepo: Sharing Code Between Packages"
---

# Sharing Code Between Packages

## Consume source, not a build, where you can

For a package consumed only by React Native apps, pointing at TypeScript source is usually simpler
than building to `dist`:

```jsonc
// packages/shared/package.json
{
  "name": "@acme/shared",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

Metro transpiles it anyway. This removes a build step that can be stale, removes the class of bug
where you edited source and ran an old `dist`, and makes go-to-definition land somewhere useful.

The cost: consumers must be able to transpile it, which is fine for Metro and needs configuring for
Jest — see below.

**When you do need a build**: the package is also consumed by something that will not transpile it
(a Node service, a bundler-less web target), or it ships types for external consumers. Then build,
and make the build a dependency in your task graph so it cannot be stale.

## Jest needs to be told

```jsonc
"transformIgnorePatterns": [
  "node_modules/(?!(@react-native|react-native|@acme/shared)/)"
]
```

Jest does not transpile `node_modules` by default, and a symlinked workspace package resolves
inside it. The symptom is a syntax error on `import` in a file that is plainly valid — which reads
as a Jest configuration problem and is one.

## Keep platform-specific code out of shared packages

A package imported by both a React Native app and a web app must not import from `react-native` at
the top level. Either split the package, or use platform extensions:

```
packages/ui/src/Button.tsx        # shared logic and types
packages/ui/src/Button.native.tsx # React Native implementation
packages/ui/src/Button.web.tsx    # web implementation
```

The failure this prevents is a web build pulling in `react-native` and failing at bundle time, or
worse, resolving to `react-native-web` in a way nobody intended.

## What belongs in a shared package

Good candidates: types, API clients, validation schemas, pure business logic, constants, formatting.

Poor candidates: anything holding module-level state that must be a singleton, and anything with
native code. The first breaks subtly if the package is ever duplicated; the second breaks
autolinking — see `package-manager.md`.

## Path aliases

```jsonc
// tsconfig.json at the root
"paths": { "@acme/*": ["packages/*/src"] }
```

TypeScript aliases only satisfy the type checker. Metro must be able to resolve the same specifier
independently, which workspace linking already handles — so aliases and workspace dependencies
should agree. Where they disagree, you get code that type-checks and fails to bundle, which is a
confusing pair of signals.

Prefer real workspace dependencies (`"@acme/shared": "workspace:*"`) over aliases, and use aliases
only for within-package paths.

## Circular dependencies

Workspaces make these easy to create and hard to notice: `app → ui → utils → ui`. Metro will often
tolerate it until initialisation order matters, at which point you get an undefined import that
appears only in release or only on one platform.

```bash
npx madge --circular --extensions ts,tsx packages/ apps/
```

Worth running once when a workspace starts producing inexplicable undefined values.
