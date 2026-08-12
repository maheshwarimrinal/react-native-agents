---
trigger: manual
description: "RN Security: WebViews and Deep Links"
---

# WebViews and Deep Links

These are the two places where untrusted input crosses into your app's trust boundary. Treat both
as hostile by default.

## WebView

A `WebView` is a full browser embedded in your app, with whatever privileges you grant it.

### Secure configuration

```tsx
<WebView
  source={{ uri: trustedUrl }}

  // Restrict what can load
  originWhitelist={['https://app.example.com']}   // ✗ never ['*']
  onShouldStartLoadWithRequest={(req) => isAllowedOrigin(req.url)}

  // Disable everything not required
  javaScriptEnabled={false}                  // only enable if genuinely needed
  allowFileAccess={false}
  allowFileAccessFromFileURLs={false}
  allowUniversalAccessFromFileURLs={false}   // ✗ true breaks same-origin entirely
  allowingReadAccessToURL={undefined}
  setSupportMultipleWindows={true}           // false + JS enabled enables popup abuse
  javaScriptCanOpenWindowsAutomatically={false}
  mixedContentMode="never"                   // Android: no HTTP inside HTTPS
  thirdPartyCookiesEnabled={false}
  incognito                                   // no persistent storage for untrusted content
  cacheEnabled={false}
/>
```

### The findings to look for

| Setting | Risk |
|---|---|
| `originWhitelist={['*']}` | Any redirect leads anywhere; injected content runs with your bridge |
| `allowUniversalAccessFromFileURLs={true}` | A local HTML file can read any origin — full SOP bypass |
| `allowFileAccess={true}` | `file://` navigation can read the app sandbox |
| `mixedContentMode="always"` | Downgrade attacks inside an HTTPS page |
| Rendering user-supplied HTML | Stored XSS with access to whatever the bridge exposes |
| `source={{ html: userContent }}` | Same, directly |
| `injectedJavaScript` built by string concatenation | Injection into your own injected script |

### The bridge is the real risk

`postMessage` from web → native is **attacker-controlled input** whenever the page can be
influenced by anyone but you.

```tsx
// ✗ blind trust
onMessage={(e) => { const cmd = JSON.parse(e.nativeEvent.data); handlers[cmd.type](cmd.args); }}

// ✓ verify origin, validate shape, allow-list actions
onMessage={(e) => {
  if (e.nativeEvent.url && !isAllowedOrigin(e.nativeEvent.url)) return;
  const parsed = MessageSchema.safeParse(safeJsonParse(e.nativeEvent.data));  // zod
  if (!parsed.success) return;
  switch (parsed.data.type) {
    case 'CLOSE': close(); break;
    case 'TRACK': track(parsed.data.name); break;
    default: return;                       // never a dynamic dispatch table
  }
}}
```

Never expose a generic "call this native function by name" bridge. Never expose token retrieval,
file access, or navigation-to-arbitrary-URL over `postMessage`.

Also note: **WebViews do not inherit your certificate pinning** and have their own cookie store.
If you pin, and a WebView loads authenticated content, that path is unpinned.

### Don't use a WebView for

- OAuth login (use `ASWebAuthenticationSession` / Custom Tabs — see `auth-and-session.md`).
- Payment card entry, unless it's a PCI-compliant hosted field from your processor.
- Rendering arbitrary user content in the same WebView that has a privileged bridge. Use two
  WebViews with different configurations if you need both.

## Deep links

### Custom schemes are not authenticated

`myapp://` can be registered by any other app on Android; on iOS the resolution order for a
conflicting scheme is undefined. So:

- Any app can **send** your app a deep link. All parameters are attacker-controlled.
- Another app may **receive** a link intended for you — critical for OAuth callbacks.

**Use Universal Links (iOS) / App Links (Android) for anything sensitive.** They're HTTPS URLs
verified against a file you host, so only your app can claim them.

```
https://example.com/.well-known/apple-app-site-association   (no extension, Content-Type: application/json)
https://example.com/.well-known/assetlinks.json
```

Verify these are actually served correctly (right content type, no redirect, valid team ID and
SHA-256 signing fingerprint) — a misconfigured file silently degrades to opening a browser, which
people notice, or to accepting an unverified scheme, which they don't.

Android manifest needs `android:autoVerify="true"` on the intent filter. Check it:
```bash
adb shell pm get-app-links <package>
```

### Validate every deep-link parameter

```ts
// ✗ open redirect — attacker sends myapp://open?url=https://evil.example
const { url } = params;
Linking.openURL(url);

// ✗ arbitrary in-app navigation, including to authenticated screens
navigation.navigate(params.screen, params.props);

// ✓ allow-list routes and validate params
const ROUTES = { product: ProductParams, order: OrderParams } as const;
const route = ROUTES[params.screen];
if (!route) return;
const parsed = route.safeParse(params.props);
if (!parsed.success) return;
navigation.navigate(params.screen, parsed.data);
```

Specific things to check:

- **Never `Linking.openURL` with an unvalidated URL** — it can be `javascript:`, `file://`,
  `intent://` (Android intent injection), or another app's privileged scheme.
- **Never carry auth tokens in a deep link** unless it's a verified App Link, single-use, and
  short-lived. Magic-link logins over a custom scheme are hijackable.
- **Deep links must not bypass auth.** `myapp://admin/users` should land on the login screen if
  the user isn't authenticated, and the server must authorise regardless.
- **Deep links must not perform state changes without confirmation.** `myapp://delete-account`
  or `myapp://transfer?to=X&amount=Y` executed on open is a one-click attack.

### Android exported components

```xml
<!-- Anything exported can be invoked by any app on the device -->
<activity android:name=".SomeActivity" android:exported="true" />
```

Audit every `exported="true"` activity, service, receiver, and provider. Each needs either a
signature-level permission or input validation treating the caller as hostile. `ContentProvider`
with `exported="true"` and no permission is a classic data-leak finding. Note that
`android:exported` is mandatory to declare on Android 12+, so a lot of code has it set carelessly
to satisfy the build.

## Audit grep

```bash
rg 'originWhitelist' --type tsx
rg 'allowUniversalAccessFromFileURLs|allowFileAccess|mixedContentMode'
rg 'injectedJavaScript' -A 5 --type tsx
rg 'onMessage=' -A 10 --type tsx
rg 'source=\{\{\s*html' --type tsx
rg 'Linking\.openURL' -B 3 --type ts
rg 'navigation\.navigate\((?!\x27)' --type ts       # dynamic route names
rg 'exported="true"' android/app/src/main/AndroidManifest.xml -B 2
rg 'autoVerify' android/app/src/main/AndroidManifest.xml
rg 'CFBundleURLSchemes' -A 5 ios/*/Info.plist
rg 'associatedDomains|applinks' ios/ app.json app.config.*
```
