---
trigger: manual
description: "RN Build: Lists and Data Fetching"
---

# Lists and Data Fetching

## The list

```tsx
export function ProductList({ query }: { query: string }) {
  const { data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery({
      queryKey: ['products', query],          // the key IS the dependency array
      queryFn: ({ pageParam }) => fetchProducts({ query, cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      staleTime: 60_000,
      placeholderData: keepPreviousData,      // no spinner flash when the query changes
    });

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  const open = useCallback((id: string) => navigation.navigate('Product', { id }), [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: Product }) => <ProductRow product={item} onPress={open} />,
    [open],
  );

  if (isPending) return <ListSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <FlashList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      onEndReached={hasNextPage ? fetchNextPage : undefined}
      onEndReachedThreshold={0.5}
      ListFooterComponent={isFetchingNextPage ? <FooterSpinner /> : null}
      ListEmptyComponent={
        query ? <NoResults query={query} /> : <EmptyState title="No products yet" />
      }
    />
  );
}

const keyExtractor = (p: Product) => p.id;
const getItemType = (p: Product) => p.layout;   // lets FlashList recycle mixed rows correctly
```

## The row

```tsx
export const ProductRow = memo(function ProductRow({
  product,
  onPress,
}: {
  product: Product;
  onPress: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(product.id)}
      // Merge the row into one screen-reader stop instead of four.
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatPrice(product.priceCents)}`}
      style={styles.row}
    >
      <Image
        source={{ uri: product.thumbUrl }}
        style={styles.thumb}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={product.id}     // required: FlashList recycles views
        placeholder={{ blurhash: product.blurhash }}
      />
      <View style={styles.body}>
        <Text style={typography.body} numberOfLines={2}>{product.name}</Text>
        <Text style={typography.caption}>{formatPrice(product.priceCents)}</Text>
      </View>
    </Pressable>
  );
});

// Module scope — constructing an Intl formatter is the expensive part, and doing
// it inside a row means doing it dozens of times per second while scrolling.
const priceFormatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const formatPrice = (cents: number) => priceFormatter.format(cents / 100);
```

## Rules

**Stable identities or memoisation does nothing.** `renderItem`, `keyExtractor`, and the press
handler must not be recreated each render. Note the row takes `onPress: (id) => void` and calls it
with its own id — passing `onPress={() => open(item.id)}` from the parent creates a closure per
row and defeats `memo`.

**Never index keys.** They break on insert, delete, and reorder — the cause of "my list flickers
when I delete something".

**`recyclingKey` on images inside FlashList.** Rows are recycled, so without it a row briefly
shows the previous item's image. It gets reported as a rendering bug constantly.

**Formatters at module scope.** `new Intl.NumberFormat(...)` inside a row is one of the most
common invisible costs in RN lists.

**Empty ≠ no results.** "No products yet" and "No results for 'xyz'" need different copy and
different actions.

**Don't `.map()` inside a `ScrollView`** for unbounded data. It mounts everything.

## Data fetching

Use the project's server-state library. If it has none and the app is more than trivial,
recommend TanStack Query — hand-rolled `useEffect` + `fetch` re-implements caching, dedupe,
retry, and cancellation, and gets the race conditions wrong.

**Mobile-specific settings people miss:**

```tsx
// The defaults are tuned for web. On mobile, refetch-on-focus with staleTime 0
// produces a refetch storm as the user navigates.
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: (count, err) => !(err instanceof ApiError && !err.retryable) && count < 3,
      retryDelay: (n) => Math.min(1000 * 2 ** n + Math.random() * 300, 30_000),
    },
  },
});

// Wire focus and connectivity to the app lifecycle, or they never fire correctly.
AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
NetInfo.addEventListener((s) => onlineManager.setOnline(Boolean(s.isConnected)));
```

Persisting the query cache to MMKV and hydrating at boot is one of the biggest perceived-speed
wins available: the app opens with content instead of spinners.

### If you must fetch by hand

```tsx
useEffect(() => {
  const controller = new AbortController();
  let active = true;

  fetch(url, { signal: controller.signal })
    .then((r) => r.json())
    .then((json) => { if (active) setData(Schema.parse(json)); })
    .catch((e) => { if (e.name !== 'AbortError' && active) setError(e); });

  return () => { active = false; controller.abort(); };
}, [url]);
```

Both guards matter: `abort` cancels the request, `active` prevents an older response overwriting a
newer one.

### Validate at the boundary

```tsx
const Product = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: z.number().int(),
  thumbUrl: z.string().url(),
});
export type Product = z.infer<typeof Product>;   // one source of truth

export async function fetchProducts(): Promise<Product[]> {
  const res = await api.get('/products');
  return z.array(Product).parse(res.data);
}
```

TypeScript types are erased at runtime. A `Product` type is a promise about the server, not a
guarantee — the moment a field changes you get `undefined is not an object` deep in a render
instead of a clear error at the boundary.

## Optimistic updates

```tsx
useMutation({
  mutationFn: toggleFavourite,
  onMutate: async (id) => {
    await qc.cancelQueries({ queryKey: ['product', id] });
    const prev = qc.getQueryData(['product', id]);
    qc.setQueryData(['product', id], (old) => ({ ...old, isFavourite: !old.isFavourite }));
    return { prev };
  },
  onError: (_e, id, ctx) => qc.setQueryData(['product', id], ctx?.prev),
  onSettled: (_d, _e, id) => qc.invalidateQueries({ queryKey: ['product', id] }),
});
```

Roll back **visibly** and explain — a silent revert reads as a bug.

## Checklist

- [ ] Virtualised list, not a mapped `ScrollView`
- [ ] Stable `renderItem`, `keyExtractor`, and callbacks
- [ ] Row is `memo`'d and every prop is referentially stable
- [ ] `recyclingKey` on images in recycled lists
- [ ] Formatters hoisted to module scope
- [ ] Loading, error, empty, and no-results all distinct
- [ ] Pagination with a sensible threshold and a footer indicator
- [ ] Requests cancelled on unmount; races impossible
- [ ] Responses validated at the boundary
- [ ] Sensible `staleTime`; focus/online wired to `AppState` and NetInfo
