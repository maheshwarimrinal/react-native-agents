export type Product = {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  available: boolean;
};

export const products: Product[] = Array.from({ length: 1000 }, (_, index) => ({
  id: `product-${index}`,
  name: `Product ${index}`,
  price: 19.99 + index,
  imageUrl: `https://cdn.example.com/products/${index}/original.jpg`,
  available: index % 7 !== 0,
}));
