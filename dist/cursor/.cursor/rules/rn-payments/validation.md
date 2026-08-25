# Receipt Validation

## On-device validation is weaker than server-side, and the choice is yours

Apple documents both on-device and server-side validation, and the right choice depends on your
threat model. On-device validation is checked by code the attacker controls — patched binaries,
hooked methods and proxied responses all defeat it — so it is unsuitable wherever a bypass costs
you real money.

**For anything with meaningful revenue attached, validate server-side.** That is a recommendation
grounded in what a bypass costs you, not a platform requirement, and it is worth stating that way:
a free tier with a cosmetic unlock has a different threat model to a subscription business.

Note also that server-side does not necessarily mean a live call to the store on every check. A
server can verify Apple's signed transaction data cryptographically, which is faster and removes a
dependency on store availability. What matters is that **verification happens somewhere the user
cannot modify**, and that you have chosen deliberately rather than by default.

```
device → your backend → App Store / Play Developer API → your backend records entitlement
                                                              ↓
device asks your backend "what am I entitled to?" ────────────┘
```

The device never decides. It reports and it asks.

## What the server must actually check

Verifying the signature is not enough. A valid receipt can still be one you should reject:

- **Bundle ID / package name** matches your app — otherwise a receipt from a different app validates
  fine.
- **Product ID** is one you sell.
- **The transaction is not already recorded against a different user** — this is how one purchase
  gets shared across many accounts.
- **Expiry** is in the future, using the store's timestamps.
- **Revocation / refund** fields are absent.
- **Environment is identified and handled correctly** — see below. This is the most commonly
  botched part, in both directions.

## Which Apple API to validate against

**`verifyReceipt` is deprecated.** Apple deprecated the endpoint in June 2023. It still works and
Apple has announced no end-of-life date, so existing code is not broken and "you must migrate
today" is overstating it — but it receives no new features, and it is the wrong thing to *build*.
Apple's own documentation now directs you to one of:

- **App Store Server API** — send the transaction id, get Apple-signed transaction and subscription
  information back.
- **Verify the signed data the app already has** — StoreKit 2 hands the app a signed JWS
  (`Transaction` / `AppTransaction`) instead of the old base64 receipt blob. Your server can verify
  it cryptographically with Apple's App Store Server Library (Swift, Java, Node.js, Python) without
  a round trip to Apple at all.
- **App Store Server Notifications V2** — the same signed payloads, pushed.

Severity depends on which you are looking at. New code written against `verifyReceipt` is worth
raising; a working, shipped integration on it is a migration to plan, not an incident. Say which
one you mean.

## The sandbox/production question, correctly

**This differs by API, and carrying the old rule across is the common mistake.**

*If you are on the deprecated `verifyReceipt`*: verify against production first and retry against
sandbox on status `21007`. One code path covers App Store builds, TestFlight, and App Review.

```
verifyReceipt(production)
  └─ status 21007 → verifyReceipt(sandbox)
```

*If you are on the App Store Server API*: **there is no `21007` retry.** Environment is selected by
base URL —

```
production   https://api.storekit.itunes.apple.com
sandbox      https://api.storekit-sandbox.itunes.apple.com
```

Querying production with a sandbox transaction id returns **401**, not a status code telling you to
try elsewhere. Code that ports the old pattern across sees an auth failure and concludes its
credentials are wrong. Decide the environment from the notification URL that delivered the event or
the `environment` field in the decoded payload, then call the matching host.

**Either way, sandbox transactions must be accepted and segregated.** TestFlight builds and App
Review both produce them, so an endpoint that turns them away breaks your beta testers and fails
review — the reviewer simply cannot complete a purchase.

What you must not do is let a sandbox transaction grant **production commercial entitlement**.
Accept it, record which environment it came from, and keep sandbox-derived entitlements segregated
from real ones — separate flag, separate reporting, no revenue attribution. The rule is
*segregate*, not *reject*.

## Server-to-server notifications, or an equivalent reconciliation

Polling tells you what changed only when the user opens the app. Refunds, cancellations, billing
failures and renewals all happen when they do not.

- **Apple**: App Store Server Notifications v2
- **Google**: Real-time Developer Notifications via Pub/Sub

Handle at minimum: renewal, expiry, cancellation, refund/revoke, billing retry entering and
leaving, and grace period. Each maps to an entitlement change your backend must record.

Notifications can arrive out of order and more than once, so handlers must be **idempotent** and
must not assume sequence.

Strictly, notifications are not the only way: a scheduled reconciliation that queries the store's
server API for your active subscribers is also authoritative. Notifications are strongly preferred
because they are timely and cheaper, but if a team has a working reconciliation job, that is a
design choice rather than a defect.

## Consider not building this

Receipt validation, notification handling, and subscription state machines for two stores is a real
system with real edge cases, and getting it subtly wrong is expensive in both directions. Services
exist that do exactly this.

The honest trade: they cost a percentage or a fee, and they own a critical path you cannot easily
leave. For most teams that is still the better deal than maintaining two store integrations. It is
a decision worth making deliberately rather than by default — and either way, the client-side rule
is unchanged: the device asks, it never decides.

## Auditing

```bash
# Validation happening on the device is the finding
rg -n "validateReceipt|verifyPurchase|isPurchaseValid" --glob "**/*.{js,jsx,ts,tsx}" -A6

# Deprecated Apple endpoint, and the sandbox-retry pattern carried into code that
# no longer returns 21007 at all
rg -n "verifyReceipt|buy\.itunes\.apple\.com|sandbox\.itunes\.apple\.com|21007"

# Entitlement written from a client callback
rg -n "(setItem|set)\(['\"](isPremium|isPro|entitled|subscribed)" --glob "**/*.{js,jsx,ts,tsx}"

# Is there any server call at all in the purchase path?
rg -n "requestPurchase|purchaseUpdatedListener" --glob "**/*.{js,jsx,ts,tsx}" -A12 | rg -i "fetch|axios|api\."
```

If the third command returns nothing, entitlement is being decided on the device and everything
else is secondary.
