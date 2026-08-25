---
trigger: manual
description: "RN Payments: Subscription Lifecycle"
---

# Subscription Lifecycle

A subscription is not a boolean. Code that models it as one is wrong in at least four states.

| State | Entitled? | Notes |
|---|---|---|
| **Active** | Yes | Renews at period end |
| **Cancelled, not yet expired** | **Yes** | Paid through the period — cutting them off early is theft |
| **In grace period** | **Yes** | Payment failed; the store is retrying and access continues |
| **In billing retry, past grace** | Usually no | Store is still trying; entitlement has lapsed |
| **Expired** | No | |
| **Refunded / revoked** | No | Must be revoked promptly |
| **Paused** (Android) | No | Resumes on a scheduled date |
| **Upgraded / downgraded** | Yes, to the new tier | Proration rules differ per platform |

**The two most commonly mishandled are cancelled-not-expired and grace period**, and both fail in
the same direction: revoking access from a user who has paid for it. That produces a support
ticket, a refund request, and a cancellation that might not have happened.

## Cancelled is not expired

A user who cancels keeps access until the period ends. Treating `willRenew === false` as "revoke
now" takes away something they paid for.

```ts
// ✗
if (!sub.willRenew) revokeAccess();

// ✓ two independent facts
const entitled = sub.expiresAt > serverNow;      // are they paid up?
const renewing = sub.willRenew;                   // will it continue?
```

Use `renewing` for messaging — "your subscription ends on the 14th" — never for access.

## Grace period exists to protect you

When a renewal payment fails, the store enters a grace period during which the user **keeps
access** while the payment is retried. This exists because expired cards are the largest cause of
involuntary churn, and most recover.

Revoking during grace converts a recoverable payment failure into a lost customer. Handle the
notification, keep access, and prompt them to update payment — in-app, not by cutting them off.

## Upgrades, downgrades and proration

Changing tiers mid-period has platform-specific proration modes, and the choice affects what the
user is charged immediately versus at renewal. Whatever you choose, the entitlement must reflect
the **new** tier straight away on upgrade, and typically at period end on downgrade.

The bug to look for: an upgrade that grants the new tier without revoking the old subscription, so
the user is billed twice.

## Family sharing

An eligible purchase can entitle family members who never transacted. If entitlement is keyed to
the purchasing account only, those users pay nothing and get nothing, and support cannot explain
why.

## Introductory offers, trials and win-back

A trial is an entitled state that has not been paid for. Two things follow: eligibility is decided
by the store, not by you, and a user who has already used a trial must not be offered another —
showing it and then failing at purchase is a bad and avoidable moment.

## Testing the states that break

Sandbox subscriptions renew in **minutes** rather than months, which makes the full lifecycle
testable in an afternoon. Deliberately exercise:

1. Purchase, then cancel — access must continue to period end
2. Let it expire — access ends, and the app notices without a reinstall
3. Force a billing failure — grace period keeps access
4. Refund via the store — entitlement revokes without the app being opened
5. Restore on a second device
6. Upgrade mid-period — new tier immediately, no double billing

Steps 3, 4 and 6 are the ones nobody tests and the ones that cost money.
