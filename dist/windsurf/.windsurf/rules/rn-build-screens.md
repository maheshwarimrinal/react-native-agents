---
trigger: manual
description: "RN Build: Building a Screen"
---

# Building a Screen

The reference shape. Adapt to the project's conventions rather than imposing this one.

```tsx
// src/features/orders/screens/OrderListScreen.tsx
import { useCallback } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';
import { OrderRow } from '../components/OrderRow';
import { OrderSkeleton } from '../components/OrderSkeleton';
import { fetchOrders, type Order } from '../api/orders';
import { spacing } from '@/shared/theme';

export function OrderListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const { data, isPending, isRefetching, error, refetch } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    staleTime: 60_000,
  });

  // Hoisted so FlashList sees a stable identity across parent renders.
  const openOrder = useCallback(
    (id: string) => navigation.navigate('OrderDetail', { id }),
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: Order }) => <OrderRow order={item} onPress={openOrder} />,
    [openOrder],
  );

  if (isPending) return <OrderSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <View style={styles.container}>
      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        contentContainerStyle={{
          paddingTop: spacing.md,
          // Insets, not a magic number — and the tab bar already adds its own.
          paddingBottom: insets.bottom + spacing.xl,
        }}
        ListEmptyComponent={
          <EmptyState
            title="No orders yet"
            body="When you place an order it'll show up here."
            actionLabel="Browse products"
            onAction={() => navigation.navigate('Catalogue')}
          />
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.textSecondary} />
        }
      />
    </View>
  );
}

const keyExtractor = (item: Order) => item.id;
const getItemType = (item: Order) => item.kind;

const styles = StyleSheet.create({
  container: { flex: 1 },
});
```

## What that shape encodes

**Four states, always.** Loading, error, empty, content. Skeleton over spinner — it communicates
the shape of what's coming and avoids the layout jump when a centred spinner is replaced by a
list. Empty is not an error and needs its own copy plus a way forward.

**Insets applied where they belong.** Not a blanket wrapper: content scrolls under the status bar
while the *content container* carries the bottom inset. Android 15+ enforces edge-to-edge, so
this is mandatory rather than polish.

**Stable identities.** `renderItem`, `keyExtractor`, and the press handler are all hoisted or
memoised. An inline arrow here re-renders every visible row on each parent render.

**IDs through navigation, not objects.** Passing the whole entity means it goes stale, bloats
persisted navigation state, and breaks deep links.

## Screen-level patterns

### Header

```tsx
useLayoutEffect(() => {
  navigation.setOptions({
    title: order?.reference ?? 'Order',
    headerRight: () => (
      <HeaderButton
        icon="share"
        accessibilityLabel="Share this order"   // icon-only: label is mandatory
        onPress={share}
      />
    ),
  });
}, [navigation, order?.reference, share]);
```

### Work that should re-run on focus

```tsx
// Screens stay mounted in a stack — useEffect fires once, not on return.
useFocusEffect(
  useCallback(() => {
    const sub = subscribeToUpdates(id);
    return () => sub.remove();
  }, [id]),
);
```

### Scroll-driven animation

Keep it on the UI thread. A `setState` in `onScroll` is a React render per frame.

```tsx
const scrollY = useSharedValue(0);
const onScroll = useAnimatedScrollHandler((e) => {
  scrollY.value = e.contentOffset.y;
});
```

### Android back

```tsx
useEffect(() => {
  const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    if (step > 0) { setStep((s) => s - 1); return true; }
    return false;   // let the system handle it
  });
  return () => sub.remove();
}, [step]);
```

## Keyboard

`KeyboardAvoidingView` is unreliable once you have a header or tab bar, and behaves differently
per platform. For anything beyond a single centred input, use
`react-native-keyboard-controller`.

```tsx
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

<KeyboardAwareScrollView
  bottomOffset={spacing.xl}
  keyboardShouldPersistTaps="handled"   // or the first tap only dismisses the keyboard
  contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
>
```

If the project doesn't have it, `KeyboardAvoidingView` with
`behavior={Platform.OS === 'ios' ? 'padding' : undefined}` and a `keyboardVerticalOffset` equal
to the header height is the fallback — say that it's a fallback.

## Checklist before you hand it over

- [ ] Loading, empty, error, and content all handled
- [ ] Safe-area insets applied where content actually needs them
- [ ] Every interactive element has a role and an accessible name
- [ ] No hardcoded colours — theme tokens only
- [ ] `renderItem` / `keyExtractor` / callbacks are stable
- [ ] Keyboard doesn't cover the focused input or the submit button
- [ ] Layout survives 200% text size
- [ ] Android back does something sensible
- [ ] Navigation params are IDs, not objects
- [ ] No `any`; API responses validated at the boundary
