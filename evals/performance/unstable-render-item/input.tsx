import React, { useState } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';

type Product = { id: string; name: string; priceCents: number; imageUrl: string };

export function Catalogue({ products }: { products: Product[] }) {
  const [scrollY, setScrollY] = useState(0);

  return (
    <FlatList
      data={products.filter((p) => p.priceCents > 0)}
      keyExtractor={(_, index) => String(index)}
      onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => console.log('tapped', item.id)}
          style={{ flexDirection: 'row', padding: 12, height: 88 }}
        >
          <Image source={{ uri: item.imageUrl }} style={{ width: 64, height: 64 }} />
          <View>
            <Text>{item.name}</Text>
            <Text>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                item.priceCents / 100,
              )}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}
