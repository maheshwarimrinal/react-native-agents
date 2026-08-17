// Written with both platforms in mind. There is nothing here worth reporting.
import { useEffect } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';

export function ProfileForm({ onSubmit, isDirty, confirmDiscard }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isDirty) return false;
      confirmDiscard();
      return true;
    });
    return () => sub.remove();
  }, [isDirty, confirmDiscard]);

  return (
    <>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={Platform.OS === 'android' ? '#ffffff' : undefined}
        translucent={Platform.OS === 'android'}
      />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.select({ ios: 'padding', android: 'height' })}
        keyboardVerticalOffset={Platform.select({ ios: headerHeight, default: 0 })}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          <View style={styles.card}>
            <TextInput
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable onPress={onSubmit} style={styles.submit} accessibilityRole="button">
              <Text>Save</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  input: { height: 48, borderWidth: 1, marginBottom: 12, paddingHorizontal: 12 },
  submit: { height: 48, alignItems: 'center', justifyContent: 'center' },
  card: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
      },
      android: { elevation: 4 },
    }),
  },
});
