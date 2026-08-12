import { fireEvent, render } from '@testing-library/react-native';
import { useCartStore } from '../store/cart';
import { CheckoutScreen } from './CheckoutScreen';

jest.mock('./CheckoutScreen/useCheckout');
jest.mock('../store/cart');
jest.mock('../api/orders');
jest.mock('../lib/analytics');

describe('CheckoutScreen', () => {
  it('test 1', () => {
    const { toJSON } = render(<CheckoutScreen />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('test 2', () => {
    const { getByTestId } = render(<CheckoutScreen />);
    fireEvent.press(getByTestId('checkout-btn'));
    expect(useCartStore.getState().isSubmitting).toBe(true);
    expect(useCartStore.getState().internalStep).toBe(2);
  });

  it('test 3', async () => {
    const { getByTestId } = render(<CheckoutScreen />);
    fireEvent.press(getByTestId('checkout-btn'));
    await new Promise((r) => setTimeout(r, 2000));
    expect(getByTestId('success-banner')).toBeTruthy();
  });
});
