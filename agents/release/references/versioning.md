# Versioning

Three different numbers, three different purposes. Conflating them causes most upload rejections.

| Number | Where | Who sees it | Rule |
|---|---|---|---|
| **Version** (`1.4.2`) | `expo.version` / `CFBundleShortVersionString` / `versionName` | Users, store listings | Semver-ish; marketing-facing |
| **Build number** | `ios.buildNumber` / `android.versionCode` | Store internals only | **Must strictly increase** with every upload |
| **Runtime version** | `expo.runtimeVersion` | Nobody; used by OTA | Changes only when native changes |

## The build number rule

Every binary uploaded to App Store Connect or Play Console must have a build number higher than
any previously uploaded one — even for a build that was rejected, expired, or never released.
Reusing a number gets the upload rejected, and on Android a lower `versionCode` means users on the
higher one never receive the update.

Automate it. Manual bumping fails eventually:

```jsonc
// eas.json — EAS tracks and increments remotely
{ "cli": { "appVersionSource": "remote" },
  "build": { "production": { "autoIncrement": true } } }
```

```ruby
# Fastlane
increment_build_number(build_number: latest_testflight_build_number + 1)
```

```bash
# CI-based: monotonic and traceable back to a commit
VERSION_CODE=$(git rev-list --count HEAD)
```

`versionCode` on Android is an integer with a maximum of 2,100,000,000 — plenty, but don't encode
a timestamp with milliseconds into it.

## Version numbering

```
MAJOR.MINOR.PATCH
  │     │     └── bug fixes, OTA-able changes
  │     └──────── new features, backward compatible
  └────────────── breaking changes to APIs or data, major redesigns
```

For apps (as opposed to libraries), semver is a communication convention rather than a contract.
What matters is consistency and that the version is visible in-app (Settings → About) so support
can ask "what version are you on?" and get a useful answer.

```ts
import * as Application from 'expo-application';
const label = `${Application.nativeApplicationVersion} (${Application.nativeBuildVersion})`;
```

Always show both. The build number is what distinguishes two binaries with the same user-facing
version — which happens constantly.

## Runtime version — the one that prevents crashes

```jsonc
{ "expo": { "runtimeVersion": { "policy": "fingerprint" } } }
```

Runtime version answers: "is this JS bundle compatible with the native code in the installed
binary?" It must change when, and only when, the native side changes.

Policies:

| Policy | Behaviour |
|---|---|
| `fingerprint` | Hashes the native dependency graph and config. **Use this.** |
| `appVersion` | Ties runtime to the app version — forces a new runtime on every release, which needlessly cuts off OTA for older versions |
| `sdkVersion` | Expo SDK only; misses your own native changes |
| Manual string | Requires discipline nobody sustains |

Everything else on this page is about avoiding a rejected upload. This one is about avoiding a
crash-on-launch that users cannot update out of. It deserves the most care.

```bash
npx expo-updates fingerprint:generate            # what's in it
npx expo-updates fingerprint:compare             # did it change?
```

## Detecting a native change

Before every OTA publish, ask whether anything requiring a rebuild changed:

```bash
git diff <last-build-sha>..HEAD --stat -- \
  package.json ios/ android/ app.json app.config.ts plugins/
```

Native changes include: adding/removing/upgrading any package with native code, Expo config
plugins, permissions, entitlements, app icons and splash, Expo SDK upgrades, and RN upgrades.

Wire this into CI so the pipeline refuses an OTA publish when the fingerprint has changed — a
policy check is more reliable than a checklist item.

## Changelogs

Generate from commits so it can't be forgotten:

```bash
npx conventional-changelog -p angular -i CHANGELOG.md -s
```

Conventional commits (`feat:`, `fix:`, `chore:`) also let you derive the version bump
automatically. Keep two audiences separate: the internal changelog (every change, with commit
links) and the store release notes (what users care about, in plain language). "Bug fixes and
performance improvements" for the fifth release running is a missed opportunity to tell users
you fixed the thing they complained about.

## Tagging

```bash
git tag -a v1.4.2 -m "Release 1.4.2 (build 214)"
git push origin v1.4.2
```

Tag every released build, including the build number in the message. When a crash report arrives
from "1.4.2", you need to know which of the three 1.4.2 builds it came from.

Record, per release: git SHA, build number, EAS build ID, OTA update group IDs published against
it, and the date. Six months later, during an incident, this is the only way to answer "what code
is this user actually running?"

## Audit

```bash
rg '"version"|buildNumber|versionCode|versionName' app.json app.config.* android/app/build.gradle
rg 'appVersionSource|autoIncrement' eas.json
rg 'runtimeVersion' app.json app.config.*
git tag --sort=-creatordate | head
rg 'nativeApplicationVersion|nativeBuildVersion' --type ts   # shown in-app?
ls CHANGELOG.md 2>/dev/null
```
