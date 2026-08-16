// Correct token handling. Nothing here should be reported.
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { api } from './client';

const Session = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.coerce.date(),
  user: z.object({ id: z.string(), role: z.enum(['admin', 'member']) }),
});
export type Session = z.infer<typeof Session>;

const REFRESH_KEY = 'refresh_token';

// Access token stays in memory only — it is short-lived and does not need to
// survive a restart.
let accessToken: string | null = null;
let refreshInFlight: Promise<string> | null = null;

export async function login(email: string, password: string): Promise<Session> {
  const res = await api.post('/auth/login', { email, password });
  const session = Session.parse(res.data);

  accessToken = session.accessToken;
  await SecureStore.setItemAsync(REFRESH_KEY, session.refreshToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });

  return session;
}

/**
 * Single-flight refresh: concurrent 401s must not fire N parallel refreshes.
 * With rotation enabled that would trip reuse detection and log everyone out.
 */
export function refresh(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const stored = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!stored) throw new UnauthenticatedError();

      const res = await api.post('/auth/refresh', { refreshToken: stored });
      const next = Session.parse(res.data);

      accessToken = next.accessToken;
      await SecureStore.setItemAsync(REFRESH_KEY, next.refreshToken, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return next.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function logout(): Promise<void> {
  // Revoke server-side first — deleting locally does not invalidate a token
  // that has already been captured.
  await api.post('/auth/logout').catch(() => undefined);
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class UnauthenticatedError extends Error {
  name = 'UnauthenticatedError';
}
