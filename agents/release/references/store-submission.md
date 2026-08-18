# Store Submission

## Submit

```bash
eas submit --platform ios --profile production --latest
eas submit --platform android --profile production --latest
```

```ruby
# Fastlane
upload_to_testflight(skip_waiting_for_build_processing: true)
upload_to_play_store(track: 'internal', release_status: 'draft')
```

Ship to an internal track first, always. TestFlight internal testing has no review; Play internal
testing is near-instant. Verify the actual store binary on a real device before promoting it —
this catches signing, entitlement, and configuration problems that no CI check will.

## Pre-submission checklist

**Both platforms**
- [ ] Version and build number incremented
- [ ] Release build verified on a physical device (not just a simulator)
- [ ] Crash reporting live, source maps uploaded for this exact build
- [ ] All permissions used are declared, with honest purpose strings
- [ ] Account deletion available in-app (required if you allow in-app signup)
- [ ] Privacy policy URL live and reachable
- [ ] Test account provided for review, working, and not rate-limited or expiring
- [ ] Deep links and push notifications tested against production endpoints
- [ ] No placeholder content, lorem ipsum, or debug UI

**iOS**
- [ ] `PrivacyInfo.xcprivacy` present and accurate, covering required-reason APIs
- [ ] App Privacy answers in App Store Connect match actual behaviour, including SDK behaviour
- [ ] Export compliance (`ITSAppUsesNonExemptEncryption`) answered
- [ ] Screenshots for every required size class; no device frames with status bar inconsistencies
- [ ] ATT prompt implemented if you access IDFA, and its usage description is present
- [ ] Sign in with Apple offered if you offer any other third-party sign-in
- [ ] In-app purchases used for digital goods (external payment links are a rejection)

**Android**
- [ ] AAB, not APK
- [ ] Data Safety form completed and accurate
- [ ] Target API level meets Play's current requirement (it rises annually; a stale target blocks
      updates entirely)
- [ ] Sensitive permissions (background location, `QUERY_ALL_PACKAGES`, SMS, accessibility
      service) declared with justification, or removed
- [ ] Play App Signing enabled
- [ ] Content rating questionnaire done
- [ ] Ads declaration correct

## Common rejections and how to avoid them

| Reason | Fix |
|---|---|
| **Crash on review** | Reviewers use the worst network and a fresh install. Test cold-start on a wiped device with a throttled connection. |
| **Login required, no credentials** | Provide a working demo account in review notes; make sure it doesn't expire or hit rate limits. |
| **Incomplete / placeholder content** | No "coming soon" screens, no empty tabs. |
| **Privacy label mismatch** | Reconcile declared collection against what your SDKs actually send. Proxy the app and check. |
| **Missing account deletion** | Both stores require it for apps with in-app account creation. |
| **Permission without justification** | Remove unused permissions (often inherited from a removed dependency and still in the merged manifest) and add purpose strings for the rest. |
| **External payment for digital goods** | Use IAP/Play Billing; even a link to a web checkout can be rejected. |
| **Guideline 4.2 "minimum functionality"** | A thin wrapper around a website gets rejected. Native features, offline behaviour, push. |
| **Sign in with Apple missing** | Required if you offer Google/Facebook/etc. sign-in. |
| **Design/HIG issues** | Broken layout at the largest text size, unreachable content behind a notch, non-functional buttons. |
| **Metadata issues** | Screenshots that don't match the app, competitor names in keywords, unsupported claims. |

Check the merged manifest for surprise permissions — this catches a common Play rejection:

```bash
aapt dump permissions app.apk
rg 'uses-permission' android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml
```

## Review timing

- **iOS**: typically hours to a couple of days. Expedited review exists for genuine emergencies
  (a crash affecting many users, a security fix) — use it sparingly; it's a finite goodwill budget.
- **Android**: hours for established apps; new apps and sensitive-permission changes take longer.
  Production track updates go through review; internal testing generally doesn't.

Never plan a launch that depends on review completing on a specific day. Submit early, hold the
release manually.

## Phased and staged release

**iOS — Phased Release** (App Store Connect): automatic 7-day ramp — 1%, 2%, 5%, 10%, 20%, 50%,
100%. You can pause at any point. Enable it for every release; it converts a bad build from a
100% incident into a 1% incident.

**Android — Staged rollout** (Play Console): you choose the percentages. A reasonable ladder:
5% → 20% → 50% → 100%, with at least a few hours and a crash-free check at each step. You can
**halt** a rollout, which stops further distribution (but doesn't remove it from users who already
got it — hence the halt-then-hotfix pattern).

Gate each step on data, not on a schedule:

```
crash-free sessions ≥ 99.5%  AND  crash-free users ≥ 99.0%  AND  no new P0 issue  →  proceed
```

Agree the numbers before you ship, or they get negotiated downward at 11pm under pressure.

## Release notes

Write for users, not for your changelog:

```
✗ "Bumped RN to 0.85, refactored the cart reducer, fixed NPE in OrderService"
✓ "Faster checkout — the payment screen now loads instantly.
   Fixed a bug where cart totals were wrong with multiple discounts."
```

Localise them for your top markets. If you're fixing something users complained about publicly,
say so — it visibly reduces negative reviews.

## Post-submission

- Keep the build in "manual release" so you control the moment it goes live.
- Have a hotfix path ready: for JS-only bugs, OTA; for native bugs, a fast-tracked build.
- Monitor reviews for the first 48 hours — users report crashes there before your dashboards
  surface them.
- Watch adoption: if users aren't upgrading, in-app update prompts (`expo-updates`, or Play
  In-App Updates) are worth adding.

## Audit

```bash
rg 'submit' eas.json -A 10
find ios -name 'PrivacyInfo.xcprivacy'
rg 'ITSAppUsesNonExemptEncryption|NS.*UsageDescription' ios/*/Info.plist
rg 'targetSdkVersion|compileSdkVersion' android/build.gradle android/app/build.gradle
rg 'uses-permission' android/app/src/main/AndroidManifest.xml
rg -i 'deleteAccount|delete.*account' --glob "**/*.{js,jsx,ts,tsx}"
```
