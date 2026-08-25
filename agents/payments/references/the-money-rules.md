# The Rules That Cost Money

Five rules. Every one of them, broken, moves money in a direction you did not intend.

## 1. Entitlement is verified state, not a client event

```ts
// ✗ the entire security model is "the client said so"
const result = await requestPurchase({
  request: { apple: { sku }, google: { skus: [sku] } },
  type: 'in-app',
});
if (result) {
  await AsyncStorage.setItem('isPremium', 'true');
  unlockEverything();
}
```

Anyone can write that key. More importantly, this misses every other way entitlement changes:
renewal while the app is closed, restore on a new device, family sharing, refund reversal.

```ts
// ✓ one function, one source of truth
const { entitlements } = await api.get('/me/entitlements');   // server-verified
setEntitled(entitlements.includes('premium'));
```

The client's job is to *ask*, not to *decide*.

## 2. Finish the transaction, or lose the money

**Android**: a purchase not acknowledged within the platform's window is **automatically refunded**.
The user paid, you granted access, and the money is returned.

**iOS**: an unfinished transaction is re-delivered on every app launch, forever, and the purchase
queue never drains.

```ts
// Only after your server has confirmed and recorded the entitlement.
await finishTransaction({ purchase, isConsumable: false });
```

The ordering matters: acknowledge *after* your backend has recorded it, never before. Acknowledging
first and then failing to record means the money is kept and the user has nothing.

## 3. Restore must exist and must be reachable

A user reinstalls, or buys a new phone. Without restore they have paid and have nothing, and their
only recourse is a refund request and a one-star review. Apple also requires it, so this is a
rejection risk on top.

Apple requires a restore mechanism. Whether it functions for signed-out users is a design decision
rather than a platform mandate — many account-based apps restore after sign-in and pass review.

Making it reachable while signed out is still worth doing where your model allows, because a user
locked out of their account is exactly the one who needs it. Recommendation, not requirement.

## 4. Time comes from the server

```ts
// ✗ the user controls this clock
if (new Date() > new Date(subscription.expiresAt)) revoke();
```

Changing the device date is the oldest trick there is. Expiry is a server decision; the client
displays it.

## 5. Refunds must revoke

A refunded purchase whose entitlement is never revoked is an ongoing loss, and at scale it is a
line item. This needs a mechanism that does not depend on the user opening the app, because a user who
refunded has no reason to. **Server-to-server notifications** — App Store Server Notifications and
Play Real-time Developer Notifications — are the timely option and what most teams should use. A
scheduled reconciliation against the stores' server APIs is also authoritative, just slower. What
does not work is checking only on app open.

## The two directions

Weight findings by which way the money goes:

| Failure | Direction | Severity |
|---|---|---|
| Entitlement without validation | Revenue loss | P0 |
| Payment taken, nothing delivered | User harm | P0 |
| Unacknowledged purchase | Revenue loss (auto-refund) | P0 |
| Refund not revoked | Revenue loss, ongoing | P1 |
| No restore path | User harm + rejection | P1 |
| Device-time expiry check | Revenue loss | P1 |
| Hardcoded price string | User harm (wrong price shown) | P2 |
| Awkward paywall copy | Neither | P3 |

The two P0 categories need different people: revenue loss is a business conversation, user harm is
a support and reputation emergency.
