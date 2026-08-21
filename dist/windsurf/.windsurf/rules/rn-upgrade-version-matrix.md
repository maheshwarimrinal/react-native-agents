---
trigger: manual
description: "RN Upgrade: Version Matrix"
---

# Version Matrix

React Native does not have a version. It has a set of versions that must agree, and the error you
get when they disagree usually names none of them.

## What has to line up

| Layer | Constrained by |
|---|---|
| React | React Native pins a compatible React; mismatches break rendering in subtle ways |
| Expo SDK | Pins a specific RN version — this is a hard constraint, not a suggestion |
| Kotlin | Android Gradle Plugin and any native library's own Kotlin requirement |
| Android Gradle Plugin | Gradle wrapper version and JDK |
| Gradle wrapper | JDK version |
| JDK | AGP; also whatever your CI image ships |
| compileSdk / targetSdk | Play Store deadlines and native library requirements |
| Xcode | iOS deployment target, Swift version, and CI runner image |
| CocoaPods | Ruby version, and `Podfile` platform line |
| Hermes | Bundled with RN — not independently versioned |

**The asymmetry worth internalising:** on iOS your constraints come mostly from Xcode and the
deployment target; on Android they come from a four-way negotiation between Gradle, AGP, Kotlin,
and the JDK. Android version conflicts are more common and their errors are less informative.

## Reading the current state

```bash
# JS layer
node -p "const p=require('./package.json');({rn:p.dependencies['react-native'],react:p.dependencies.react,expo:p.dependencies.expo})"

# Android
rg -n "kotlinVersion|buildToolsVersion|compileSdkVersion|targetSdkVersion|ndkVersion" android/build.gradle
rg -n "distributionUrl" android/gradle/wrapper/gradle-wrapper.properties
rg -n "com.android.tools.build:gradle" android/build.gradle
java -version

# iOS
rg -n "platform :ios" ios/Podfile
xcodebuild -version 2>/dev/null
```

## Expo is a stronger constraint than it looks

If the project uses Expo, **the SDK version decides the React Native version**. You do not pick
them independently. Attempting to run a newer RN under an older SDK produces failures that look
like unrelated native errors.

The practical consequence: for an Expo project, the upgrade is an SDK upgrade, and the RN version
follows. Check `expo` in `package.json` first, before anything else, because it determines whether
you have a choice at all.

`npx expo install --check` reports dependencies whose versions do not match what the installed SDK
expects, which is the fastest way to see the gap.

## The version that breaks is rarely the one you changed

A Kotlin version conflict during an RN upgrade usually originates in a **transitive dependency of a
native library**, not in your own `build.gradle`. The error names a Kotlin version and a module
path, and the fix is at neither.

```bash
cd android && ./gradlew app:dependencies --configuration releaseRuntimeClasspath
```

Read for the same artifact appearing at two versions. Resolution strategies and `resolutionStrategy
.force` are the blunt fix; the better one is usually upgrading the library that pulls the old
version.

## Version-specific claims age

Every number in this file is a moving target. Check `knowledge.json` for what this repository has
actually verified and through which versions. When advising on a version outside that range, say
so — an upgrade plan built on a confidently wrong boundary costs more than one that admits a gap.
