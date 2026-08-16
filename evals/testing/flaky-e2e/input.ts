// e2e/checkout.e2e.ts
import { by, device, element, expect } from 'detox';

describe('Checkout', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  it('completes a purchase', async () => {
    await element(by.id('email')).typeText('test@example.com');
    await element(by.id('password')).typeText('hunter2');
    await element(by.text('Continue')).tap();

    await new Promise((r) => setTimeout(r, 5000));

    await element(by.id('product-0')).tap();
    await element(by.text('Add to cart')).tap();

    await new Promise((r) => setTimeout(r, 3000));

    await element(by.id('cart-tab')).tap();
    await expect(element(by.text('1 item'))).toBeVisible();

    await element(by.text('Checkout')).tap();
    await new Promise((r) => setTimeout(r, 8000));
    await expect(element(by.text('Order confirmed'))).toBeVisible();
  });

  it('shows the order in history', async () => {
    // Depends on the order created by the previous test.
    await element(by.id('profile-tab')).tap();
    await element(by.text('Order history')).tap();
    await expect(element(by.id('order-row-0'))).toBeVisible();
  });
});
