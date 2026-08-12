import { fireEvent, render } from '@testing-library/react-native';
import { CatalogueScreen } from './CatalogueScreen';

jest.mock('../hooks/useCatalogue', () => ({
  useCatalogue: () => [{ id: 'product-1', name: 'Product 1', price: 20, imageUrl: 'https://example.com/1.jpg', available: true }],
}));

test('renders the catalogue implementation', () => {
  const screen = render(<CatalogueScreen />);
  expect(screen.toJSON()).toMatchSnapshot();
  fireEvent.press(screen.getByText('Product 1').parent!);
  expect(screen.getByText('Product 1')).toBeTruthy();
});
