// Client state only. Tokens live in SecureStore, not here.
// There is nothing here worth reporting.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthState = {
  status: AuthStatus;
  userId: string | null;
  onboardingStep: number;
  setAuthenticated: (userId: string) => void;
  setUnauthenticated: () => void;
  setOnboardingStep: (step: number) => void;
  reset: () => void;
};

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      // `loading` is distinct: restoring a session is async, and treating that
      // window as unauthenticated flashes the login screen on every launch.
      status: 'loading',
      userId: null,
      onboardingStep: 0,

      setAuthenticated: (userId) => set({ status: 'authenticated', userId }),
      setUnauthenticated: () => set({ status: 'unauthenticated', userId: null }),
      setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
      reset: () => set({ status: 'unauthenticated', userId: null, onboardingStep: 0 }),
    }),
    {
      name: 'auth',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist the transient status — it must be recomputed from the
      // token in SecureStore on launch.
      partialize: (s) => ({ userId: s.userId, onboardingStep: s.onboardingStep }),
      migrate: (persisted, fromVersion) => {
        const s = persisted as Record<string, unknown>;
        if (fromVersion < 2) {
          return { userId: s.uid ?? null, onboardingStep: s.step ?? 0 };
        }
        return s as { userId: string | null; onboardingStep: number };
      },
    },
  ),
);

export async function signOut() {
  await SecureStore.deleteItemAsync('refreshToken');
  useAuth.getState().reset();
  await useAuth.persist.clearStorage();
}
