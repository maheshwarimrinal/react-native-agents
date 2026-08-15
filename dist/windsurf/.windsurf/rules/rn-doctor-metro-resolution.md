---
trigger: manual
description: "RN Doctor: Metro, Resolution, and Bundling Failures"
---

# Metro, Resolution, and Bundling Failures

## `Unable to resolve module X from Y`

The most common React Native error, and it has five distinct causes that need different fixes.
Work through them in this order — cheapest and most likely first.

### 1. Stale cache (most common when nothing relevant changed)

```bash
npx react-native start --reset-cache
# or, more thorough
watchman watch-del-all
rm -rf $TMPDIR/metro-* $TMPDIR/haste-map-*
```

If it worked before your last `git pull` and the package genuinely exists in `node_modules`, this
is almost certainly it. Metro caches the module map aggressively and does not always notice
dependency changes.

### 2. The package genuinely isn't installed

```bash
ls node_modules/X
npm ls X          # is it in the tree, and at what version?
```

After a `git pull` that changed `package.json`, people frequently forget to reinstall. Note also
that a package in `devDependencies` is still resolvable at build time but **not autolinked** for
native code.

### 3. Case sensitivity

```js
import Button from './components/button';   // file is Button.tsx
```

Works on macOS (case-insensitive), fails on Linux CI and in Docker. A classic CI-only failure.

```bash
git config core.ignorecase false     # surface case-only renames properly
```

### 4. Monorepo resolution

Metro doesn't follow symlinks the way Node does, and hoisting puts packages where Metro isn't
looking.

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;   // stop resolving outside the declared paths
module.exports = config;
```

Modern Metro handles symlinks far better than it used to, but hoisting still surprises people:
the package is installed at the workspace root, and the app's Metro instance never looks there.

### 5. Path alias configured in TypeScript but not in Metro

`tsconfig.json` `paths` satisfies the type checker; Metro knows nothing about it. The build fails
even though the editor is happy — which is why this one confuses people.

```js
// metro.config.js
config.resolver.extraNodeModules = {
  '@': path.resolve(projectRoot, 'src'),
};
```

Or use `babel-plugin-module-resolver` and keep the two configs in sync. Whichever you pick, the
alias must be declared in **both** places.

## Other Metro failures

### `error: Error: Unable to resolve module ./index` from a package

Usually a package with a broken or missing `main`/`exports` field, or one shipping ESM that Metro
can't consume. Check `node_modules/X/package.json`. Sometimes fixable with `resolver.resolveRequest`,
sometimes the package genuinely doesn't support React Native.

### `SyntaxError: Unexpected token` inside node_modules

A dependency ships untranspiled modern syntax. Metro doesn't transform `node_modules` by default.

For Jest this is `transformIgnorePatterns`; for Metro it's usually resolved by the library
shipping correct output, but you can force transformation with a custom transformer if needed.

### `Requiring unknown module`

A stale bundle referencing a module that no longer exists. Reset the cache and reload; if it
persists in a release build, the bundle was built against a different source tree.

### Port 8081 already in use

```bash
lsof -ti:8081 | xargs kill -9
npx react-native start --port 8082
```

### Watchman

```bash
watchman watch-del-all
watchman shutdown-server
```

Symptoms: changes not picked up, "too many open files", or a recrawl warning. On large repos
Watchman occasionally gets into a bad state and only a full reset clears it.

```bash
# "Too many open files" on macOS
ulimit -n 10240
```

## Red screens at runtime (not build failures)

Distinguish these from bundling errors — they mean the bundle built fine and the app is running.

| Message | Usual cause |
|---|---|
| `undefined is not an object (evaluating 'x.y')` | Unvalidated API response, or a native module that didn't link |
| `null is not an object (evaluating 'RNSomething.method')` | Native module missing — pods not installed, or the app wasn't rebuilt after adding it |
| `Invariant Violation: requireNativeComponent: "RNX" was not found` | Same: native side not linked, or app not rebuilt |
| `Element type is invalid ... got: undefined` | Bad import — default vs named, or a circular import |
| `Text strings must be rendered within a <Text>` | Bare string in a `View` |

**"Native module missing" after adding a library almost always means the app wasn't rebuilt.**
Metro reloading the JS is not enough — a new native dependency requires a full
`npx react-native run-ios` / `run-android`. This trips people constantly because the dev loop
otherwise never needs a rebuild.

## Circular imports

```bash
npx madge --circular src/
```

Symptoms: `undefined` at module-init time, `Element type is invalid`, or a component that is
defined but imports as `undefined`. Barrel files (`index.ts` re-exports) are the usual cause, and
inline requires make the timing more sensitive.
