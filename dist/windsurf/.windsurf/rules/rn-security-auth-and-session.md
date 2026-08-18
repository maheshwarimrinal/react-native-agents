---
trigger: manual
description: "RN Security: Authentication and Session Management"
---

# Authentication and Session Management

## OAuth / OIDC on mobile

**Use Authorization Code + PKCE. Nothing else.**

- The **implicit flow** is deprecated — it returns a token in a URL fragment, which is
  interceptable and lands in logs. If you find `response_type=token`, that's a finding.
- **ROPC** (username/password straight to the token endpoint) defeats the point of federated auth,
  can't do MFA properly, and trains users to type credentials into your UI. Flag it.
- **Client secrets do not exist on mobile.** A public client cannot keep a secret (see
  `secrets-and-storage.md`). PKCE exists precisely to replace it. If the code embeds a
  `client_secret`, it is extractable and must be rotated and removed.

```ts
// expo-auth-session — PKCE by default
const [request, response, promptAsync] = useAuthRequest(
  {
    clientId,
    scopes: ['openid', 'profile', 'offline_access'],
    redirectUri: makeRedirectUri({ scheme: 'myapp', path: 'auth' }),
    usePKCE: true,
  },
  discovery,
);
```

### The browser matters

Use **ASWebAuthenticationSession** (iOS) / **Custom Tabs** (Android) — that's what
`expo-web-browser` and `react-native-app-auth` use. Do **not** run an OAuth flow inside a
`WebView`: your app can read the credentials the user types, which breaks the trust model, defeats
password-manager and passkey integration, and gets rejected by Google and others.

### Redirect hijacking

A custom scheme (`myapp://`) can be registered by **any** app on Android — a malicious app can
claim it and receive your authorization code.

- PKCE makes a stolen code useless without the verifier, which is the main mitigation.
- Prefer **Universal Links / App Links** (HTTPS, cryptographically verified by domain ownership)
  over custom schemes for auth callbacks.
- Validate the `state` parameter on return — always, and with a value you generated. Missing
  `state` validation is CSRF on your auth flow.

## Token handling

| Token | Storage | Lifetime |
|---|---|---|
| Access token | Memory preferred; Keychain if it must survive a restart | Minutes to an hour |
| Refresh token | Keychain / Keystore, `THIS_DEVICE_ONLY`, ideally biometric-gated | Long, but rotated on every use |
| ID token | Memory; it's a claims carrier, not a credential | Short |

Requirements:

- **Refresh token rotation** with reuse detection. If a rotated token is presented twice, the
  family is compromised — revoke the whole family server-side.
- **Server-side revocation.** Logout must invalidate on the server, not merely delete locally.
  "We removed it from storage" is not logout; the token still works if it was captured.
- **Single-flight refresh.** Concurrent 401s must not fire N parallel refreshes — with rotation
  enabled that triggers reuse detection and logs everyone out. Queue them behind one refresh.
- **Never in a URL, log, or analytics event.**
- **Clear on logout:** Keychain entries, query cache, persisted store, cookies, WebView data,
  and any in-memory copies. Leftover cached PII after logout is a real and frequently-missed leak
  on shared devices.

```ts
// Single-flight refresh
let inflight: Promise<string> | null = null;
async function getFreshToken() {
  if (!inflight) {
    inflight = refresh().finally(() => { inflight = null; });
  }
  return inflight;
}
```

## JWT handling

- The client may **read** claims for UI purposes. The client must never **trust** them for
  authorisation — the server verifies signature, `exp`, `iss`, `aud` on every request.
- Never accept `alg: none`, and never verify with a key shipped in the app.
- Don't put PII in a JWT you store; it's base64, not encrypted, and readable by anyone with the
  device.
- Treat `exp` in the client as a refresh hint with clock skew tolerance, not a security boundary.

## Biometrics — done correctly

The common implementation is fake security:

```ts
// ✗ theatre — the "unlock" result is a boolean an attacker patches or hooks
const { success } = await LocalAuthentication.authenticateAsync();
if (success) setLoggedIn(true);              // token was accessible all along
```

The token must be **cryptographically gated** by the biometric, so that failing it means the data
is genuinely unavailable, not merely a `false` return value:

```ts
// ✓ the OS will not release the secret without biometric authentication
await Keychain.setGenericPassword('user', refreshToken, {
  accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
});
// retrieval prompts biometrics natively and fails closed
```

Also handle:
- **Enrolment changes.** `BIOMETRY_CURRENT_SET` invalidates the key if a new fingerprint/face is
  enrolled — that's the property that stops "attacker adds their own fingerprint".
- **Fallback path.** Device passcode fallback is reasonable; falling back to "just let them in"
  is not.
- **Availability.** Check `hasHardwareAsync` / `isEnrolledAsync` and degrade to password login.

## Session lifetime and re-auth

- Idle timeout appropriate to the data (banking: minutes; social: days).
- Re-authenticate for sensitive actions: changing password/email, adding a payee, exporting data,
  deleting the account.
- Handle `AppState` transitions: lock on background for high-sensitivity apps, and combine with
  screenshot protection so the app-switcher snapshot doesn't show account data.
- Support "log out all devices" — session enumeration and revocation server-side.

## Registration and recovery

The strongest login is worthless if recovery is weak. Check:

- Account enumeration on signup/reset ("this email is already registered" leaks membership).
- Rate limiting and bot protection on OTP send and verify.
- OTP entropy (6 digits minimum), short expiry, single use, attempt limits.
- SMS OTP is phishable and SIM-swappable — prefer TOTP or passkeys where the risk warrants it.
- Password reset tokens: single use, short-lived, invalidate existing sessions on use.
- **Passkeys / WebAuthn** are supported on both platforms now and eliminate whole categories of
  this. Worth recommending for new builds.

## Audit grep

```bash
rg 'response_type=token|implicit'                       # deprecated flow
rg 'client_secret' --glob "**/*.{js,jsx,ts,tsx}"                            # must not exist on mobile
rg 'usePKCE|code_challenge'                             # should be present
rg -i 'authenticateAsync' --glob "**/*.{js,jsx,ts,tsx}" -A 6                # biometric theatre check
rg 'AsyncStorage.*[Tt]oken|persist.*auth' --glob "**/*.{js,jsx,ts,tsx}"     # tokens in insecure storage
rg -i 'logout|signOut' --glob "**/*.{js,jsx,ts,tsx}" -A 12                  # does it clear everything?
rg 'jwtDecode|jwt_decode' --glob "**/*.{js,jsx,ts,tsx}" -A 4                # decode used for authz decisions?
rg 'state' --glob "**/*.{js,jsx,ts,tsx}" -C 3 | rg -i 'oauth|authoriz'      # state validated?
```
