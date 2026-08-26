# Package Managers

The choice changes what breaks. This is the single biggest variable in a React Native monorepo, and
generic advice that ignores it is usually wrong for you.

| | Layout | React Native fit |
|---|---|---|
| **npm workspaces** | Hoisted | Works with standard config |
| **Yarn Classic (1.x)** | Hoisted | Works with standard config |
| **Yarn Berry (2+)** | Depends on `nodeLinker` | Needs `node-modules` — see below |
| **pnpm** | Strict symlinks | Needs configuring — see below |
| **Bun** | Hoisted | Generally fine; verify native tooling |

"Yarn = hoisted" is only true of Yarn Classic. Check which you are on before
acting on any Yarn advice, including this page: `yarn --version`, or look for a
`.yarnrc.yml` (Berry) versus `.yarnrc` (Classic).

## pnpm: check your SDK before reaching for `node-linker=hoisted`

This depends on version, and the advice inverted recently.

**Expo SDK 54+** supports isolated dependencies and isolated installs, which is pnpm's default
strategy. On these versions, forcing `node-linker=hoisted` gives up isolation you no longer need to
give up.

**Expo SDK 53** — disabling isolated dependencies is the recommended path; leaving it on tends to
produce native build errors and dependency conflicts.

**Bare React Native, or older Expo** — `node-linker=hoisted` remains the pragmatic default, because
autolinking, Gradle and CocoaPods all assume a flat `node_modules`.

```ini
# .npmrc at the workspace root — only where it is actually needed
node-linker=hoisted
```

A middle path exists in all cases: `public-hoist-pattern` for the specific packages that need
flattening, which keeps isolation elsewhere and requires knowing which those are.

**Verify against your SDK's documentation rather than a blog post.** This is one of the
fastest-moving areas in the React Native toolchain, and advice written even a year ago is often
inverted now.

## Yarn Berry: the layout depends on `nodeLinker`

Yarn 2+ installs dependencies one of three ways, set by `nodeLinker` in
`.yarnrc.yml`:

| `nodeLinker` | What you get on disk |
|---|---|
| `pnp` | No `node_modules` at all — a single `.pnp.cjs` loader resolves everything |
| `pnpm` | A `node_modules` built from symlinks and hardlinks into a content-addressable store |
| `node-modules` | A regular hoisted `node_modules`, as in Yarn Classic and npm |

**React Native needs `node-modules`.** Metro, autolinking, Gradle and CocoaPods
all walk the filesystem looking for real directories; Plug'n'Play has no
`node_modules` for them to find. If a Berry workspace contains a React Native
app, this belongs in `.yarnrc.yml`:

```yaml
nodeLinker: node-modules
```

Two consequences worth knowing:

- **Zero-installs still work.** You keep the `.yarn/cache` and commit it; only
  the linking strategy changes.
- **Hoisting is still adjustable.** Even under `node-modules`, `nmHoistingLimits`
  (`none` — the default — or `workspaces` or `dependencies`) restricts how far
  packages hoist. Setting it to `workspaces` reintroduces per-workspace copies,
  which is a way to get a duplicate React back after you have removed one. It is
  worth checking when the duplicate returns and nothing else changed.

Don't diagnose a Berry repo with Classic assumptions. If `node_modules` is
missing entirely, that is PnP working as designed, not a broken install.

## Hoisting is why CI differs from your machine

Local `node_modules` accumulates state across branch switches and installs. CI installs from the
lockfile into an empty directory. A package that resolves locally through a leftover hoisted copy
will fail in CI with a resolution error that seems impossible.

Reproduce it before debugging it:

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
<pnpm|yarn|npm> install --frozen-lockfile     # or the equivalent
```

If it fails now, the problem was always there and your local state was hiding it.

## Where native dependencies belong

Anything with native code — the whole `react-native-*` family with an `android/` or `ios/`
directory — belongs in the **app package's** `package.json`, not the workspace root.

Autolinking scans from the app directory. A native dependency declared only at the root may resolve
fine in JavaScript and never be linked natively, producing a module that is `undefined` at runtime
with no build error. That symptom is one of the more confusing in this whole area, because the
import succeeds.

## One lockfile, at the root

Multiple lockfiles in a workspace is a broken state, not a configuration. It means different parts
of the repo resolved independently, and it guarantees the CI/local divergence above.

```bash
find . -name 'pnpm-lock.yaml' -o -name 'yarn.lock' -o -name 'package-lock.json' \
  | grep -v node_modules
```

More than one result, or two different managers' lockfiles side by side, is the finding.

## Version alignment

Two packages depending on different versions of React or React Native is the most common source of
the duplicate-copy problem. Pin these at the root:

```jsonc
// package.json at the workspace root
"pnpm": { "overrides": { "react": "19.2.0", "react-native": "0.87.0" } }
// or "resolutions" for Yarn, "overrides" for npm
```

Do this for React, React Native, and anything else with module-level state that must be a singleton.
