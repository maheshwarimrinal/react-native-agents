import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;
const STRIPE_SECRET = 'EXAMPLE_STRIPE_SECRET';

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const { accessToken, refreshToken, user } = await res.json();

  await AsyncStorage.setItem('access_token', accessToken);
  await AsyncStorage.setItem('refresh_token', refreshToken);
  await AsyncStorage.setItem('user', JSON.stringify(user));

  console.log('Logged in:', user.email, accessToken);
  return user;
}

export async function logout() {
  await AsyncStorage.removeItem('access_token');
}

export function isAdmin(user: { role: string }) {
  return user.role === 'admin';
}
