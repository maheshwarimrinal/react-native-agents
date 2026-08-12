---
trigger: manual
description: "RN Security: Privacy and Compliance"
---

# Privacy and Compliance

Privacy failures are the most common cause of app rejection and of regulatory exposure. They are
also mostly avoidable by not collecting things.

## Apple privacy manifests

Required. Each app and each third-party SDK on Apple's list must ship a `PrivacyInfo.xcprivacy`
declaring:

- `NSPrivacyCollectedDataTypes` — what you collect, why, whether it's linked to identity, and
  whether it's used for tracking.
- `NSPrivacyAccessedAPITypes` — "required reason" APIs with a declared reason code. These cover
  file timestamps, `UserDefaults`, disk space, active keyboards, and system boot time. RN and
  many libraries touch these, so the declaration is not optional.
- `NSPrivacyTrackingDomains` — domains that receive tracking data; blocked when the user denies
  ATT.

Verify:
```bash
find ios -name 'PrivacyInfo.xcprivacy'
# and confirm every SDK in Apple's required-reason list ships or is covered by one
```

Expo generates this from config; bare projects need it added to the Xcode project. A missing or
inaccurate manifest triggers automated App Store Connect warnings that become rejections.

## App Store privacy labels / Play Data Safety

These must **match reality**, including what your SDKs do without your involvement. Auditors and
researchers compare declared behaviour against observed network traffic, and mismatches are both
a policy violation and a regulatory hook.

Practical check: proxy a debug build, exercise the app, and list every domain contacted and what
was sent. Reconcile with the declaration. People are routinely surprised by what an attribution
or ads SDK sends.

## ATT (iOS)

- Required before accessing IDFA or tracking across apps/websites owned by other companies.
- Prompt with context, at a moment that makes sense — not on first launch cold.
- Denial must be respected everywhere, including SDK-level tracking flags.
- Fingerprinting as an ATT workaround is explicitly prohibited and enforced.

## GDPR / CCPA / DPDP essentials

| Requirement | Implementation |
|---|---|
| Lawful basis | Consent for analytics/marketing; legitimate interest rarely covers tracking |
| Consent before collection | SDKs must not fire before the user consents. Most default to firing on init — initialise them *after* consent. |
| Granular choice | Separate toggles for analytics / marketing / personalisation. "Accept all" with no real reject is non-compliant. |
| Withdrawal | As easy as giving it |
| Access & portability | Export the user's data on request |
| **Deletion** | Real deletion, propagated to processors. Both stores now *require* an in-app account-deletion path if you allow in-app account creation. |
| Data minimisation | Don't collect what you don't need. The best privacy control. |
| Retention limits | Define and enforce them |
| Children | Under-13 (COPPA) / under-16 (GDPR) triggers stricter rules and store programme requirements |

**In-app account deletion** is worth calling out separately — it's a hard store requirement now
and a frequent rejection cause for apps that only offer "email us to delete".

## PII leaking through the side doors

The code usually handles the main path fine and leaks through telemetry:

- **Logs.** `console.log(user)`, `console.log(response)` in release. Strip console in production
  and lint against it.
- **Crash reports.** Sentry/Bugsnag breadcrumbs capture navigation params, request URLs, and
  sometimes bodies. Configure scrubbing:
  ```ts
  Sentry.init({
    sendDefaultPii: false,
    beforeSend(event) { delete event.user?.email; return scrub(event); },
    beforeBreadcrumb(b) { return b.category === 'http' ? redactUrl(b) : b; },
  });
  ```
- **Analytics event properties** carrying email, phone, full addresses, or free-text the user
  typed. Review the event schema, not just the code.
- **URLs.** IDs, tokens, and emails in query strings land in every log along the path.
- **Screenshots** in the app switcher and in support tooling.
- **Clipboard** — copied content is readable by other apps; both platforms now notify the user.
- **Push notification payloads** appear on the lock screen. Don't put medical results, message
  bodies, or balances in them by default.
- **Backups.** `allowBackup="true"` and iCloud backup can carry PII off-device.

## Encryption compliance

- iOS export compliance: `ITSAppUsesNonExemptEncryption` in `Info.plist`. Standard HTTPS is
  exempt; declaring it correctly avoids a per-submission questionnaire.
- Some jurisdictions restrict encryption or require data residency. If the app operates in
  regulated markets, that's a product question, not a code one — flag it for legal.

## Sector-specific

- **HIPAA** (health): BAAs with every processor, encryption at rest and in transit, audit logs,
  automatic logoff, minimum necessary access.
- **PCI DSS** (payments): do not touch raw card data. Use the processor's hosted fields or SDK so
  card data never enters your app's memory. If your app has a card-number `TextInput`, that's a
  finding.
- **Financial / banking**: often jurisdictional requirements for pinning, jailbreak detection,
  session timeouts, and transaction signing.

## Audit grep

```bash
rg 'console\.(log|info|debug|warn)' --type ts -l
rg -i 'analytics|track|logEvent' --type ts -A 3 | rg -i 'email|phone|address|ssn|dob|name'
rg 'sendDefaultPii|beforeSend|beforeBreadcrumb' --type ts
find ios -name 'PrivacyInfo.xcprivacy'
rg 'ITSAppUsesNonExemptEncryption' ios/*/Info.plist
rg -i 'delete.*account|deleteAccount' --type ts     # in-app deletion present?
rg -i 'consent|gdpr|cmp' --type ts -l
rg 'allowBackup' android/app/src/main/AndroidManifest.xml
```
