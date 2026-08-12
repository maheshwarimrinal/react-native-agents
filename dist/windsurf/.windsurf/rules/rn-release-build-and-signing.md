---
trigger: manual
description: "RN Release: Builds and Code Signing"
---

# Builds and Code Signing

## EAS Build profiles

```jsonc
// eas.json
{
  "cli": { "version": ">= 12.0.0", "appVersionSource": "remote" },
  "build": {
    "base": {
      "node": "20.18.0",
      "env": { "EXPO_PUBLIC_ENV": "development" }
    },
    "development": {
      "extends": "base",
      "developmentClient": true,
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_URL": "https://dev.api.example.com" }
    },
    "preview": {
      "extends": "base",
      "distribution": "internal",
      "channel": "preview",
      "ios": { "simulator": false },
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_ENV": "staging", "EXPO_PUBLIC_API_URL": "https://staging.api.example.com" }
    },
    "production": {
      "extends": "base",
      "channel": "production",
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" },
      "env": { "EXPO_PUBLIC_ENV": "production", "EXPO_PUBLIC_API_URL": "https://api.example.com" }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "…", "ascAppId": "…", "appleTeamId": "…" },
      "android": { "serviceAccountKeyPath": "./secrets/play-service-account.json", "track": "internal" }
    }
  }
}
```

Points that matter:

- **`app-bundle` for Android production.** A universal APK is 30–50% larger to download because
  it contains every ABI and density. Play generates optimised splits from an AAB.
- **`appVersionSource: "remote"`** with `autoIncrement` lets EAS own build numbers, which removes
  the "two builds with the same build number" class of error.
- **`channel`** ties the binary to an OTA channel. Getting this wrong is how a production build
  ends up receiving staging JavaScript — check it carefully.
- **`extends`** keeps profiles from drifting.
- `EXPO_PUBLIC_*` variables are **inlined into the bundle and are not secret** (see the security
  agent). Anything privileged belongs on your server.

## Local and bare builds

```bash
# Local EAS build (no cloud queue; needs the platform toolchain installed)
eas build --platform android --profile production --local

# Bare RN
cd android && ./gradlew bundleRelease
cd ios && xcodebuild -workspace App.xcworkspace -scheme App -configuration Release archive
```

Prefer CI builds over laptop builds. A laptop has stale pods, a different Xcode, a different JDK,
and yesterday's node_modules — the classic source of "works locally, crashes in the store build".

## iOS signing

The pieces:

| Artifact | What it is |
|---|---|
| **Distribution certificate** | Identifies your team. One per team; losing it is recoverable by revoking and reissuing. |
| **Provisioning profile** | Binds cert + app ID + entitlements + (for ad-hoc) device list. Expires annually. |
| **App Store Connect API key** | Automates submission without an Apple ID password or 2FA prompts. |

Let EAS manage credentials (`eas credentials`) unless you have a reason not to — it stores them
encrypted and syncs to every build. If you manage them manually, use Fastlane **match**, which
keeps them in an encrypted git repo so the whole team shares one source of truth.

Common failures:
- Expired provisioning profile → build fails with an opaque signing error. Set a calendar
  reminder, or automate renewal.
- Entitlements in the profile not matching the app (push, App Groups, associated domains, HealthKit).
- Ad-hoc builds failing on a device that isn't in the profile's device list.
- `get-task-allow` true in a release build (debuggable — a security finding).

## Android signing

```gradle
signingConfigs {
  release {
    storeFile file(System.getenv("KEYSTORE_PATH") ?: "release.keystore")
    storePassword System.getenv("KEYSTORE_PASSWORD")
    keyAlias System.getenv("KEY_ALIAS")
    keyPassword System.getenv("KEY_PASSWORD")
  }
}
buildTypes {
  release {
    signingConfig signingConfigs.release
    minifyEnabled true
    shrinkResources true
    proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
  }
}
```

**Enable Play App Signing.** Google holds the app signing key; you hold an upload key. If your
upload key is lost or compromised, Google can reset it. Without Play App Signing, losing the
signing key means **you can never update the app again** — the only remedy is publishing a new
listing and asking every user to migrate. This has happened to real companies.

Never commit the keystore or its passwords. `gradle.properties` with `storePassword=` in git is a
frequent and serious leak.

```bash
rg 'storePassword|keyPassword' android/ --hidden
git log --all --oneline -- '*.keystore' '*.jks'
```

## Fastlane (bare / non-Expo)

```ruby
platform :ios do
  lane :beta do
    setup_ci if ENV['CI']
    match(type: 'appstore', readonly: is_ci)
    increment_build_number(build_number: latest_testflight_build_number + 1)
    build_app(scheme: 'App', export_method: 'app-store')
    upload_to_testflight(skip_waiting_for_build_processing: true)
    sentry_upload_sourcemap(...)     # never skip this
  end
end
```

`match(readonly: true)` on CI prevents a CI run from regenerating team credentials — a mistake
that invalidates everyone else's setup.

## Build-time hygiene

Verify in every release build:

- [ ] Release configuration, not debug (`__DEV__` false, no dev menu, no Metro connection)
- [ ] `console.*` stripped
- [ ] R8/ProGuard enabled for Android
- [ ] Source maps generated, uploaded to the crash reporter, and **not shipped in the artifact**
- [ ] Correct API endpoints and environment for the profile
- [ ] Correct bundle ID / application ID (staging and production must differ so both can be
      installed side by side)
- [ ] Correct app icon and display name per environment
- [ ] Version and build number incremented
- [ ] No debug-only dependencies in the bundle

```bash
# Confirm no source map shipped
unzip -l app.aab | rg '\.map$'
find . -name 'index.android.bundle.map' -o -name 'main.jsbundle.map' | rg -v node_modules

# Confirm debuggable is false
aapt dump badging app.apk | rg -i debuggable

# What actually got compiled in
strings app.apk | rg -i 'localhost|ngrok|staging|10\.0\.2\.2' | head
```

## Reproducibility

Pin everything the build depends on: Node version (`.nvmrc` and the EAS `node` field), package
manager version (`packageManager` in package.json), Xcode and JDK versions (EAS `image`),
CocoaPods lockfile, Gradle wrapper. A build you cannot reproduce is a build you cannot debug.

## Audit

```bash
cat eas.json
rg 'channel|autoIncrement|appVersionSource' eas.json
rg 'buildType' eas.json                                    # app-bundle for production?
rg 'signingConfig' android/app/build.gradle
rg 'minifyEnabled|shrinkResources' android/app/build.gradle
rg 'EXPO_PUBLIC_' -r '' eas.json app.config.* | head        # remember: not secret
rg 'match\(' fastlane/Fastfile
ls -la android/*.keystore android/app/*.jks 2>/dev/null     # committed keys?
```
