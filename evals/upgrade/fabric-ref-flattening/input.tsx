// Worked on 0.74. After upgrading to 0.87 the tooltip never appears.
// Nothing throws, no warning in the console, the build is green.
import { useCallback, useRef, useState } from 'react';
import { Text, View, Pressable, StyleSheet } from 'react-native';

export function TooltipAnchor({ label, hint }: { label: string; hint: string }) {
  const anchorRef = useRef<View>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, _w, h) => {
      setPos({ x, y: y + h });
    });
  }, []);

  return (
    <View>
      <View ref={anchorRef}>
        <Pressable onPress={show} accessibilityRole="button" accessibilityLabel={label}>
          <Text style={styles.label}>{label}</Text>
        </Pressable>
      </View>
      {pos ? (
        <View style={[styles.tip, { top: pos.y, left: pos.x }]}>
          <Text>{hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 16 },
  tip: { position: 'absolute', padding: 8, backgroundColor: '#222' },
});
