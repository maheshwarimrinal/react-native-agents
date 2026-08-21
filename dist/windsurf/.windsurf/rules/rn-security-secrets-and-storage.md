---
trigger: manual
description: "RN Security: Secrets and Data at Rest"
---

# Secrets and Data at Rest

## The bundle is public — proof

```bash
# Android
unzip -o app.apk -d apk/
strings apk/assets/index.android.bundle | rg -i 'api[_-]?key|secret|password|token|bearer|sk_live|AKIA'

# iOS (from an .ipa)
unzip -o app.ipa -d ipa/
strings ipa/Payload/*.app/main.jsbundle | rg -i 'api[_-]?key|secret'

# Hermes bytecode is not a protection — it decompiles
# (hbctool, hermes-dec, and hasmer all do this publicly)
```

This defeats **every** build-time secret mechanism:

| Mechanism | Ends up in the bundle? |
|---|---|
| `.env` + `react-native-dotenv` | Yes, inlined at build |
| `react-native-config` | Yes, plus `BuildConfig`/plist |
| `expo-constants` `extra` | Yes, in the manifest |
| EAS "secrets" | Yes — they're build-time env vars, not runtime secrets |
| Babel `transform-inline-environment-variables` | Yes, literally inlined |
| Native constant in Swift/Kotlin | Yes, in `strings` output of the binary |

**The only correct pattern for a privileged secret:** it never leaves your server. The client
authenticates as a user; the server holds the third-party credential and makes the call.

```
Client → your backend (user-authenticated) → third-party API (server-held secret)
```

### What *is* acceptable in the client

Public/publishable identifiers designed to be exposed, where the server enforces the real
control: Stripe publishable key, Firebase web config, Google Maps API key **with platform and
API restrictions applied in the console**, Sentry DSN, a public app ID. For each of these,
verify the server-side restriction actually exists — an unrestricted Maps key is a real bill.

### If a secret has shipped

1. **Rotate it immediately.** It is compromised for every install already in the wild.
2. Audit its usage logs for abuse.
3. Then remove it from source, and scrub git history (`git filter-repo`) so it doesn't get
   re-introduced.
4. Add a pre-commit secret scanner (`gitleaks`, `trufflehog`) so it can't happen again.

## Secure storage

### The decision table

| Data | Store in | Never in |
|---|---|---|
| Auth / refresh tokens | Keychain (iOS) / Keystore-backed EncryptedSharedPreferences (Android) | AsyncStorage, MMKV (unencrypted), redux-persist |
| Encryption keys | Keychain / Keystore, hardware-backed where available | Anywhere in JS |
| PII (name, email, address) | Encrypted store, or don't persist at all | Plaintext AsyncStorage |
| Session/UX prefs | AsyncStorage or MMKV | — |
| Cached API responses | MMKV / SQLite — encrypted if they contain PII | — |
| Biometric "enabled" flag | Keychain-gated secret, not a boolean | A plain boolean anywhere |

### Correct implementations

```ts
// expo-secure-store (Expo, and works in bare)
import * as SecureStore from 'expo-secure-store';

await SecureStore.setItemAsync('refresh_token', token, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,  // no iCloud sync, no backup
  requireAuthentication: false,   // true = gate behind biometrics
});
```

```ts
// react-native-keychain (bare RN, more control)
import * as Keychain from 'react-native-keychain';

await Keychain.setGenericPassword('user', token, {
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,   // invalidates if biometrics change
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,        // Android StrongBox/TEE
  storage: Keychain.STORAGE_TYPE.AES_GCM,
});
```

**iOS accessibility levels — pick deliberately:**

| Level | Meaning |
|---|---|
| `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | Default choice for tokens. Not backed up, not synced. |
| `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` | Needed for background work after reboot. |
| `WHEN_UNLOCKED` | Syncs to iCloud Keychain — usually wrong for app tokens. |
| `ALWAYS` | Deprecated and insecure. Flag it. |

**Android:** `ACCESS_CONTROL.BIOMETRY_CURRENT_SET` invalidates the key if the user adds a
fingerprint — that's the property you want for "an attacker who enrolled their own biometric
must not get in".

### MMKV encryption

```ts
// The encryption key must NOT be a hardcoded string
const key = await SecureStore.getItemAsync('mmkv_key') ?? generateAndStore();
export const storage = new MMKV({ id: 'secure', encryptionKey: key });
```

`new MMKV({ encryptionKey: 'my-app-key' })` with a literal is theatre — the key is in the bundle.

### SQLite

Use SQLCipher (`op-sqlite` with encryption, `expo-sqlite` with a key, or Realm's encryption) when
the database holds PII. Key management is the same problem: the key lives in the Keychain.

### AsyncStorage reality check

AsyncStorage is **unencrypted**:
- Android: a plain SQLite file in the app sandbox — readable on a rooted device, and included in
  ADB backups if `android:allowBackup="true"`.
- iOS: a plist in the app container — readable from an unencrypted iTunes/Finder backup.

It is fine for non-sensitive preferences. It is not a place for anything an attacker would want.

## Other at-rest leaks people forget

- **Logs.** `console.log` output goes to logcat / Console.app in release builds unless stripped.
  Strip them: `babel-plugin-transform-remove-console` in production, plus a lint rule.
- **Redux DevTools / state persistence** dumping an entire authenticated state tree to disk.
- **Crash reports** attaching state, breadcrumbs, or request bodies containing tokens. Configure
  `beforeSend` scrubbing in Sentry/Bugsnag.
- **Screenshots** — iOS and Android snapshot the app on backgrounding for the app switcher. On
  sensitive screens, blur or cover it (`FLAG_SECURE` on Android, a cover view on
  `applicationWillResignActive` on iOS). `FLAG_SECURE` also blocks screen recording.
- **Keyboard cache / autofill.** `secureTextEntry` on password fields, plus
  `autoComplete="off"` / `textContentType="oneTimeCode"` where appropriate, and
  `autoCorrect={false}` so sensitive strings don't enter the dictionary.
- **Clipboard.** Copied OTPs and tokens are readable by other apps. Clear after use; on Android
  mark clips sensitive.
- **Temp files and caches** written by image pickers, document viewers, and PDF renderers. Clean
  them up.
- **ADB backup:** set `android:allowBackup="false"` (or a strict `dataExtractionRules`) for apps
  holding sensitive data.

## Audit grep

```bash
rg -i "(api[_-]?key|secret|passwd|password|token|private[_-]?key)\s*[:=]\s*['\"][A-Za-z0-9_\-]{12,}" --glob "**/*.{js,jsx,ts,tsx}"
rg 'sk_live_|sk_test_|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{35}|ghp_[A-Za-z0-9]{36}|xox[baprs]-'
rg 'AsyncStorage\.setItem' --glob "**/*.{js,jsx,ts,tsx}" -B 2 -A 2      # check what's being stored
rg 'new MMKV\(' -A 3                                 # literal encryptionKey?
rg 'console\.(log|warn|debug)' --glob "**/*.{js,jsx,ts,tsx}" -l
rg 'allowBackup|dataExtractionRules' android/app/src/main/AndroidManifest.xml
rg 'secureTextEntry' --type tsx                       # present on every password field?
git log -p --all -S 'sk_live' | head                  # secrets in history
npx gitleaks detect --no-git -v
```
