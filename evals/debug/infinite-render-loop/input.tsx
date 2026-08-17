// The screen freezes and the Metro log floods. Works fine if I comment out the useEffect.
import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { useOrders } from '../api/orders';

export function OrderSummary({ customerId }: { customerId: string }) {
  const { orders } = useOrders(customerId);
  const [rows, setRows] = useState<Row[]>([]);

  const options = { includeCancelled: false, currency: 'GBP' };

  useEffect(() => {
    setRows(summarise(orders, options));
  }, [orders, options]);

  return (
    <FlatList
      data={rows}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item }) => (
        <View>
          <Text>{item.label}</Text>
        </View>
      )}
    />
  );
}
