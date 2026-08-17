# Symbolication

Three separate pipelines have to work, and they fail independently. A stack trace is only readable
if the artefact matching *that exact build* was uploaded before the crash arrived.

| Layer | Artefact | Fails when |
|---|---|---|
| JavaScript | source map | not uploaded, or uploaded under a different release/dist |
| iOS native | dSYM | Xcode did not generate it, or the upload step did not run |
| Android native | ProGuard/R8 mapping + NDK symbols | mapping not uploaded, or rules stripped the SDK |

## Android: ProGuard rules

**This is the highest-yield check in the whole agent.** R8 is enabled by default in release
builds. Without keep rules, it can strip or rename the crash reporter's classes, and the result
is: the build succeeds, the app runs, and **no crash ever reaches the dashboard**.

New Relic documents this as a known issue. Every vendor has the same exposure.

```proguard
# android/app/proguard-rules.pro

# --- Sentry ---
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**
# Keep line numbers, then hide the original source file name
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- New Relic ---
-keep class com.newrelic.** { *; }
-dontwarn com.newrelic.**
-keepattributes Exceptions, Signature, InnerClasses, LineNumberTable

# --- Firebase Crashlytics ---
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception
```

`-keepattributes SourceFile,LineNumberTable` is what makes stack traces carry line numbers at all.
Without it, even a correctly uploaded mapping file produces frames with no lines.

Verify the rules are actually applied — a `proguard-rules.pro` that is never referenced is a
common and completely silent mistake:

```bash
rg -n "proguardFiles|minifyEnabled" android/app/build.gradle
# and confirm the mapping file is produced
ls android/app/build/outputs/mapping/release/mapping.txt
```

### Uploading the mapping

Sentry's Gradle plugin does this automatically when configured:

```gradle
apply plugin: "io.sentry.android.gradle"

sentry {
  includeProguardMapping = true
  autoUploadProguardMapping = true
  uploadNativeSymbols = true      // NDK / C++ crashes
  includeNativeSources = false
}
```

Crashlytics uploads via its Gradle plugin. New Relic's plugin uploads on build. If you are using
none of these plugins, the mapping is not being uploaded and Android stack traces will be
unreadable — regardless of how the SDK is configured.

## iOS: dSYMs

Xcode must be told to produce them:

```
Debug Information Format        : DWARF with dSYM File   (Release)
Deployment Postprocessing       : Yes
Strip Linked Product            : Yes
Strip Debug Symbols During Copy : Yes
```

Then a build phase uploads them. Sentry:

```bash
# Xcode → Build Phases → New Run Script Phase (after "Embed Frameworks")
export SENTRY_PROPERTIES=../ios/sentry.properties
[[ $SENTRY_INCLUDE_NATIVE_SOURCES == "true" ]] && INCLUDE_SOURCES_FLAG="--include-sources"
/bin/sh ../node_modules/@sentry/react-native/scripts/sentry-xcode-debug-files.sh
```

New Relic:

```bash
ARTIFACT_DIR="${BUILD_DIR%Build/*}"
SCRIPT=$(/usr/bin/find "${SRCROOT}" "${ARTIFACT_DIR}" -type f -name run-symbol-tool | head -n 1)
/bin/sh "${SCRIPT}" "APP_TOKEN"
```

**Bitcode must be disabled** for these scripts to work, and the run-script phase must be **last**.
If "Run script: Based on Dependency analysis" is ticked, Xcode may skip it entirely — silently.

Check for the result rather than trusting the config:

```bash
cat ios/upload_dsym_results.log 2>/dev/null       # New Relic writes failures here
find ~/Library/Developer/Xcode/DerivedData -name '*.dSYM' | head
```

Frameworks built locally have **separate** build settings — a dependency compiled without dSYM
generation produces unreadable frames only for crashes inside it, which is a confusing partial
failure.

On **EAS Build**, dSYM upload happens automatically for Sentry when the config plugin is set up.
Verify rather than assume; the plugin being listed in `app.json` is not proof it ran.

## JavaScript: source maps

Generated at bundle time, uploaded to the vendor, and **never shipped in the app** (see the
security agent — a `.map` beside your production bundle hands your source to anyone with the IPA).

```jsonc
// app.json — Expo
{
  "expo": {
    "plugins": [[
      "@sentry/react-native/expo",
      { "organization": "org", "project": "proj" }
    ]],
    "hooks": {
      "postPublish": [{ "file": "sentry-expo/upload-sourcemaps" }]
    }
  }
}
```

```bash
# Bare RN, in CI after the build
npx sentry-cli releases files "$RELEASE" upload-sourcemaps \
  --dist "$BUILD_NUMBER" \
  --strip-prefix "$PWD" \
  android/app/build/generated/assets/react/release/index.android.bundle \
  android/app/build/generated/sourcemaps/react/release/index.android.bundle.map
```

### The mismatch trap

Uploaded maps are keyed by `release` **and** `dist`. If the app reports
`myapp@1.4.2+214` and the maps were uploaded as `1.4.2`, they will never be matched — and the
dashboard shows unsymbolicated traces exactly as if nothing had been uploaded.

```ts
// These two must agree with the upload, exactly.
Sentry.init({
  release: `${Application.nativeApplicationVersion}+${Application.nativeBuildVersion}`,
  dist: Application.nativeBuildVersion,
});
```

Verify from the outside:

```bash
sentry-cli releases files "myapp@1.4.2+214" list
```

## Hermes

Hermes produces bytecode plus a **compose**d source map; the intermediate packager map is not
enough on its own. If your tooling uploads `index.android.bundle.map` without the Hermes compose
step, JS frames stay unreadable.

Modern `@sentry/react-native` handles this automatically. Hand-rolled upload scripts written
before Hermes was default frequently do not — worth checking if a project has a bespoke script.

## OTA updates break the mapping

With `expo-updates` or CodePush, the JS running on a device may not be the JS that shipped in the
binary. Each OTA publish needs **its own** source-map upload, keyed to the update's runtime
version. Otherwise crashes from updated users are unreadable while crashes from un-updated users
are fine — a genuinely confusing partial failure that looks like flaky symbolication.

## Verification checklist

- [ ] Test crash from a **release** build appears in the dashboard
- [ ] JS frames show real file names and line numbers
- [ ] Native frames are symbolicated on both platforms
- [ ] Attributed to the correct release **and** build number
- [ ] Upload happens in CI, not on a laptop
- [ ] `.map` files are **not** present in the shipped artefact
- [ ] OTA updates upload their own maps
- [ ] ProGuard rules present, and `proguardFiles` actually references them
