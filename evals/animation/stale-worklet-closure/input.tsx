// SwipeableRow.tsx — swipe-to-delete on a list row.
// The row "sometimes deletes the wrong item" and "stops working after the
// list updates".
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const SCREEN_WIDTH = 400;

export function SwipeableRow({ item, onDelete }) {
  const x = useSharedValue(0);
  const [isDeleting, setIsDeleting] = useState(false);

  // Memoised with an empty dependency array, so this gesture object is built
  // once on the first render and never rebuilt.
  const pan = useMemo(
    () => Gesture.Pan()
    .onUpdate((e) => {
      x.value = e.translationX;
      // Reporting progress to the parent on every frame of the drag.
      runOnJS(onDelete.onProgress)(e.translationX / SCREEN_WIDTH);
    })
    .onEnd(() => {
      // `isDeleting` came from useState, read inside a worklet.
      if (!isDeleting && x.value > 120) {
        setIsDeleting(true);
        runOnJS(onDelete)(item.id);
        x.value = withSpring(SCREEN_WIDTH);
      } else {
        x.value = withSpring(0);
      }
    }),
    [],
  );

  const style = useAnimatedStyle(() => ({
    // Animating `left` rather than a transform.
    left: x.value,
    width: 300 + x.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>
        <Text>{item.label}</Text>
        <View />
      </Animated.View>
    </GestureDetector>
  );
}
