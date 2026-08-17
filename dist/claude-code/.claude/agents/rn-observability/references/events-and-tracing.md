# Breadcrumbs, Events, and Tracing

## Breadcrumbs — the path to the crash

A stack trace tells you where it broke. Breadcrumbs tell you how the user got there, which is
usually what makes it reproducible.

```ts
// Navigation — the single highest-value breadcrumb source
navigationRef.addListener('state', () => {
  const route = navigationRef.getCurrentRoute();
  Sentry.addBreadcrumb({
    category: 'navigation',
    message: route?.name,
    level: 'info',
    // Params often contain ids and sometimes PII — send a shape, not the values.
    data: { hasParams: Boolean(route?.params) },
  });
});

// Key user actions, not every tap
Sentry.addBreadcrumb({ category: 'action', message: 'checkout.submit', level: 'info' });

// Auth state, without the identity
Sentry.addBreadcrumb({ category: 'auth', message: 'token.refreshed' });
```

A useful minimum: navigation transitions, auth state changes, network failures, and the two or
three actions that define your core flow.

Not useful: every render, every scroll, every successful request. Those fill the event buffer and
evict the breadcrumbs you needed — see `silent-failures.md` §6.

## Custom events

Vendors cap **event types**, not events. New Relic's guidance — keep to roughly five event types —
generalises well.

```ts
// ✗ a new type per action; hits the cap, and the UI becomes unusable
NewRelic.recordCustomEvent('CheckoutStarted', ...);
NewRelic.recordCustomEvent('CheckoutCompleted', ...);

// ✓ a small set of types, named by attribute
NewRelic.recordCustomEvent('Checkout', 'started', { cartValue: 4200, itemCount: 3 });
NewRelic.recordCustomEvent('Checkout', 'completed', { cartValue: 4200, paymentMethod: 'card' });
```

Design the schema before instrumenting. Renaming an event type later orphans all your historical
data and every dashboard built on it.

**Attribute discipline:**

- Names stable and lowercase — `cart_value`, not `cartValue` in one place and `CartValue` in another
- Values typed consistently; a field that is sometimes a number and sometimes a string breaks aggregation permanently
- Bounded cardinality — never a user id, order id, or free text as an attribute *name*
- **No PII in attributes.** See `privacy-and-volume.md`

## Network instrumentation

Most SDKs patch `fetch`/`XMLHttpRequest` automatically. That is useful and carries two hazards.

**URLs leak.** Tokens, emails, and ids in query strings land in your telemetry — and in whatever
that vendor's retention policy is.

```ts
beforeBreadcrumb(crumb) {
  if (crumb.category === 'xhr' || crumb.category === 'fetch') {
    crumb.data = { ...crumb.data, url: redactUrl(crumb.data?.url) };
  }
  return crumb;
}

const redactUrl = (u = '') =>
  u.replace(/([?&](token|access_token|key|email|password)=)[^&]+/gi, '$1REDACTED')
   .replace(/\/users\/[^/]+/g, '/users/:id');
```

**Response body capture is off by default for a reason.** New Relic exposes
`httpResponseBodyCaptureEnabled`; enabling it globally sends failed-response bodies to a third
party, which is frequently PII and occasionally a token. Turn it on for a deliberate debugging
window, not permanently.

Path parameters should be templated (`/orders/:id`, not `/orders/8842`) or every request becomes
its own unique endpoint and aggregation is worthless.

## Tracing

Distributed tracing connects a mobile request to the backend spans it caused, which turns "the app
feels slow" into "the app is fine, this endpoint takes 4 seconds".

```ts
Sentry.init({
  tracesSampleRate: 0.1,
  // Only attach trace headers to your own hosts — sending them to third parties
  // leaks internal topology and can break CORS.
  tracePropagationTargets: ['api.example.com', /^\/api\//],
});
```

Trace the things a user waits on: app start to first meaningful paint, screen transitions, and the
critical flow (search → detail → checkout). Not every function.

```ts
await Sentry.startSpan({ name: 'checkout.submit', op: 'ui.action' }, async () => {
  await submitOrder(cart);
});
```

**Sampling is a cost decision.** 100% tracing on a popular app is expensive and adds overhead.
10% is usually plenty for latency distributions; keep errors at 100%.

## Session replay

Genuinely useful for "I can't reproduce this", and genuinely risky: it records the user's screen.

- **Masking is not optional.** Mask all text and inputs by default, then unmask specific safe
  elements — never the other way round.
- Payment, auth, and anything showing personal data must be excluded entirely.
- Some jurisdictions require disclosure; check before enabling, and reflect it in your privacy
  policy and store privacy labels.
- Sample it. Full-session replay for every user is expensive and rarely necessary.

```ts
Sentry.mobileReplayIntegration({
  maskAllText: true,
  maskAllImages: true,
  maskAllVectors: true,
});
```

New Relic's `recordReplay()` / `pauseReplay()` let you pause around sensitive screens — use them
rather than trusting a global masking rule to cover everything.

## Custom metrics

For things that are neither crashes nor events: cache hit rate, queue depth, sync duration, image
decode time.

```ts
NewRelic.recordMetric('SyncDuration', 'Offline', 1240, NewRelic.MetricUnit.OPERATIONS, NewRelic.MetricUnit.MILLISECONDS);
```

Same rules as events: bounded names, consistent units, and a reason to exist. A metric nobody has
ever alerted on or looked at is pure cost.

## What to instrument first

If a team is starting from nothing, this order gets the most value per unit of effort:

1. Crash reporting, **verified end to end** (`silent-failures.md`)
2. Release health — crash-free sessions and users, per release
3. Navigation breadcrumbs
4. Network errors, with redacted URLs
5. The three or four events that describe your core funnel
6. Startup and screen-load timing
7. Tracing on the critical flow
8. Session replay, sampled and masked

Most teams do 5 and 8 first, and then cannot debug their crashes.
