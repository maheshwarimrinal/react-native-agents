---
trigger: manual
description: "RN Payments: Store Policy"
---

# Store Policy

The rules that decide whether you are *allowed* to take a payment the way you intend. Policy here
changes more often than APIs do — treat this as the shape of the problem and verify specifics
against the live guidelines before acting.

## The core rule

Digital goods and services consumed inside the app generally must use the platform's in-app
purchase system. Physical goods and real-world services generally must not.

The boundary is genuinely ambiguous in places, and both stores have carved out categories and
jurisdictional exceptions that have shifted repeatedly. If you are near the line — a marketplace, a
service with both digital and physical components, or a jurisdiction with a specific ruling — the
question is a policy one and should be checked against current guidance rather than assumed from
what was true last year.

## Reader apps, external links and anti-steering

Rules about linking out to a web checkout, mentioning cheaper prices elsewhere, or steering users
off-platform have changed several times, differ by jurisdiction, and in some cases require a
specific entitlement to be requested from the store.

The durable advice: **if your monetisation depends on avoiding the store's cut, that is a business
risk to verify explicitly, not a technical detail to assume.** Build so a policy change does not
require rewriting your entitlement layer — which is another argument for entitlement being server
state.

## Subscription requirements that recur

Regardless of policy churn, these are consistently expected:

- **Clear disclosure before purchase** — price, period, and that it auto-renews.
- **A restore path.** Apple requires the mechanism. Whether it functions for signed-out users is a
  design decision, not a platform mandate — account-based apps routinely restore after sign-in and
  pass review. Offering it while signed out is worth doing where your model allows, since a user
  locked out of their account is the one who most needs it.
- **Cancellation information** the user can find.
- **A privacy policy and terms link** on the paywall.
- **No dark patterns** — pre-checked upsells, disguised close buttons, and countdowns that reset are
  all rejection causes and increasingly regulator-relevant.

A paywall that is honest is also the one that gets approved.

## Testing accounts

Sandbox testers are configured per store and behave differently from real accounts — subscriptions
renew in minutes, and receipts are marked sandbox. Two consequences:

- Your server must **segregate** sandbox transactions from real commerce — never reject them. App
  Review and TestFlight both produce sandbox transactions, so an endpoint that rejects them fails
  review and breaks your beta testers. Record the environment and keep sandbox-derived entitlements
  out of revenue and out of production commercial access. *How* you determine the environment
  depends on which Apple API you use — the `21007` retry belongs to the deprecated `verifyReceipt`
  endpoint and does not apply to the App Store Server API, which selects environment by base URL.
  See `validation.md`.
- Review teams test with their own accounts. If a purchase path cannot be exercised without a real
  charge or a specific region, say so in the review notes — hand this to `rn-store-submission`.

## Price changes

Both platforms have rules about notifying subscribers of price increases and, in some cases,
requiring re-consent. A price change handled only in your backend, without the store's mechanism,
can silently fail to take effect or cancel subscriptions.

## What to actually do with policy questions

State the shape, name the risk, and point at the live guidelines. A confident citation of a rule
that changed six months ago costs a rejected release — which is exactly the outcome this agent
exists to prevent.
