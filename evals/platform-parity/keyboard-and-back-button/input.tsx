// Reviewed on an iPhone simulator. Ships to both platforms.
import { useEffect } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export function CheckoutForm({ onSubmit, hasUnsavedChanges }: Props) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (hasUnsavedChanges) confirmDiscard();
      return true;
    });
    return () => sub.remove();
  }, [hasUnsavedChanges]);

  return (
    <KeyboardAvoidingView style={styles.fill}>
      <ScrollView>
        <View style={styles.card}>
          <TextInput placeholder="Email" autoCapitalize="sentences" style={styles.input} />
          <TextInput placeholder="Card number" keyboardType="number-pad" style={styles.input} />
          <Pressable onPress={onSubmit} style={styles.submit}>
            <Text>Pay now</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  input: { height: 44, borderWidth: 1, marginBottom: 12 },
  submit: { height: 48, alignItems: 'center', justifyContent: 'center' },
  card: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
});
