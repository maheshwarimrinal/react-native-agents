---
trigger: manual
description: "RN Security: OWASP MASVS Checklist for React Native"
---

# OWASP MASVS Checklist for React Native

Use this to structure a full review and to tag findings. MASVS v2 has eight control groups; each
maps to concrete RN checks below. Reference the control ID in every finding so the report is
auditable.

## MASVS-STORAGE — data at rest

- [ ] No credentials, tokens, or keys in AsyncStorage / MMKV without encryption
- [ ] Tokens in Keychain / Keystore with an appropriate accessibility level
- [ ] `THIS_DEVICE_ONLY` where the secret must not sync to iCloud or leave the device
- [ ] `android:allowBackup="false"` or strict `dataExtractionRules`
- [ ] No sensitive data in logs (`console.*` stripped in release)
- [ ] No sensitive data in crash reports / analytics / breadcrumbs
- [ ] Caches, temp files, and image caches cleared on logout
- [ ] Keyboard cache disabled on sensitive fields (`secureTextEntry`, `autoCorrect={false}`)
- [ ] Clipboard cleared after copying sensitive values
- [ ] App-switcher snapshot protected on sensitive screens
- [ ] SQLite / Realm encrypted when holding PII

## MASVS-CRYPTO — cryptography

- [ ] No hardcoded keys, IVs, or salts anywhere in the JS bundle or native code
- [ ] Platform crypto (`expo-crypto`, CryptoKit, Android Keystore) over JS implementations
- [ ] No MD5 / SHA-1 / DES / RC4 / ECB mode
- [ ] AES-GCM (or equivalent AEAD) with a unique random IV per encryption
- [ ] Keys generated with a CSPRNG, stored in hardware-backed storage where available
- [ ] Key rotation possible without breaking existing data
- [ ] No custom crypto. Ever.

## MASVS-AUTH — authentication and authorisation

- [ ] Authorization Code + PKCE; no implicit flow, no ROPC, no embedded client secret
- [ ] Auth flow uses `ASWebAuthenticationSession` / Custom Tabs, not a WebView
- [ ] `state` generated and validated
- [ ] Refresh token rotation with reuse detection
- [ ] Server-side session revocation on logout
- [ ] Single-flight token refresh
- [ ] Biometric gate is cryptographic (key release), not a boolean check
- [ ] Biometric key invalidated on enrolment change
- [ ] Session timeout appropriate to data sensitivity; re-auth for sensitive actions
- [ ] **Authorisation enforced server-side** — no client-only access control
- [ ] Account recovery hardened (rate limits, OTP entropy, single use, no enumeration)

## MASVS-NETWORK — transport

- [ ] TLS 1.2+ everywhere; no cleartext
- [ ] `NSAllowsArbitraryLoads` absent (or a narrow, justified domain exception)
- [ ] `usesCleartextTraffic="false"`
- [ ] Release network security config does **not** trust user-installed CAs
- [ ] No `rejectUnauthorized: false` or trust-all TrustManager
- [ ] Certificate pinning where warranted, with backup pins and a rotation runbook
- [ ] Third-party SDK traffic inventoried
- [ ] No tokens in URLs; redirects validated
- [ ] Explicit request timeouts

## MASVS-PLATFORM — platform interaction

- [ ] WebView: `originWhitelist` scoped, file access disabled, universal access off
- [ ] `postMessage` input origin-checked, schema-validated, action allow-listed
- [ ] No user-supplied HTML in a WebView with a privileged bridge
- [ ] Deep-link parameters validated; no open redirect via `Linking.openURL`
- [ ] Universal Links / App Links verified (`apple-app-site-association`, `assetlinks.json`)
- [ ] Deep links cannot bypass auth or perform unconfirmed state changes
- [ ] Every `exported="true"` Android component justified and input-validated
- [ ] Permissions minimal, requested in context, with honest purpose strings
- [ ] Custom keyboards / IME risk considered on sensitive input

## MASVS-CODE — code quality and data validation

- [ ] All server responses validated at the boundary (zod / io-ts) before use
- [ ] No `eval`, `new Function`, or dynamic code construction from remote data
- [ ] Dependencies scanned; no reachable known-vulnerable packages
- [ ] Lockfile committed; CI uses frozen installs
- [ ] `patches/` reviewed and justified
- [ ] Debug code, test endpoints, and backdoor flags removed from release
- [ ] Error messages don't leak stack traces, internal hostnames, or SQL
- [ ] Errors handled — no silent `catch {}` swallowing security failures

## MASVS-RESILIENCE — reverse engineering defence

*(Only required for apps with a real anti-tamper requirement; be honest about its limits.)*

- [ ] R8 / ProGuard enabled for release
- [ ] Source maps generated but not shipped
- [ ] Console output stripped
- [ ] Root / jailbreak detection as a risk signal (not a hard gate)
- [ ] Debugger and emulator detection where warranted
- [ ] App signature verification at runtime
- [ ] OTA updates code-signed, with staged rollout and rollback
- [ ] No secrets that obfuscation is being asked to protect

## MASVS-PRIVACY — user privacy

- [ ] `PrivacyInfo.xcprivacy` present and accurate, including required-reason APIs
- [ ] Store privacy labels / Data Safety form match observed behaviour
- [ ] Consent obtained before any analytics or tracking SDK initialises
- [ ] Granular consent with real rejection
- [ ] In-app account deletion available
- [ ] Data minimisation applied; retention limits defined
- [ ] ATT prompt correct; denial respected; no fingerprinting fallback
- [ ] Push payloads don't expose sensitive content on the lock screen

## Verification tooling

```bash
# Static
npx osv-scanner --lockfile=package-lock.json
npx gitleaks detect --no-git -v
npx eslint . --plugin security

# Binary inspection
unzip -o app.apk -d apk/ && strings apk/assets/index.android.bundle | rg -i 'key|secret|token'
apkanalyzer manifest print app.apk
jadx -d out app.apk            # inspect the decompiled native side

# Dynamic
mitmproxy --mode regular       # with device CA installed — should FAIL if pinning works
frida-ps -U                    # confirm hooking resistance if resilience matters
adb shell pm get-app-links <package>
adb backup -f out.ab <package> # should produce nothing if allowBackup=false
```

MASTG (the Mobile Application Security Testing Guide) has the full test procedures behind each
control; cite the specific test ID when a finding needs a formal reference.
