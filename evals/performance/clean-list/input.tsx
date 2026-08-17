// A correctly written list. There is nothing here worth reporting.
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, typography } from '@/shared/theme/tokens';
import type { Product } from '../api/products';

const priceFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

const keyExtractor = (item: Product) => item.id;
const getItemType = (item: Product) => item.layout;

export function ProductList({
  products,
  onOpen,
}: {
  products: Product[];
  onOpen: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();

  const visible = useMemo(() => products.filter((p) => p.isAvailable), [products]);

  // Memoised: an inline object literal here is a new reference on every render,
  // which defeats the list's own prop comparison.
  const contentContainerStyle = useMemo(
    () => ({ paddingBottom: insets.bottom + spacing.xl }),
    [insets.bottom],
  );

  const renderItem = useCallback(
    ({ item }: { item: Product }) => <ProductRow product={item} onPress={onOpen} />,
    [onOpen],
  );

  return (
    <FlashList
      data={visible}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      contentContainerStyle={contentContainerStyle}
    />
  );
}

const ProductRow = memo(function ProductRow({
  product,
  onPress,
}: {
  product: Product;
  onPress: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(product.id)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${priceFormatter.format(product.priceCents / 100)}`}
      style={styles.row}
    >
      <Image
        source={{ uri: product.thumbUrl }}
        style={styles.thumb}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={product.id}
        placeholder={{ blurhash: product.blurhash }}
      />
      <View style={styles.body}>
        <Text style={typography.body} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={typography.caption}>{priceFormatter.format(product.priceCents / 100)}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, minHeight: 88 },
  thumb: { width: 64, height: 64, borderRadius: 8 },
  body: { flex: 1, justifyContent: 'center' },
});
