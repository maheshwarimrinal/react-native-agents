import { useState } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';
import { useCatalogue } from '../hooks/useCatalogue';

export function CatalogueScreen() {
  const [query] = useState('');
  const catalogue = useCatalogue(query);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text accessibilityRole="header">Catalogue</Text>
      <FlatList
        data={catalogue.filter((product) => product.available)}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item }) => (
          <Pressable onPress={() => console.log('open', item.id)} style={{ padding: 16 }}>
            <Image source={{ uri: item.imageUrl }} style={{ width: 72, height: 72 }} />
            <Text>{item.name}</Text>
            <Text>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.price)}</Text>
            <Pressable onPress={() => console.log('favorite', item.id)}>
              <Text>♡</Text>
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  );
}
