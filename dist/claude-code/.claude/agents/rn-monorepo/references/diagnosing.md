# Diagnosing

Four causes, one symptom each. Identify which before changing any configuration.

## "Unable to resolve module X"

Two distinct causes wearing one message.

**Metro cannot see the file** — watch configuration. On Expo SDK 52+ this is handled for you, so on
those versions suspect the next cause first. The tell: the file plainly exists at the path Metro
names.

**Metro cannot resolve a dependency of it** — `nodeModulesPaths` is missing the root. The tell: the
unresolved module is a third-party package imported *by* a workspace package, not the workspace
package itself.

```bash
ls -la node_modules/<pkg> apps/mobile/node_modules/<pkg> 2>/dev/null   # where does it exist?
node -p "require('./apps/mobile/package.json').dependencies.expo"        # which SDK? changes the answer
rg -n "watchFolders|nodeModulesPaths" apps/mobile/metro.config.js       # configured, or defaulted?
```

## "Invalid hook call" / a context that is empty / state that will not update

**Two copies of React.** Almost always, in a workspace. The application code is fine.

```bash
find . -path '*/node_modules/react/package.json' 2>/dev/null | while read -r f; do
  printf '%s\t%s\n' \
    "$(node -p "require('$PWD/${f#./}').version" 2>/dev/null || echo '?')" \
    "$(cd "$(dirname "$f")" && pwd -P)"
done | sort -u
```

More than one line is your answer.

Two details in that command matter, and getting either wrong makes it report a
clean project that is not clean:

- **Nested `node_modules` are included.** A UI library that pulls its own React
  installs to `node_modules/some-lib/node_modules/react`, and that is one of the
  most common sources of a second copy. Excluding nested paths — as an earlier
  version of this command did — hides exactly the case you are looking for.
- **`pwd -P` resolves symlinks, and `sort -u` collapses the result.** Under pnpm
  and Yarn `nodeLinker: pnpm`, the real copies live in a store and every
  workspace symlinks to them, so the same physical React appears at many paths.
  Without resolving, a healthy pnpm repo looks like it has a dozen duplicates;
  with it, you see the distinct copies that actually exist.

Also note that `find` does not follow symlinks by default, so on a pnpm layout
the copies are found through the store path rather than the workspace link. That
is the same physical file — `node_modules/.pnpm/react@19.2.0/...` in the output
is not itself a problem, only a second *version* alongside it is. **Fix it at the dependency level first** — a root `overrides` /
`resolutions` entry pinning React to one version removes the duplicate rather than papering over it,
and on Expo SDK 52+ that is usually the whole fix.

Reach for `extraNodeModules` pinning only when deduplication is not possible, and remove it once it
is — a resolver override that outlives its cause is how these configs become unexplainable. See
`metro-resolution.md` and `package-manager.md`.

The same reasoning applies to any package holding module-level state: a store, a navigation
container, an i18n instance.

## A native module is `undefined` at runtime, with no build error

**Autolinking did not pick it up.** The JS resolved; the native side never linked.

```bash
cd apps/mobile && npx react-native config | rg '"<pkg>"'
```

Absent from that output confirms it. Usually the dependency is declared at the workspace root
rather than in the app package — see `native-and-builds.md`.

## "Works locally, fails in CI"

**Hoisting.** Local `node_modules` carries state from previous installs; CI does not.

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
<pnpm|yarn|npm> install --frozen-lockfile
```

If it now fails locally, the problem was always real.

## Order of operations

Do these in order and stop when one explains the symptom:

1. **Reproduce with a cold cache** — `npx react-native start --reset-cache`. A surprising share of
   "the fix didn't work" is a warm cache.
2. **Check for duplicates** — one command, rules out the highest-confusion cause.
3. **Check what Metro resolves** — not what you believe it resolves.
4. **Check autolinking** if anything native is involved.
5. **Only then** change configuration.

## Do not accumulate

The failure mode of monorepo debugging is a `metro.config.js` that grew one `extraNodeModules` entry
per incident until nobody can say what it does or which lines are still needed.

When you fix something, remove the workarounds it made unnecessary. A config you can explain is
worth more than one that currently builds.
