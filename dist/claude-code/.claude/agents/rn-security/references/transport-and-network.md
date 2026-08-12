# Transport Security

Assume the user is on hostile WiFi and an attacker controls the network path. Everything below
follows from that.

## TLS must be enforced

### iOS — App Transport Security

`ios/<App>/Info.plist`:

```xml
<!-- ✗ P0: disables TLS validation app-wide -->
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key><true/>
</dict>

<!-- ✓ ATS on, with a narrow, justified exception if genuinely needed -->
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSExceptionDomains</key>
  <dict>
    <key>legacy.partner.example</key>
    <dict>
      <key>NSExceptionMinimumTLSVersion</key><string>TLSv1.2</string>
    </dict>
  </dict>
</dict>
```

`NSAllowsArbitraryLoads` is also an App Store review question — Apple asks you to justify it.
Common cause: someone added it to make a local HTTP dev server work and never removed it.

### Android — network security config

`android/app/src/main/res/xml/network_security_config.xml`:

```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />   <!-- note: no "user" — see below -->
    </trust-anchors>
  </base-config>
  <!-- localhost-only exception for dev, scoped to debug builds -->
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
```

Referenced from the manifest: `android:networkSecurityConfig="@xml/network_security_config"`.

**Do not trust user-installed CAs in release.** `<certificates src="user" />` is what lets an
analyst (or attacker) install a Burp/mitmproxy CA and read all your traffic. React Native's debug
config includes it — verify it is not in the release variant. This is a genuinely common leak:
the debug `network_security_config` gets copied into `main/`.

Also check `android:usesCleartextTraffic` in the manifest — `true` is a finding.

### In code

```ts
// ✗ P0 — every one of these disables validation
new https.Agent({ rejectUnauthorized: false })
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
// custom TrustManager that accepts all certs in a native module
```

Search for these before anything else. They are usually a debugging shortcut that shipped.

## Certificate pinning

Pinning defends against a compromised or coerced CA and against a user-installed proxy CA. It is
worth doing for apps handling money, health data, or credentials.

```ts
// react-native-ssl-public-key-pinning — pins the SPKI hash, survives cert renewal
import { initializeSslPinning } from 'react-native-ssl-public-key-pinning';

await initializeSslPinning({
  'api.example.com': {
    includeSubdomains: true,
    publicKeyHashes: [
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',   // current leaf/intermediate SPKI
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',   // backup key — MANDATORY
    ],
  },
});
```

**Pin the public key (SPKI), not the certificate.** Certificates rotate; keys can be kept.

**Always ship a backup pin.** Pinning to a single key means that when the cert is rotated — or
revoked in an emergency — every installed app instantly loses connectivity and the only fix is a
store update. This has bricked real apps for days. Requirements:

1. At least two pins (current + next), controlled by you.
2. A documented rotation runbook, with the next key generated in advance.
3. A remote kill-switch or a short pin expiry so a mistake is recoverable.
4. Verified in CI against the real endpoint so an expired pin fails the build, not production.

If the team can't commit to that operational discipline, pinning will cause more outage than it
prevents attack. Say so honestly rather than recommending it reflexively.

## Verify it actually works

```bash
# Set the device proxy to mitmproxy and install its CA, then run the app.
mitmproxy --mode regular --listen-port 8080
# Expected: with correct config, requests to your API fail. If you can read the
# request bodies, TLS validation and/or pinning is not doing its job.

# Inspect the shipped configs
rg -A 5 'NSAppTransportSecurity' ios/*/Info.plist
rg 'usesCleartextTraffic|networkSecurityConfig' android/app/src/main/AndroidManifest.xml
cat android/app/src/main/res/xml/network_security_config.xml
```

## What else goes over the network

- **Third-party SDKs** make their own requests with their own TLS settings. An analytics or ad
  SDK can leak device identifiers and user data over links you didn't configure. Inventory the
  traffic with a proxy on a device where you control the CA (a debug build), and check each SDK's
  data-collection docs.
- **WebViews** don't inherit your pinning. See `webview-and-deeplinks.md`.
- **Image loaders** and **OTA update clients** are separate network stacks; confirm they use HTTPS.
- **Deep-link callbacks** can carry tokens over channels you don't control.

## Server-side controls the client cannot replace

Say this explicitly in reviews — mobile devs routinely try to solve these in the app:

- **Authorisation.** Every endpoint verifies the caller may do the thing. Client-side role checks
  are UI hints only.
- **Rate limiting and abuse control.** Per-user and per-IP, on the server.
- **IDOR prevention.** `GET /orders/12345` must check ownership. Sequential IDs plus no check is
  the single most common mobile-backend vulnerability.
- **Input validation.** Re-validate everything server-side; the client is attacker-controlled.
- **GraphQL:** disable introspection in production, enforce query depth/complexity limits, and use
  persisted queries.

## Headers and payloads

- Never put tokens in URLs or query strings — they land in server logs, proxy logs, and Referer
  headers. Use `Authorization`.
- Don't log full request/response bodies in release.
- Set explicit timeouts; a hanging request is a DoS on your own UX.
- Validate and constrain redirects — a redirect chain can strip your `Authorization` header onto
  a third-party host, or leak it to one.
