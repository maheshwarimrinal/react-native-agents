---
trigger: manual
description: "RN Permissions: Per-Permission Notes"
---

# Per-Permission Notes

## Location

The most nuanced, and the one with the most review scrutiny.

- **When-in-use vs always** — request when-in-use first. Requesting `always` up front is a rejection
  risk and users refuse it far more often. iOS can escalate later, with its own prompt.
- **Coarse vs fine (Android)** — the user may grant approximate location only. If your feature works
  at city level, accept it rather than insisting on precise.
- **Background location** requires extra justification at review on both stores, and a separate
  Android permission (`ACCESS_BACKGROUND_LOCATION`) that must be requested after foreground
  location, not alongside it.
- Never request `always` for a feature that only needs location while the screen is open.

## Camera and photos

- **Read and add are separate on iOS.** An app that only saves needs `NSPhotoLibraryAddUsageDescription`
  and should not request read access.
- **Limited photo access** is a grant. Handle it — offer a way to select more photos rather than
  showing an error.
- **You may not need the permission at all.** The system image picker returns a photo without photo
  library access, and `expo-image-picker` uses it. Requesting a permission you can avoid is a
  gratuitous prompt and a rejection risk.

That last point generalises: prefer the system picker over direct library access wherever it fits.

## Notifications

Android 13+ made this a runtime permission (`POST_NOTIFICATIONS`); before that it was free. Declaring
without requesting displays nothing on 13+ while working on older devices. iOS has always required
it, once. Details in `rn-push`.

## Microphone

Frequently paired with camera for video, and it needs its own string. Requesting mic for a
video-recording feature and not explaining the audio part is a common rejection.

## Contacts

High scrutiny on both stores, and users are rightly suspicious. Requesting it to "find friends" is
a well-known pattern that reviewers examine closely. If you can achieve the goal with a share sheet
or an invite link, do that instead.

## Bluetooth

Android's model changed substantially with Android 12: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, and
`BLUETOOTH_ADVERTISE` replaced the older permissions, and scanning may still require location
depending on how you declare it. Getting this wrong yields a scan that returns nothing, with no
error — a silent failure that looks like a hardware problem.

## App Tracking Transparency (iOS)

Required before accessing the IDFA for tracking. `NSUserTrackingUsageDescription` is mandatory, and
the prompt must not be preceded by anything that looks like coercion. Most users decline; build for
that as the default case rather than the exception.

Requesting it when you do not actually track is a rejection.

## Biometrics

`NSFaceIDUsageDescription` is required for Face ID. Biometric authentication is not a permission in
the same sense — the check is about device capability and enrolment as much as authorisation, and
the failure modes (no hardware, not enrolled, locked out after failures) each need their own
handling. Anything where biometrics gates access to data is also a `rn-security` question.
