# Privacy Declarations

Three declarations that must all describe the same reality: Apple's nutrition labels, Apple's
privacy manifest, and Play's Data Safety form.

## Start from what actually leaves the device

Do not fill these in from memory or from the code you wrote. Most surprises come from SDKs
collecting things nobody declared.

```bash
rg -n "\"(dependencies|devDependencies)\"" -A60 package.json | rg -i "analytics|sentry|crashlytics|facebook|firebase|segment|amplitude|mixpanel|appsflyer|adjust|branch|onesignal"
```

Then verify empirically: proxy a debug build, exercise the app, and list every domain contacted and
what was sent. Teams are routinely surprised — and a declaration built on assumption is the thing
that later reads as a misrepresentation.

## Apple privacy manifest — `PrivacyInfo.xcprivacy`

Declares the data types you collect, the reasons you use certain "required reason" APIs, and the
tracking domains you contact.

Two things that catch React Native apps specifically:

**Required reason APIs.** File timestamps, disk space, system boot time, and user defaults each
need a declared reason code. React Native and its common dependencies touch several of these.

**Third-party SDK manifests.** Many SDKs must ship their own manifest, and if a dependency has not
updated to provide one, you get a warning — and eventually a rejection — for something in a library
you do not control. The fix is upgrading the library, which makes this an upgrade problem as much as
a privacy one. Hand it to `rn-dependencies`.

```bash
fd PrivacyInfo.xcprivacy ios/ node_modules/ 2>/dev/null | head -20
```

## App Tracking Transparency

Required before accessing the IDFA or tracking across apps and sites.

- The prompt must come **before** any tracking begins.
- `NSUserTrackingUsageDescription` is mandatory.
- Nothing that looks like coercion may precede it.
- **Do not show it if you do not track** — that is also a rejection.
- Most users decline. Build for the declined case as the default.

Note that "tracking" has a specific meaning here — linking user or device data with third-party data
for advertising or measurement. Analytics confined to your own app is generally not tracking, but
this is a judgement worth checking against current guidance rather than assuming.

## Nutrition labels and Data Safety must agree

Both describe collection and sharing. They use different taxonomies, which is how they end up
inconsistent — the same behaviour categorised differently on each store.

Fill them from one shared inventory of what you collect and why, then translate that inventory into
each form. Filling them independently, months apart, is how they diverge.

## Declare honestly

Under-declaring is discovered — through the manifest, through network analysis, or through a
complaint — and it escalates beyond a rejection to account-level consequences.

Over-declaring is harmless with reviewers and mildly costly with users, who read labels. Where you
are uncertain, declare and then reduce what you collect if you would rather the label were shorter.

## When declarations change

New SDKs, new features, and dependency upgrades all change what you collect. The declaration is not
a one-time task at first submission — it is a thing to re-check whenever dependencies change, which
in practice means at every release where `package.json` moved.
