# Environment Drift and "Works on My Machine"

When two machines disagree, one of them is lying about its state. Usually it's the one that works
— it has a warm cache hiding a real problem that the broken machine is correctly surfacing.

## First command, always

```bash
npx react-native info
npx expo-doctor        # Expo projects: also checks dependency version compatibility
```

This answers a large share of environment failures in one shot.

## The toolchain versions that matter

| Tool | Notes |
|---|---|
| **Node** | Match the project's `.nvmrc` / `engines`. Too new is as breaking as too old. |
| **JDK** | Recent RN expects **17**. A wrong major version produces errors that look like anything but a JDK problem. |
| **Ruby / CocoaPods** | System Ruby on macOS causes gem permission and architecture failures. Use `rbenv` + a committed `Gemfile`. |
| **Xcode** | Must match what the RN version supports. Also install Command Line Tools. |
| **Android SDK / NDK** | `compileSdk` and NDK version come from the RN template; drift after upgrades. |
| **Watchman** | Optional but assumed by many setups; a stale install is worse than none. |

```bash
node -v && java -version && ruby -v && pod --version
xcodebuild -version && sdkmanager --list_installed 2>/dev/null | head
echo $JAVA_HOME && echo $ANDROID_HOME
```

## Pin the versions so drift can't happen

The real fix for most "works on my machine" is making the environment explicit:

```
.nvmrc                 20.18.0
package.json           "engines": { "node": ">=20 <21" }
package.json           "packageManager": "npm@10.9.0"
Gemfile                gem 'cocoapods', '~> 1.15'
.tool-versions         (asdf/mise — covers node, java, ruby in one file)
```

A project with none of these will produce environment failures forever. Recommending this is
often more valuable than fixing the immediate error.

## Architecture (Apple Silicon)

```bash
uname -m                       # arm64 or x86_64
arch                           # what this shell is running as
```

A terminal running under Rosetta installs x86_64 gems and pods, which then fail under a native
arm64 build (and vice versa). Symptoms mention `incompatible architecture`, `ffi`, or
`mach-o file`. Keep one architecture consistently — mixing is what causes the confusing cases.

## Case sensitivity

macOS is case-insensitive; Linux CI is not. `import './Button'` when the file is `button.tsx`
works locally and fails in CI.

```bash
git config core.ignorecase false
git ls-files | sort -f | uniq -di      # files differing only by case
```

## Node version managers and Xcode

Xcode build phases don't inherit your shell environment, so `nvm`-installed Node is invisible to
them. This is the cause of most `Command PhaseScriptExecution failed` reports.

```bash
# ios/.xcode.env.local  (gitignored, per-developer)
export NODE_BINARY=$(command -v node)
```

## Lockfiles

```bash
git status package-lock.json yarn.lock
npm ci        # not `npm install` — honours the lockfile exactly
```

- **Committed and used with `ci`** — everyone resolves identically.
- **Committed but people run `install`** — versions drift silently within semver ranges.
- **Not committed** — every machine and every CI run gets a different tree. Almost all "works on
  my machine" traces here eventually.

Two lockfiles in one repo (`package-lock.json` *and* `yarn.lock`) means different developers are
using different package managers and getting different trees. Delete one.

## CI-only failures

| Cause | Check |
|---|---|
| Different Node/JDK | Pin with `setup-node` / `setup-java` |
| `npm install` instead of `npm ci` | Read the workflow |
| Case sensitivity | See above |
| Cold cache timing out | Raise timeout or cache properly |
| Missing secret/credential | Fork PRs cannot read secrets |
| Less memory than a laptop | `org.gradle.jvmargs`, Metro workers |
| Shallow clone | `fetch-depth: 0` when the build needs history |

## Fresh-clone check

The honest test of whether a repo is reproducible:

```bash
git clone <repo> /tmp/fresh && cd /tmp/fresh
npm ci
cd ios && bundle install && bundle exec pod install && cd ..
npx react-native run-ios
```

If this fails, something required is gitignored or undocumented — most often
`android/local.properties`, `ios/.xcode.env.local`, a `.env` file, or an undocumented native
setup step. Every one of those is a new-joiner's first day lost, and it's worth fixing in the
README even when it isn't the error you were asked about.
