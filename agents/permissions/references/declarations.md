# Declarations

## iOS: a missing usage string is a crash

Not a warning, not a silent failure. Requesting a permission with no corresponding
`NS*UsageDescription` in `Info.plist` **terminates the app** at the moment of the request. It is
also an automatic store rejection.

```xml
<key>NSCameraUsageDescription</key>
<string>Scan a receipt to add it to an expense claim.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>Attach photos from your library to a claim.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>Show nearby stores and pre-fill the address at checkout.</string>
```

Common keys: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`,
`NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`,
`NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`,
`NSContactsUsageDescription`, `NSCalendarsUsageDescription`, `NSBluetoothAlwaysUsageDescription`,
`NSFaceIDUsageDescription`, `NSUserTrackingUsageDescription`.

Note that photo *read* and photo *add* are separate keys. An app that only writes needs the add-only
key, and requesting with the wrong one is a rejection point.

## Write strings that make the case

The string is shown in the system prompt. It is the only argument you get, and reviewers read it.

```
✗ "This app requires camera access."          — says nothing, and is a rejection risk
✓ "Scan a receipt to add it to an expense claim."
```

Say what the user gains, in their terms. Generic strings are one of the more common review
rejections and they also measurably weaken your case at the prompt.

## Android: declare in the manifest

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Declaring is not requesting. Dangerous permissions must also be requested at runtime; a declared
but unrequested permission simply never gets granted.

**Check the merged manifest, not just yours.** Libraries contribute permissions, and you can ship
one you never asked for — which is both a privacy issue and a store-listing surprise:

```bash
rg -n "uses-permission" android/app/build/intermediates/merged_manifests/**/AndroidManifest.xml 2>/dev/null
```

Remove an unwanted library permission explicitly:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove" />
```

## Expo

Declare through config rather than editing native files, or a prebuild will overwrite them:

```json
{
  "expo": {
    "ios": { "infoPlist": { "NSCameraUsageDescription": "Scan a receipt to add it to a claim." } },
    "android": { "permissions": ["CAMERA"] },
    "plugins": [["expo-camera", { "cameraPermission": "Scan a receipt to add it to a claim." }]]
  }
}
```

Config plugins usually set the strings for you, which is the preferred route — one source rather
than two that can disagree.

## Audit for the mismatch

The failure worth catching is a permission requested in code with no declaration:

```bash
rg -o "PERMISSIONS\.(IOS|ANDROID)\.[A-Z_]+" --glob "**/*.{js,jsx,ts,tsx}" | sort -u
rg -o "NS[A-Za-z]+UsageDescription" ios/*/Info.plist app.json app.config.* 2>/dev/null | sort -u
rg -o 'android.permission.[A-Z_]+' android/app/src/main/AndroidManifest.xml | sort -u
```

Compare the lists. Anything requested and not declared is a P0 on iOS.

The reverse is also worth reporting at a lower severity: a permission declared and never requested
is either dead configuration or a feature someone abandoned, and it appears in your store listing
either way.
