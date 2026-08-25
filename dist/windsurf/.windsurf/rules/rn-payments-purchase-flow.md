---
trigger: manual
description: "RN Payments: The Purchase Flow"
---

# The Purchase Flow

> **API versions in this document.** Examples use `react-native-iap` v14 (current: 14.7), which
> moved to StoreKit 2 on iOS (iOS 15+) and Google Play Billing 7+ on Android. v14 **removed**
> several v13 functions rather than deprecating them, so v13 code does not merely warn — it fails
> to import. If you are reading a codebase still on v13, the shapes below will not match; see the
> version table at the end.

## Register the listener at startup, not on the paywall

```ts
// index.js — module scope
purchaseUpdatedListener(async (purchase) => {
  await handlePurchase(purchase);   // validate server-side, then finish
});
purchaseErrorListener((e) => reportPurchaseError(e));
```

A listener registered inside the paywall screen misses everything that arrives outside it:
purchases interrupted by a crash or a backgrounded app, and transactions the store re-delivers at
launch. Those are exactly the cases where a user has paid and is waiting.

**The listener alone is not sufficient on Android.** A renewal that happens while the app is closed
does not fire `PurchasesUpdatedListener` at all — Google's guidance is to call `queryPurchasesAsync`
on resume to pick up anything that changed while you were not running:

```ts
// On every foreground, not only at launch.
AppState.addEventListener('change', async (state) => {
  if (state !== 'active') return;
  const purchases = await getAvailablePurchases();   // queryPurchasesAsync underneath
  for (const p of purchases) await handlePurchase(p);
});
```

Even this is a catch-up mechanism rather than a source of truth. The authoritative record of a
renewal is your backend, updated by server notifications — the client is reconciling, not
discovering. See `validation.md`.

This is the same structural mistake as registering a push background handler inside a component —
see `rn-push`.

## The full sequence

`initConnection` → `fetchProducts` → `requestPurchase` → validate on your server →
`finishTransaction`.

```ts
async function buy(sku: string) {
  // 1. Products must be fetched before purchase; prices are per-locale and per-store.
  //    `type` is required: 'in-app' or 'subs'. One call covers both; there is no
  //    separate subscriptions function any more.
  const products = await fetchProducts({ skus: [sku], type: 'in-app' });
  if (!products.length) throw new Error('Product unavailable in this store');

  // 2. Request. The result arrives on the listener, not (only) here.
  //    Apple takes a single `sku`; Google takes an array. Both are given, so the
  //    same call works on either platform.
  await requestPurchase({
    request: {
      apple: { sku },
      google: { skus: [sku] },
    },
    type: 'in-app',
  });
}

async function handlePurchase(purchase) {
  try {
    // 3. Validate on YOUR server, which asks the store.
    //    On iOS this is a StoreKit 2 JWS string, not the old base64 receipt blob.
    const { entitlements } = await api.post('/purchases/validate', {
      platform: Platform.OS,
      purchaseToken: purchase.purchaseToken,
      productId: purchase.productId,
      // Stable across retries, so a repeated call cannot grant or charge twice.
      transactionId: purchase.transactionId,
    });

    // 4. Only once the backend has recorded it.
    await finishTransaction({ purchase, isConsumable: false });

    applyEntitlements(entitlements);
  } catch (error) {
    // Do NOT finish an unvalidated purchase — it will be re-delivered, which is
    // the behaviour you want while the server is unreachable.
    reportPurchaseError(error);
    showRetryablePaymentError();
  }
}
```

Android subscriptions additionally **require** an offer token taken from the fetched product —
a subscription request without `subscriptionOffers` fails:

```ts
const subscription = subscriptions.find((s) => s.id === subId);
const offers = subscription?.subscriptionOfferDetailsAndroid ?? [];

await requestPurchase({
  request: {
    apple: { sku: subId },
    google: {
      skus: [subId],
      subscriptionOffers: offers.map((o) => ({ sku: subId, offerToken: o.offerToken })),
    },
  },
  type: 'subs',
});
```

