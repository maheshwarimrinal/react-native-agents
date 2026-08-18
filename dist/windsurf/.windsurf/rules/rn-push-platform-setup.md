---
trigger: manual
description: "RN Push: Platform Setup"
---

# Platform Setup

The JS is shared. Almost every failure is native configuration.

## iOS

**Capabilities** — in Xcode, on the target:

- **Push Notifications** — required. Its absence means no token, ever.
- **Background Modes → Remote notifications** — required for silent/data-only pushes.

These write to the `.entitlements` file. Verify it rather than trusting the Xcode checkbox, which
can be checked while the entitlement is missing from the build configuration you actually ship:

```bash
rg -n "aps-environment" ios/**/*.entitlements
```

The value is `development` or `production` and must match how the build is signed.

**Provisioning profile** must include the push entitlement. A profile created before you added the
capability does not, and it must be regenerated — this is a common source of "it worked yesterday"
after a certificate rotation.

**APNs key over certificate.** A `.p8` key works for both sandbox and production, does not expire,
and covers all your apps. Certificates expire annually and are environment-specific, which is a
recurring outage source. If a project still uses certificates, note the expiry as a scheduled
failure.

## Android

**`google-services.json`** must be present, current, and match the package name. A file from a
different Firebase project fails in ways that look like code problems.

```bash
rg -n "package_name" android/app/google-services.json
rg -n "applicationId" android/app/build.gradle
```

These must match exactly.

**Notification channels — Android 8+.** A notification posted to a channel that does not exist is
**dropped silently**. No error, no log, nothing displayed.

```ts
await notifee.createChannel({
  id: 'default',
  name: 'General',
  importance: AndroidImportance.HIGH,   // below HIGH there is no heads-up display
});
```

Create channels at startup, before any notification can arrive. Two things worth knowing: channel
settings are **immutable after creation** — to change importance you must delete and recreate with
a new id — and the user can disable individual channels, so a per-channel opt-out looks identical
to a delivery failure.

**`POST_NOTIFICATIONS` — Android 13+.** Notifications now require a runtime permission.

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Declaring it is not enough; it must be requested at runtime:

```ts
import { PermissionsAndroid, Platform } from 'react-native';

async function ensureNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;

  const already = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  if (already) return true;

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}
```

Note the version guard: the constant does not exist below API 33, and requesting it there throws.
An app that only declares the permission displays nothing on Android 13+ while working fine on older
devices — which is easily mistaken for a device problem.

**Battery optimisation** can delay or suppress delivery, and several manufacturers apply far more
aggressive restrictions than stock Android. If reports of missing pushes cluster on particular
brands, this is the likely cause and it is largely outside your control.

## Expo

`expo-notifications` covers most of this, and Expo's push service adds a layer that handles the
APNs/FCM split for you. Two constraints worth stating plainly:

- **Remote push requires a development build**, not Expo Go.
- Credentials are managed by EAS, which removes most of the setup above — and means the failure
  modes move to EAS credential configuration rather than disappearing.

## Verify against the built artefact

Reading source files tells you what should have been configured. For push specifically, verify the
**built** app:

```bash
# What entitlements did the signed app actually get?
codesign -d --entitlements - ios/build/**/*.app 2>/dev/null

# Is the permission in the merged manifest, not just your source manifest?
rg -n "POST_NOTIFICATIONS" android/app/build/intermediates/merged_manifests/**/AndroidManifest.xml 2>/dev/null
```

Manifest merging and build-configuration differences mean the source and the artefact can disagree,
and push is one of the areas where that gap is common.
