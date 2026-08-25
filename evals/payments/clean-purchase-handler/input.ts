// index.ts — listener at module scope, entitlement asked of the server.
// There is nothing here worth reporting.
import {
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  getAvailablePurchases,
  isUserCancelledError,
  type Purchase,
} from 'react-native-iap';
import { AppState, Platform } from 'react-native';

import { api } from './src/api';
import { applyEntitlements } from './src/entitlements';
import { report } from './src/report';

/**
 * One path for every way a purchase reaches us: the listener, and the
 * foreground reconciliation below. Keeping it in one function is what makes
 * both of them safe to call with the same transaction.
 */
async function handlePurchase(purchase: Purchase): Promise<void> {
  try {
    // The device reports; the server decides. It asks the store, checks bundle
    // id, product, environment and prior ownership, then records entitlement.
    const { entitlements } = await api.post('/purchases/validate', {
      platform: Platform.OS,
      // StoreKit 2 JWS on iOS, Play purchase token on Android.
      purchaseToken: purchase.purchaseToken,
      productId: purchase.productId,
      // Stable across retries, so a repeated call cannot grant or charge twice.
      transactionId: purchase.transactionId,
    });

    // Only after the backend has recorded it. Acknowledging first and then
    // failing to record would keep the money and grant nothing.
    await finishTransaction({ purchase, isConsumable: false });

    applyEntitlements(entitlements);
  } catch (error) {
    // Deliberately NOT finished: the store re-delivers unfinished transactions,
    // which is exactly the behaviour we want while our backend is unreachable.
    report(error, { source: 'handlePurchase' });
  }
}

// Registered at startup: interrupted purchases and re-delivered transactions
// arrive outside the paywall screen, and a listener mounted there would never
// see them.
purchaseUpdatedListener(handlePurchase);

// The listener is not sufficient on its own. An Android renewal that happens
// while the app is closed never fires it, so query on resume. The backend
// remains the source of truth; this is catch-up, not discovery.
AppState.addEventListener('change', async (state) => {
  if (state !== 'active') return;
  try {
    for (const purchase of await getAvailablePurchases()) {
      await handlePurchase(purchase);
    }
  } catch (error) {
    report(error, { source: 'reconcileOnForeground' });
  }
});

purchaseErrorListener((error) => {
  // Dismissing the sheet is the most common outcome of showing it, not an error.
  if (isUserCancelledError(error)) return;
  report(error, { source: 'purchaseErrorListener' });
});
