# Metro in a Workspace

**Check what your tooling already does before configuring anything.** The manual setup below was
required for years and is now, on current Expo, frequently unnecessary — and adding it back can
cause the problems it once solved.

## Expo SDK 52+ configures this for you

`expo/metro-config` has built-in monorepo support for Bun, npm, pnpm and Yarn. Two separate
thresholds matter and are easy to conflate:

- **SDK 52+** — `watchFolders` is configured automatically. This is the one that makes the manual
  setup below unnecessary for most projects.
- **SDK 56+** — on-demand filesystem access lets the resolver read files outside `watchFolders`
  lazily, which further reduces the entries you need and allows symlinks to resolve outside the
  monorepo root.

Check which of those applies to you before concluding anything.

```js
// apps/mobile/metro.config.js — on current Expo, this is often the whole file.
const { getDefaultConfig } = require('expo/metro-config');
module.exports = getDefaultConfig(__dirname);
```

So the first question is not "what should I add?" but **"what does my SDK already handle?"**
Adding manual `watchFolders`, `nodeModulesPaths`, `extraNodeModules` or
`disableHierarchicalLookup` on top of a version that manages them is how configs become
unexplainable — and `disableHierarchicalLookup` in particular can break resolution that was working.

## When you do need to configure it manually

Bare React Native (`@react-native/metro-config`), Expo **before SDK 52**, or an unusual layout the
defaults do not anticipate.

```js
const path = require('node:path');
const { getDefaultConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// WATCH — which files Metro will look at. Without the workspace root, edits to
// a shared package change nothing: no rebuild, no error, stale bundle.
config.watchFolders = [workspaceRoot];

// RESOLVE — where dependencies are looked up, in order. App-local first so an
// app-specific version wins over a hoisted one.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
```

These solve different problems and are routinely confused:

- Missing `watchFolders` → edits to shared packages appear to do nothing.
- Missing `nodeModulesPaths` → `Unable to resolve module` for something that plainly exists.

## Force a single copy of React

The most valuable three lines in a React Native monorepo config:

```js
config.resolver.extraNodeModules = {
  react: path.resolve(workspaceRoot, 'node_modules/react'),
  'react-native': path.resolve(workspaceRoot, 'node_modules/react-native'),
};
```

Two copies of React produce `Invalid hook call`, contexts that are unexpectedly empty, and state
that does not update — symptoms that look like application bugs and are not. Pinning the resolution
removes the entire class.

Apply this narrowly. `extraNodeModules` used as a general fix-it accumulates into a config nobody
can reason about; it belongs on packages that must be singletons.

## Disable hierarchical lookup only if you understand it — and probably do not

On current Expo this is usually unnecessary and can break resolution the defaults handle correctly.
Reach for it only when you have a specific, diagnosed problem with resolution from an unexpected
level.


```js
config.resolver.disableHierarchicalLookup = true;
```

This stops Metro walking up parent directories looking for `node_modules`. It makes resolution
predictable and it makes it strict — anything not reachable via `nodeModulesPaths` now fails. Useful
for eliminating accidental resolution from an unexpected level, but it will surface problems that
were previously being papered over.

## Symlinks

Modern Metro handles symlinked workspace packages, which was historically the hardest part of this
setup. If you are following advice that involves manually resolving symlinks in the config, check
whether it is still necessary before adopting it — much of the folklore here predates support that
now exists.

## Verifying rather than guessing

```bash
# Which file does Metro actually resolve this to?
npx metro get-dependencies index.js 2>/dev/null | rg "react/index|react-native/index" | head

# Is anything duplicated? Nested node_modules included — that is where a
# library bundling its own React hides. `pwd -P` collapses the symlinks that
# pnpm and Yarn's pnpm linker create, so one physical copy counts once.
find . -path '*/node_modules/react/package.json' 2>/dev/null | while read -r f; do
  printf '%s\t%s\n' \
    "$(node -p "require('$PWD/${f#./}').version" 2>/dev/null || echo '?')" \
    "$(cd "$(dirname "$f")" && pwd -P)"
done | sort -u

# Start clean when testing a config change — the cache hides fixes and breaks alike
npx react-native start --reset-cache
```

That last one matters more than it should: a config change with a warm cache frequently appears not
to work, which sends people down a second, imaginary problem.
