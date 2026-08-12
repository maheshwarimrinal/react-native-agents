# Lists and Scrolling

Lists are where React Native performance goes to die. Check here first.

## Choosing the component

| Use | When |
|---|---|
| `FlashList` (Shopify) | Default choice for anything non-trivial. v2 is built for Fabric, needs no `estimatedItemSize`, and recycles views rather than unmounting them. |
| `FlatList` | Fine for short, simple, fixed-height lists, or when you can't add a dependency. |
| `ScrollView` | Only when the full content set is small and bounded (a settings screen, a form). Never for feeds — it mounts every child. |
| `SectionList` | Grouped data; same optimisation rules apply per-section. |
| `LegendList` | Worth considering for bidirectional / chat-style lists with dynamic heights. |

A `ScrollView` containing 200 mapped items is a bug, not a style choice. It mounts all 200.

## The five things that cause 90% of list jank

### 1. Inline `renderItem`

```tsx
// ✗ new function identity every parent render → every visible row re-renders
<FlatList renderItem={({ item }) => <Row item={item} onPress={() => open(item.id)} />} />

// ✓ stable identity, stable callback, memoised row
const renderItem = useCallback(
  ({ item }: { item: Post }) => <Row item={item} onPress={open} />,
  [open],
);
const open = useCallback((id: string) => navigation.navigate('Post', { id }), [navigation]);
<FlatList renderItem={renderItem} />
```

Note the second half: passing `onPress={() => open(item.id)}` recreates a closure per row per
render, defeating `React.memo` on `Row`. Pass the stable `open` and let the row call
`onPress(item.id)` internally.

### 2. Unmemoised row component

```tsx
const Row = React.memo(function Row({ item, onPress }: RowProps) {
  return (
    <Pressable onPress={() => onPress(item.id)}>
      <Text>{item.title}</Text>
    </Pressable>
  );
});
```

`React.memo` only works if every prop is referentially stable. An object literal
(`style={{ padding: 8 }}`), an array literal, or an inline closure breaks it silently. Hoist
styles into `StyleSheet.create` and callbacks into `useCallback`.

If the project has **React Compiler** enabled (check `babel.config.js` for
`babel-plugin-react-compiler`), most of this memoisation is generated automatically — adding it
by hand is then noise. Verify before recommending.

### 3. Unstable or index-based keys

```tsx
// ✗ reorders, insertions, and deletions destroy and rebuild rows
keyExtractor={(_, index) => String(index)}

// ✓
keyExtractor={(item) => item.id}
```

Index keys are the reason "my list flickers when I delete an item".

### 4. Missing `getItemLayout` on fixed-height rows (FlatList)

```tsx
const ITEM_HEIGHT = 72;
getItemLayout={(_, index) => ({
  length: ITEM_HEIGHT,
  offset: ITEM_HEIGHT * index,
  index,
})}
```

This lets FlatList skip measurement entirely, which makes `scrollToIndex` instant and removes a
layout pass per batch. Only valid if rows are genuinely uniform height — otherwise it causes
scroll-position drift, which is worse than the perf cost.

### 5. Expensive work inside the row

Rows render dozens of times per second during a fling. Anything in a row body must be cheap:

- No `new Date()` formatting, `Intl.NumberFormat` construction, or regex per render — hoist the
  formatter to module scope and memoise the result.
- No `.filter()` / `.sort()` / `.find()` over other arrays inside a row.
- No inline SVG parsing. Pre-rasterise or cache.
- No shadow on Android where `elevation` will do; complex shadows are expensive to composite.
- Avoid deeply nested view hierarchies — flatten where you can.

## FlatList tuning props

Only reach for these after the above are clean, and only with a measurement.

| Prop | Effect | Caution |
|---|---|---|
| `initialNumToRender` | Rows rendered on first paint | Set to what actually fills the viewport, not more. Too high hurts TTI. |
| `maxToRenderPerBatch` | Rows per incremental batch | Higher = fewer blank cells, more JS blocking |
| `windowSize` | Viewports kept mounted (default 21) | Lowering saves memory, raises blank-cell risk |
| `updateCellsBatchingPeriod` | ms between batches | Raising smooths scroll, delays content |
| `removeClippedSubviews` | Detach offscreen views | **Known to cause blank rows, lost focus, and broken touch on Android.** Use only with a measured win. |
| `onEndReachedThreshold` | Pagination trigger point | Too low = visible loading gap |

Do not set these to arbitrary "optimised" values copied from a blog post. Defaults are
reasonable; each change trades one problem for another.

## Structural mistakes

- **Nested `VirtualizedList`s of the same orientation.** RN warns about this for good reason —
  virtualisation breaks entirely. Use `ListHeaderComponent`, sections, or a single list with
  mixed item types instead.
- **Horizontal lists inside vertical list rows** are fine (different orientation) but each one
  is its own virtualised list; memoise them hard.
- **`ListHeaderComponent={<Header />}`** — passing an element instead of a component type
  remounts the header on every render. Pass the component or a memoised element.
- **Re-creating `data`** every render (`data={items.filter(x => x.active)}`) rebuilds the whole
  list. Memoise the derived array with `useMemo`.
- **Inline `contentContainerStyle={{...}}`** — same identity problem; hoist it.

## FlashList v2 specifics

- No `estimatedItemSize` required — v2 measures automatically. Passing the old props is a smell
  that the code was migrated carelessly.
- Rows are **recycled**, so local state inside a row can leak between items. Use `useLayoutEffect`
  keyed on item id to reset, or keep row state lifted.
- `getItemType` lets heterogeneous lists recycle correctly — big win for feeds with mixed cards.
- `maintainVisibleContentPosition` is the correct answer to "the list jumps when new items load
  at the top" (chat/inbox patterns).

## Quick audit grep

```bash
rg 'renderItem=\{\(' --type tsx            # inline renderItem
rg 'keyExtractor=.*index' --type tsx       # index keys
rg '<ScrollView' -A 20 | rg '\.map\('      # map inside ScrollView
rg 'removeClippedSubviews'                 # justify each one
rg 'data=\{.*\.(filter|sort|map)\(' --type tsx  # derived array per render
```
