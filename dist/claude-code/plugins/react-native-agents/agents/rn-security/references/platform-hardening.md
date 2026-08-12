# Platform Hardening and Code Integrity

## Android manifest and build

```xml
<application
    android:allowBackup="false"                  <!-- true → adb backup extracts app data -->
    android:debuggable="false"                   <!-- must never be true in release -->
    android:usesCleartextTraffic="false"
    android:networkSecurityConfig="@xml/network_security_config"
    android:dataExtractionRules="@xml/data_extraction_rules">   <!-- Android 12+ -->
```

Checks:

- `debuggable="true"` in a release build lets anyone attach a debugger and dump memory. P0.
- `allowBackup="true"` (the default) means `adb backup` extracts AsyncStorage and app files on
  many devices. Set `false`, or supply strict `dataExtractionRules` / `fullBackupContent`.
- Every `exported="true"` component needs justification (see `webview-and-deeplinks.md`).
- Minimum SDK: older API levels lack modern platform mitigations. `minSdkVersion` below 24 is
  worth flagging.
- Signing: release must use a real keystore, not the debug key. Check that
  `signingConfigs.release` doesn't reference `debug.keystore`, and that keystore passwords are
  not committed (`gradle.properties` in git is a common leak).

```gradle
// android/app/build.gradle
buildTypes {
  release {
    minifyEnabled true          // R8 — obfuscation + shrinking
    shrinkResources true
    proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    signingConfig signingConfigs.release   // not signingConfigs.debug
  }
}
```

## iOS Info.plist and entitlements

- `NSAppTransportSecurity` — see `transport-and-network.md`.
- **Purpose strings** must be present and honest for every permission used
  (`NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSFaceIDUsageDescription`, …). Missing = crash on request; vague = review rejection.
- `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace` expose the Documents directory to
  the Files app and iTunes. Only enable deliberately.
- Entitlements: check `keychain-access-groups` (over-broad sharing between apps),
  `associated-domains`, App Groups, and that `aps-environment` is `production` for release.
- `get-task-allow` must be `false` in release (it's what permits debugger attach).

## Screenshots, recording, and the app switcher

Both platforms snapshot your app when it backgrounds. On a screen showing account balances or
health data, that snapshot sits in storage.

```kotlin
// Android — also blocks screenshots and screen recording
window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
```

```swift
// iOS — no FLAG_SECURE equivalent; cover the window on resign
func applicationWillResignActive(_ application: UIApplication) {
    blurView.frame = window!.bounds
    window?.addSubview(blurView)
}
```

`expo-screen-capture` (`preventScreenCaptureAsync`) wraps this for Expo apps and can also detect
screenshots on iOS so you can log or warn.

## Root / jailbreak detection

Useful as **signal**, never as a **control**. A determined attacker patches it out in minutes;
`frida-server` and Magisk hide are commodity tools.

Reasonable use: report it to your backend as a risk factor, raise step-up auth, restrict
high-value actions. Unreasonable use: hard-blocking all users (breaks legitimate power users and
security researchers, and doesn't stop the actual attacker).

Libraries: `jail-monkey` (basic), `freeRASP` (fuller — emulator, debugger, hooking, tamper).

## Anti-tampering and obfuscation

Ordered by actual value:

1. **R8/ProGuard on Android** — free, on by default in release templates, meaningfully raises
   effort. Verify it's actually enabled.
2. **Strip logs and dev code** from release: `babel-plugin-transform-remove-console`, guard debug
   paths behind `__DEV__`, remove test endpoints and feature flags that unlock internals.
3. **Never ship source maps** with the bundle. Generate them, upload to your crash reporter,
   exclude from the artifact.
4. **Signature verification** — the app checks its own signing certificate at runtime and refuses
   to run if repackaged. Bypassable, but stops trivial re-signing.
5. **JS obfuscation** (`obfuscator-io-metro-plugin`) — costs startup time and debuggability for
   modest benefit. Only for genuinely high-value targets, and never as a substitute for keeping
   secrets server-side.

Be honest in reviews: none of this protects a secret. It buys time against low-effort attackers.

## OTA updates — a code-execution channel

`expo-updates` / CodePush can replace your JS at runtime. That is, by construction, remote code
execution on your users' devices. It must be locked down.

- **Code signing must be enabled.** `expo-updates` supports signed manifests; without it, anyone
  who compromises the update channel (or MITMs an unpinned update fetch) ships arbitrary code.
- **HTTPS + integrity check** on the update endpoint.
- **Runtime version discipline** — an update built against native modules the installed binary
  doesn't have will hard-crash on launch, and the user can't update their way out.
- **Staged rollout + automatic rollback** on crash-rate regression.
- **Access control on who can publish.** A publish token in CI with no review is a supply-chain
  hole into every user's device. Require signed commits or protected branches for release
  channels.
- Store policies: OTA may change behaviour but not the app's purpose or add undisclosed
  functionality. Shipping a feature via OTA to dodge review is a policy violation.

## Permissions

- Request the minimum, and at the point of use with an in-context explanation. Requesting
  location at launch tanks acceptance rates and draws review scrutiny.
- Audit `AndroidManifest.xml` for permissions inherited from dependencies you removed — they
  persist in the merged manifest and show up on the store listing.
- Android 13+: granular media permissions (`READ_MEDIA_IMAGES` etc.) instead of
  `READ_EXTERNAL_STORAGE`. Background location and `QUERY_ALL_PACKAGES` require Play Console
  justification and are frequent rejection causes.
- iOS: ATT prompt required before IDFA access; the tracking flag must match your privacy label.

## Audit commands

```bash
rg 'allowBackup|debuggable|usesCleartextTraffic|exported=' android/app/src/main/AndroidManifest.xml
rg 'minifyEnabled|shrinkResources|signingConfig' android/app/build.gradle
rg 'storePassword|keyPassword' android/ --hidden        # committed keystore credentials
rg 'NS.*UsageDescription' ios/*/Info.plist
rg 'get-task-allow|aps-environment|keychain-access-groups' ios/*/*.entitlements
rg 'uses-permission' android/app/src/main/AndroidManifest.xml
rg 'codeSigningCertificate|expo-updates' app.json app.config.*
ls -la android/app/build/outputs/bundle/release/   # confirm no .map next to the artifact
find . -name '*.jsbundle.map' -o -name 'index.android.bundle.map' | grep -v node_modules
```
