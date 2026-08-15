---
trigger: manual
description: "RN Doctor: Android and Gradle Failures"
---

# Android and Gradle Failures

Gradle prints the real cause far above the summary. Always start with:

```bash
cd android && ./gradlew assembleDebug --stacktrace --info 2>&1 | tee /tmp/g.log
grep -n -i "what went wrong" -A 30 /tmp/g.log
grep -n -i "caused by" /tmp/g.log
```

## The version compatibility chain

Most Android build failures after adding a library or upgrading are one link in this chain being
out of step. Establish the whole chain before theorising:

```
Java (JDK) → Gradle → Android Gradle Plugin (AGP) → Kotlin → compileSdk → your libraries
```

```bash
java -version
cd android && ./gradlew --version
grep -rn "agp\|com.android.tools.build\|kotlinVersion\|compileSdk\|buildToolsVersion" \
  build.gradle gradle/libs.versions.toml gradle.properties 2>/dev/null
```

**JDK is the most common single cause.** Recent RN needs JDK 17; a machine on 21 or 11 produces
errors that look like anything but a JDK problem (`Unsupported class file major version`,
`invalid source release`, obscure Kotlin daemon crashes).

```bash
/usr/libexec/java_home -V     # macOS: what's installed
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

## Failures by signature

### `Could not find com.foo:bar:1.2.3`

A dependency isn't in any configured repository.

- Missing repository in `android/build.gradle` → `allprojects { repositories { ... } }`
- A library needs JitPack or a private Maven URL that isn't declared
- Offline mode or a proxy blocking the fetch
- Genuinely wrong coordinates after a rename

```bash
./gradlew app:dependencies --configuration releaseRuntimeClasspath | grep -i foo
```

### `Duplicate class com.foo.Bar found in modules ...`

Two dependencies pull the same class, usually via different versions or a relocated artifact
(the classic being `com.android.support` vs `androidx`).

```gradle
// android/app/build.gradle — force one version
configurations.all {
  resolutionStrategy {
    force 'com.squareup.okhttp3:okhttp:4.12.0'
  }
}
// or exclude the offending transitive
implementation('com.foo:bar:1.0') { exclude group: 'com.other', module: 'thing' }
```

Find who pulls it in first — don't force blindly:

```bash
./gradlew app:dependencies --configuration releaseRuntimeClasspath | grep -B10 "com.other"
```

### `Module was compiled with an incompatible version of Kotlin`

A native library ships Kotlin metadata newer than your project's Kotlin. Very common after adding
Reanimated, Gesture Handler, or an Expo module.

```gradle
// android/build.gradle
buildscript { ext { kotlinVersion = "2.0.21" } }   // raise to match the library
```

Confirm the conflict:

```bash
./gradlew app:dependencies --configuration releaseRuntimeClasspath | grep -i "kotlin-stdlib"
```

### `Execution failed for task ':app:mergeDexDebug'` / method limit

64K method limit. Enable multidex, or better, work out what added the bulk:

```gradle
android { defaultConfig { multiDexEnabled true } }
```

### `Manifest merger failed`

Two libraries declare conflicting attributes (usually `minSdk`, or a duplicate provider/activity).
The error names both sides. Fix with `tools:replace` or `tools:node="merge"` in
`AndroidManifest.xml`, or raise `minSdkVersion` if a library requires it.

### `SDK location not found`

```bash
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties   # macOS
```

`local.properties` is gitignored by design — a fresh clone always needs it, which is why this is
a classic first-day failure.

### Codegen / New Architecture failures

`Spec not found`, missing generated `*Spec.java`, or TurboModule registration errors.

```bash
cd android && ./gradlew generateCodegenArtifactsFromSchema --info
rm -rf android/app/build/generated
```

Causes: the library's `codegenConfig` in `package.json` is wrong or missing; the module isn't
autolinked; generated artefacts are stale after a version change; or the library genuinely hasn't
been migrated to the New Architecture (check its repo before assuming your config is wrong).

### `Task :app:installDebug FAILED` / `INSTALL_FAILED_UPDATE_INCOMPATIBLE`

A build with a different signing key is already installed. `adb uninstall <applicationId>`.

## Autolinking

```bash
npx react-native config | head -60      # what autolinking actually resolved
```

If a native module isn't being linked: it may not support autolinking, may be missing from
`dependencies` (devDependencies are not autolinked), or a monorepo may be hiding it from the
resolver.

## Gradle daemon and cache

```bash
cd android
./gradlew --stop
./gradlew clean
rm -rf ~/.gradle/caches/transforms-* .gradle build app/build
./gradlew assembleDebug --rerun-tasks
```

Justified when the failure is non-deterministic, mentions a corrupt cache entry, or appeared
after an interrupted build.

## Memory

```properties
# android/gradle.properties
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m
org.gradle.daemon=true
org.gradle.parallel=true
```

`OutOfMemoryError` or a silently killed Kotlin daemon usually means the JVM heap is too small —
common on CI runners with less RAM than a laptop.

## CI-only failures

- Different JDK — pin it with `actions/setup-java`
- Case-sensitive filesystem: `import './Button'` when the file is `button.tsx` works on macOS and
  fails on Linux. A very common CI-only break.
- Missing `local.properties` (CI sets `ANDROID_HOME` instead — that's fine)
- Cold Gradle cache making a timeout that never happens locally
- `npm install` on CI instead of `npm ci`, resolving different versions
