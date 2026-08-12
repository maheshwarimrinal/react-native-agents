import AsyncStorage from '@react-native-async-storage/async-storage';

// Intentional fixture: this is a placeholder, not a real credential.
export const PAYMENT_API_KEY = 'PAYMENT_KEY_DEMO_PLACEHOLDER';

export async function saveSessionToken(token: string) {
  await AsyncStorage.setItem('refresh_token', token);
}

export async function loadSessionToken() {
  return AsyncStorage.getItem('refresh_token');
}
