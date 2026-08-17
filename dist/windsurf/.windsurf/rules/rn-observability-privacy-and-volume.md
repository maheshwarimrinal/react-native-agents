---
trigger: manual
description: "RN Observability: Privacy and Volume"
---

# Privacy and Volume

Telemetry is the most common route by which personal data leaves an app unintentionally. The main
path is not the code you wrote to send data — it is the data that rides along automatically.

## What leaks by default

| Source | What escapes |
|---|---|
| Crash context | `setUser` with email/username; device identifiers |
| Breadcrumbs | Full request URLs — tokens, emails, ids in query strings |
| Network instrumentation | Request/response bodies when body capture is enabled |
| Console capture | Whatever anyone ever `console.log`'d, including auth objects |
| Custom events | Free-text attributes carrying user input |
| Session replay | Literally the user's screen |
| Local vendor logs | `loggingEnabled` writes to device logs, readable by other apps on older Android |

## Scrub at the boundary

```ts
Sentry.init({
  sendDefaultPii: false,

  beforeSend(event) {
    // Identify by an opaque id, never by contact details.
    if (event.user) event.user = { id: event.user.id };

    if (event.request?.url) event.request.url = redactUrl(event.request.url);
    delete event.request?.cookies;
    delete event.request?.headers?.Authorization;

    // Redact anything token-shaped anywhere in the payload.
    return scrubDeep(event);
  },

  beforeBreadcrumb(crumb) {
    if (crumb.category === 'console') return null;   // console output is uncontrolled
    if (crumb.data?.url) crumb.data.url = redactUrl(crumb.data.url);
    return crumb;
  },
});

const SECRET_KEYS = /token|password|secret|authorization|cookie|ssn|email|phone|card/i;

function scrubDeep(value) {
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : scrubDeep(v)]),
    );
  }
  if (typeof value === 'string' && /^(eyJ|sk_|Bearer )/.test(value)) return '[redacted]';
  return value;
}

const redactUrl = (u = '') =>
  u.replace(/([?&](token|access_token|key|email|password)=)[^&]+/gi, '$1REDACTED')
   .replace(/\/(users|orders|customers)\/[^/?]+/g, '/$1/:id');
```

**Drop console breadcrumbs entirely** unless you have audited every `console.log` in the codebase
and every dependency. You have not.

## Consent has to come before initialisation

Under GDPR, consent precedes collection. An SDK that starts at app launch and asks for consent on
screen three has already collected.

```ts
// Crash reporting can usually run on legitimate interest — check with legal.
// Analytics, session replay, and anything ad-adjacent should wait.
if (await hasAnalyticsConsent()) {
  analytics.initialize();
}
```

Practical consequence: **crash reporting and analytics need separate consent handling**, and
therefore separate initialisation. Bundling them into one "enable telemetry" call is what makes
this hard to fix later.

## Store declarations must match reality

Your App Store privacy labels, Play Data Safety form, and `PrivacyInfo.xcprivacy` have to describe
what your SDKs actually send — including the parts you did not configure.

The honest check: proxy a debug build, exercise the app, and list every domain contacted and what
was sent. Reconcile against the declaration. Teams are routinely surprised by what an analytics or
attribution SDK sends on its own.

See the security agent's `privacy-and-compliance.md` for the full picture. Two observability
specifics:

- Some vendors require their own `PrivacyInfo.xcprivacy` entries; missing ones produce App Store
  Connect warnings that become rejections.
- If you enable session replay, it belongs in your privacy policy and your store declaration.

## Volume and cost

Telemetry cost scales with users, and the bill arrives after the growth.

| Lever | Effect |
|---|---|
| `tracesSampleRate` | Usually the biggest line item. 0.1 is plenty for latency distributions. |
| Replay sampling | Very expensive at 100%. Sample low, or trigger only on error. |
| Breadcrumb volume | Free-ish, but fills the buffer and evicts what matters |
| Event types | Vendors cap types, not events — see `events-and-tracing.md` |
| Response body capture | Expensive *and* a PII risk |
| Errors | Keep at 100%. Sampling errors defeats the purpose. |

```ts
Sentry.init({
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.01,   // 1% of ordinary sessions
  replaysOnErrorSampleRate: 1.0,    // but always when something broke
});
```

**Watch for the noisy-event trap.** One event per render or per scroll frame looks harmless in
development and becomes millions of events per day at scale. Instrument the action, not the
render.

Set a **spend alert** with the vendor. Discovering the cost at the end of a growth month is a
recurring and avoidable surprise.

## Retention

Longer retention costs more and increases exposure in a breach. Match it to what you actually do:
crash data is usually only useful for a few releases; funnel data may warrant longer. Decide
deliberately rather than accepting the default.

## Audit sweep

```bash
rg -n "sendDefaultPii|beforeSend|beforeBreadcrumb" --glob "**/*.{js,jsx,ts,tsx}"
rg -n "setUser\(" --glob "**/*.{js,jsx,ts,tsx}" -A4 | rg -i "email|name|phone"
rg -n "httpResponseBodyCaptureEnabled|maskAllText|replaysSessionSampleRate" --glob "**/*.{js,jsx,ts,tsx}"
rg -n "tracesSampleRate|profilesSampleRate" --glob "**/*.{js,jsx,ts,tsx}"
rg -n "console\.(log|warn|info)" --glob "**/*.{js,jsx,ts,tsx}" -l | wc -l   # console breadcrumb exposure
find ios -name 'PrivacyInfo.xcprivacy'
rg -ni "consent|gdpr|cmp" --glob "**/*.{js,jsx,ts,tsx}" -l
```
