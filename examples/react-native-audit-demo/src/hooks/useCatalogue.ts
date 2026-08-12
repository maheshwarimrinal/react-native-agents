import { useEffect, useState } from 'react';
import { Product, products } from '../data/catalogue';

export function useCatalogue(query: string) {
  const [results, setResults] = useState<Product[]>([]);

  useEffect(() => {
    setResults(
      products.filter(
        (product) => product.available && product.name.toLowerCase().includes(query.toLowerCase()),
      ),
    );
  }, []);

  return results;
}
