// DragHandle.tsx — a draggable sheet handle.
// Everything here is on the correct thread. There is nothing worth reporting.
import React, { useEffect } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 800;

export function DragHandle({ onDismiss, height }) {
  // Shared values are the only thing that stays live across the boundary.
  const y = useSharedValue(0);
  const start = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  // The dismissal spring below carries `onDismiss` as its completion callback,
  // so a live animation holds a reference to it. Cancelling on unmount runs that
  // callback with finished === false, which the guard there rejects — a sheet
  // closed by other means cannot fire onDismiss after it is gone.
  useEffect(() => () => cancelAnimation(y), []);

  const pan = Gesture.Pan()
    // Vertical intent required, and a mostly-horizontal drag gives up
    // immediately rather than competing with the content underneath.
    .activeOffsetY([-10, 10])
    .failOffsetX([-5, 5])
    .onStart(() => {
      // Capture where this drag began so a second drag continues rather than
      // jumping back to zero.
      start.value = y.value;
    })
    .onUpdate((e) => {
      y.value = start.value + e.translationY;
    })
    .onEnd((e) => {
      // Velocity as well as distance: a short flick is a dismissal too.
      const dismissed =
        e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY;

      if (dismissed) {
        // Fired from the spring's completion callback, not here — the sheet is
        // still visibly on screen at this point, and unmounting it now would cut
        // the animation off part-way. `finished` is false when the spring was
        // cancelled or replaced, which is what keeps the unmount path safe.
        // Scheduled once at the boundary, never per frame, and with the
        // arguments passed directly rather than curried.
        y.value = withSpring(height, { velocity: e.velocityY }, (finished) => {
          if (finished) scheduleOnRN(onDismiss);
        });
      } else {
        y.value = withSpring(0, { velocity: e.velocityY });
      }
    })
    // Runs on cancellation as well as on a normal release. onEnd does not fire
    // when a gesture is cancelled, so without resetting `y` here an interrupted
    // drag leaves the sheet visibly stranded part-way down.
    .onFinalize((_e, success) => {
      start.value = 0;
      // Only on cancellation — springing here on success would fight the
      // dismissal animation onEnd just started.
      if (!success) y.value = withSpring(0);
    });

  const style = useAnimatedStyle(() => ({
    // Composited: no layout pass per frame.
    transform: [{ translateY: y.value }],
    opacity: reduceMotion ? 1 : 1 - y.value / height / 2,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={style}
        accessibilityRole="adjustable"
        accessibilityLabel="Drag to dismiss"
        // A gesture is not the only route to the action.
        accessibilityActions={[{ name: 'activate', label: 'Dismiss' }]}
        onAccessibilityAction={onDismiss}
      />
    </GestureDetector>
  );
}
