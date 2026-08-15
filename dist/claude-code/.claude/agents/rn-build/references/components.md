# Building a Reusable Component

```tsx
// src/shared/ui/Button.tsx
import { forwardRef } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text,
  type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { useTheme } from '@/shared/theme';
import { spacing, radius, typography } from '@/shared/theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
} & Omit<PressableProps, 'onPress' | 'style' | 'children'>;

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  style,
  accessibilityHint,
  ...rest
}: ButtonProps) {
  const { theme } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      // Announce what it is, what it does, and what state it's in.
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      hitSlop={size === 'sm' ? 8 : 0}
      android_ripple={{ color: theme.ripple }}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        variantStyles(theme)[variant],
        isDisabled && styles.disabled,
        // iOS has no ripple, so it needs an explicit pressed state.
        pressed && Platform.OS === 'ios' && styles.pressed,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={theme.onAccent} />
      ) : (
        <>
          {icon}
          <Text
            style={[textStyles[size], { color: textColor(theme)[variant] }]}
            numberOfLines={1}
            // Scale with the OS setting, but cap it so a button label can't
            // push the layout apart at accessibility sizes.
            maxFontSizeMultiplier={1.4}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}
```

## Rules this encodes

**Minimum target size.** 44×44pt (iOS) / 48×48dp (Android). Where the visual must be smaller, add
`hitSlop` — it extends the touch area without changing layout.

**Roles and state, not just labels.** A visually disabled button that doesn't report
`accessibilityState={{ disabled: true }}` is announced as tappable. `busy` matters during
submission, or a screen reader user hears silence and taps again.

**Platform-appropriate feedback.** Android gets a ripple; iOS gets an opacity change. Shipping an
Android app with iOS-style feedback and no ripple feels subtly wrong to Android users in a way
they usually can't articulate.

**Typed variant maps, not ternary chains.**

```tsx
const variantStyles = (t: Theme): Record<Variant, ViewStyle> => ({
  primary:   { backgroundColor: t.accent },
  secondary: { backgroundColor: t.bgElevated, borderWidth: 1, borderColor: t.border },
  ghost:     { backgroundColor: 'transparent' },
  danger:    { backgroundColor: t.danger },
});
```

Adding a variant becomes a compile error until every map is updated.

**Font scaling capped, not disabled.** `allowFontScaling={false}` actively harms the users who
need it most. `maxFontSizeMultiplier` keeps the layout intact while still scaling.

## Composition over configuration

When props start accumulating booleans — `showHeader`, `isCompact`, `withBorder`, `hasIcon` — the
component wants slots instead:

```tsx
// ✗ eleven props, and every caller triggers a different subset
<Card showHeader title="x" headerAction={<X/>} compact bordered footer={<Y/>} />

// ✓
<Card>
  <Card.Header title="x" action={<X/>} />
  <Card.Body>…</Card.Body>
  <Card.Footer><Y/></Card.Footer>
</Card>
```

## Styles

```tsx
// Layout is static — hoist it.
const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    minHeight: 48,        // minHeight, not height — scaled text needs room
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});

// Only theme-dependent values are computed, and they're memoised per theme.
const useThemedStyles = () => {
  const { theme } = useTheme();
  return useMemo(() => StyleSheet.create({ … }), [theme]);
};
```

Inline style objects break `React.memo` on children *and* scatter design values through the
codebase. Both reasons matter; the second matters longer.

## Icon-only controls

The single most common accessibility defect in React Native apps:

```tsx
// ✗ a screen reader announces "button" and nothing else
<Pressable onPress={toggleFavourite}><HeartIcon /></Pressable>

// ✓
<Pressable
  onPress={toggleFavourite}
  accessibilityRole="button"
  accessibilityLabel={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
  accessibilityState={{ selected: isFavourite }}
  hitSlop={12}
>
  <HeartIcon filled={isFavourite} />
</Pressable>
```

The label describes the **action**, not the glyph. Never "heart icon".

## Decorative imagery

```tsx
<Image
  source={pattern}
  accessible={false}
  importantForAccessibility="no-hide-descendants"   // Android
  accessibilityElementsHidden                        // iOS
/>
```

## Component checklist

- [ ] `accessibilityRole` + accessible name on anything interactive
- [ ] `accessibilityState` reflects disabled / selected / busy
- [ ] Target ≥ 44×44pt, or `hitSlop` compensates
- [ ] Colours from theme tokens; verified in both light and dark
- [ ] Text scales; `minHeight` rather than fixed `height`
- [ ] Android ripple, iOS pressed state
- [ ] Props typed; no `any`; style typed as `StyleProp<ViewStyle>`
- [ ] Static styles hoisted into `StyleSheet.create`
- [ ] No unnecessary memoisation
