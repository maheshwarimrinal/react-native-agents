// An accessible, themed, scaling-safe control. Nothing here should be reported.
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import { useTheme } from '@/shared/theme';
import { spacing, radius, typography } from '@/shared/theme/tokens';
import { HeartIcon, ShareIcon } from './icons';

type Props = {
  liked: boolean;
  postedLabel: string;
  onLike: () => void;
  onShare: () => void;
};

export function PostActions({ liked, postedLabel, onLike, onShare }: Props) {
  const { theme } = useTheme();

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onLike}
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Remove from favourites' : 'Add to favourites'}
        accessibilityState={{ selected: liked }}
        hitSlop={12}
        android_ripple={{ color: theme.ripple, borderless: true }}
        style={({ pressed }) => [
          styles.iconButton,
          pressed && Platform.OS === 'ios' && styles.pressed,
        ]}
      >
        <HeartIcon filled={liked} color={theme.accent} />
      </Pressable>

      <Pressable
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel="Share this post"
        hitSlop={12}
        android_ripple={{ color: theme.ripple, borderless: true }}
        style={({ pressed }) => [
          styles.iconButton,
          pressed && Platform.OS === 'ios' && styles.pressed,
        ]}
      >
        <ShareIcon color={theme.textSecondary} />
      </Pressable>

      <Text
        style={[typography.caption, { color: theme.textSecondary }]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.6}
      >
        {postedLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  // 44x44 minimum target; the icon inside is smaller but hitSlop covers the rest.
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  pressed: { opacity: 0.7 },
});
