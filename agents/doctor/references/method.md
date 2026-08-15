# Diagnostic Method

The difference between an expert and a search engine here is *ordering*. Both know the same
twenty fixes; the expert knows which one to try first given this evidence.

## Step 0 — Get the whole error

The line that looks like the error is usually the last consequence, not the cause. Gradle in
particular prints the real problem far above the summary.

```bash
# Android — the summary line is almost never the cause
cd android && ./gradlew assembleDebug --stacktrace --info 2>&1 | tee /tmp/gradle.log
grep -n -i "what went wrong" -A 30 /tmp/gradle.log
grep -n -i "caused by" /tmp/gradle.log | head

# iOS
cd ios && pod install --verbose 2>&1 | tail -60
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug 2>&1 | grep -B5 -A10 "error:"

# Metro
npx react-native start --verbose
```

If someone pastes three lines, ask for the rest. Diagnosing from a truncated error is guessing.

## Step 1 — Establish the ground truth

```bash
npx react-native info      # RN, Node, npm, Java, Xcode, Android SDK, arch
npx expo-doctor            # Expo projects — checks dependency compatibility too
node -v && java -version && ruby -v && pod --version && xcodebuild -version
```

`react-native info` resolves a surprising share of failures on its own: wrong Java major version,
Node too old, Rosetta/arm64 mismatch, Android SDK missing.

Also establish, before advising anything:

- **Expo managed or bare?** `ls ios android` — if those don't exist, never tell them to edit
  files inside them.
- **New Architecture on?** Default since 0.76, bridge removed in 0.82.
- **Monorepo?** Changes Metro resolution and hoisting completely.
- **Fresh clone or existing checkout?** Different cause distributions.

## Step 2 — What changed?

The single highest-yield question.

```bash
git log --oneline -10
git diff HEAD~1 --stat -- package.json package-lock.json yarn.lock ios/ android/ *.config.js
git status                       # uncommitted native changes are a common culprit
```

| Situation | Most likely cause |
|---|---|
| Worked yesterday, no code change | Stale cache, or a floating dependency range resolved differently |
| After `git pull` | Lockfile changed but install not re-run; native deps changed but pods not reinstalled |
| After adding a library | Missing pod install, autolinking, or a peer/version conflict |
| After an RN or Expo upgrade | Config drift — the template changed and your files didn't |
| Only on CI | Environment difference: Node/Java version, cache, case-sensitive filesystem |
| Only on one machine | Local env, stale cache, or an uncommitted file |
| Fresh clone fails | A required file is gitignored, or setup steps are undocumented |

**"Works on my machine" is almost always one of:** a different Node/Java version, a stale cache
on the working machine (i.e. the *broken* machine is correct and the working one is lying), an
uncommitted local file, or a case-sensitivity difference between macOS and Linux CI.

## Step 3 — Classify before theorising

Match the error text to a family, then go to the matching reference:

| Error text contains | Family | Reference |
|---|---|---|
| `Unable to resolve module`, `Module not found` | Resolution | `metro-resolution.md` |
| `Could not find`, `Could not resolve`, `Duplicate class` | Gradle dependency | `android-gradle.md` |
| `Execution failed for task ':app:...'` | Android build | `android-gradle.md` |
| `Kotlin`, `AGP`, `compileSdk`, `minSdk` mismatch | Version conflict | `android-gradle.md` |
| `CocoaPods could not find`, `pod install` failure | iOS deps | `ios-cocoapods.md` |
| `ld: symbol(s) not found`, `Undefined symbols` | iOS linker | `ios-cocoapods.md` |
| `No such module`, missing header | iOS build | `ios-cocoapods.md` |
| `Signing for ... requires a development team` | Signing | `ios-cocoapods.md` |
| `Spec not found`, codegen artefacts missing | New Architecture | `android-gradle.md` / `ios-cocoapods.md` |
| Wrong Java/Node/Ruby, SDK missing, arch | Environment | `environment-drift.md` |

## Step 4 — One hypothesis, one command

State the top hypothesis, the evidence for it, and a single command that confirms or kills it.

> **Hypothesis:** Kotlin version conflict. Your log shows
> `Module was compiled with an incompatible version of Kotlin`, and you added
> `react-native-reanimated` in the last commit.
>
> **Confirm:** `cd android && ./gradlew app:dependencies --configuration releaseRuntimeClasspath | grep -i kotlin`
> — if two `kotlin-stdlib` versions appear, that's it.

A list of eight things to try is how people lose an afternoon. Give one, then the next.

## Step 5 — Fix the cause

Label what you're giving:

- **Fix** — removes the cause. Pinning the Kotlin version, adding the missing config, correcting the path.
- **Workaround** — silences the symptom. `--legacy-peer-deps`, `--force`, excluding a module, disabling a check. Legitimate to unblock someone, but say plainly that the underlying incompatibility is still there and will resurface.

## The reset, and its cost

```bash
watchman watch-del-all
rm -rf node_modules && npm ci
cd ios && rm -rf Pods Podfile.lock build ~/Library/Developer/Xcode/DerivedData/* && pod install
cd android && ./gradlew clean && rm -rf .gradle build app/build
npx react-native start --reset-cache
```

Correct when the evidence says stale state: it worked before, nothing relevant changed, or an
install was interrupted.

Wrong as a first move: it costs 10–20 minutes, destroys the diagnostic evidence, and if the cause
is a version conflict or bad config it fails again identically — with the developer now lacking
the context that would have explained why.

Prefer the targeted reset. Metro cache only:

```bash
npx react-native start --reset-cache
rm -rf $TMPDIR/metro-* $TMPDIR/haste-map-*
```

## Escalation

If two hypotheses have been eliminated, stop guessing and get more signal:

```bash
cd android && ./gradlew assembleDebug --scan     # shareable dependency/build report
cd ios && pod install --verbose
npx react-native config                          # what autolinking actually sees
npm ls <package>                                 # the real resolved tree
```

Searching the error verbatim against the library's GitHub issues is often faster than reasoning
from first principles — native build errors are frequently known bugs with known workarounds.
Say when that's the case rather than deriving a novel theory.
