// FIXTURE NOTE — deliberately contains no realistic-looking key literal.
// A string shaped like `sk_live_<24+ chars>` would trip GitHub secret scanning
// and gitleaks on this public repo, so the P0 here is expressed the way the
// mistake usually reaches production anyway: a live secret injected at build
// time through an EXPO_PUBLIC_* variable, which developers widely believe is
// private and which Expo inlines verbatim into the JS bundle.
// Do not "restore realism" by pasting a key-shaped literal here.

import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;

// Set in CI from the production Stripe restricted-to-nothing key.
// Charges and refunds are issued directly from the app.
const STRIPE_SECRET_KEY = process.env.EXPO_PUBLIC_STRIPE_SECRET_KEY!;

export async function refund(chargeId: string, amountCents: number) {
  return fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    body: new URLSearchParams({ charge: chargeId, amount: String(amountCents) }),
  });
}

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