The `catch` is the important part. Leaving the transaction unfinished on failure is correct: the
store will re-deliver it, giving you another chance to record a purchase the user has already paid
for. Finishing it to clear the queue destroys that.

## Never hardcode prices

```tsx
// ✗ wrong in every other storefront, and a plausible rejection cause
<Text>$9.99 / month</Text>

// ✓ the store's localised string
<Text>{product.displayPrice}</Text>
```

Note the property names: v14 renamed `localizedPrice` → `displayPrice` and `productId` → `id`, and
`price` is now a number rather than a formatted string. Rendering `product.price` directly gives an
unformatted number with no currency — the exact failure this section warns about, reintroduced by
a migration.

The store returns a formatted price for the user's storefront, already localised for currency and
format. Displaying anything else risks showing a price you will not charge — a trust problem first,
and a plausible rejection cause second. It is not an automatic rejection, but it is avoidable and
there is no upside to hardcoding.

## Handle cancellation as a non-error

A user dismissing the purchase sheet is the most common outcome of showing it. It is not an error
and must not produce an error dialog, a report, or a retry prompt.

```ts
import { ErrorCode, isUserCancelledError } from 'react-native-iap';

if (isUserCancelledError(error)) return;          // silent, always
// equivalently: if (error.code === ErrorCode.UserCancelled) return;
```

v14 replaced the per-platform string codes with a unified `ErrorCode` enum. The old
`'E_USER_CANCELLED'` literal no longer matches anything, so a v13 check like
`error.code === 'E_USER_CANCELLED'` silently stops working: the comparison is simply false, and
every cancellation starts producing an error dialog. This is worth grepping for specifically,
because nothing throws — the app just becomes annoying.

## Idempotency

A retried validation call must not grant twice or charge twice. Key it on the store's transaction
id, which is stable across retries, and make the server side upsert rather than insert.

## What the user sees when it fails

Payment failures are frightening in a way other errors are not, because money may have moved.

- **Never** show a raw error code.
- Say whether they were charged. If you do not know, say you are checking and that they will not be
  charged twice.
- Give a path — retry, restore, or contact support with a reference.
- If the purchase succeeded but validation failed, tell them it will be applied automatically and
  make sure that is true.

## Consumables versus non-consumables

`isConsumable` is not cosmetic. Getting it wrong means a coin pack can only ever be bought once, or
a lifetime unlock is consumed and disappears. Check that every product's handling matches its type
in the store configuration.

## v13 → v14 shape changes

Check the installed version in `package.json` before reporting any of these. On v13 the left column
is correct and flagging it is a false positive; on v14 the left column does not exist, so the code
is broken rather than merely dated.

| v13 | v14 | Note |
|---|---|---|
| `getProducts({skus})` | `fetchProducts({skus, type: 'in-app'})` | removed, not deprecated |
| `getSubscriptions({skus})` | `fetchProducts({skus, type: 'subs'})` | unified |
| `requestPurchase({sku})` | `requestPurchase({request: {apple, google}, type})` | new structure |
| `requestSubscription({sku})` | `requestPurchase({..., type: 'subs'})` | unified |
| `getPurchaseHistory()` | `getAvailablePurchases()` | renamed |
| `validateReceiptIos()` | `verifyPurchase()` | see `validation.md` first |
| `'E_USER_CANCELLED'` | `ErrorCode.UserCancelled` | fails silently, see above |
| `product.productId` | `product.id` | |
| `product.localizedPrice` | `product.displayPrice` | |
| base64 receipt | JWS string | StoreKit 2 |
| `clearProductsIOS()`, `flushFailedPurchasesCachedAsPendingAndroid()`, `setup()` | removed | no replacement needed |

v14 also raises the floor: **iOS 15+**, Google Play Billing 7.0+, React Native 0.71+. An app that
still supports iOS 14 cannot take v14 at all, which makes "upgrade the library" a scoping decision
rather than a chore.
