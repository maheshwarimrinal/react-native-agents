// The app store. Grown over two years.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from './api';

export const useAppStore = create(
  persist<AppState>(
    (set, get) => ({
      authToken: null,
      user: null,
      isAuthenticated: false,

      orders: [],
      ordersLoading: false,
      ordersError: null,

      cart: [],
      cartTotal: 0,

      signIn: async (email, password) => {
        const { token, user } = await api.signIn(email, password);
        set({ authToken: token, user, isAuthenticated: true });
      },

      fetchOrders: async () => {
        set({ ordersLoading: true });
        try {
          set({ orders: await api.getOrders(), ordersLoading: false });
        } catch (e) {
          set({ ordersError: e as Error, ordersLoading: false });
        }
      },

      addToCart: (item) =>
        set((s) => ({ cart: [...s.cart, item], cartTotal: s.cartTotal + item.price })),
    }),
    { name: 'app-store', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

// Used in 60+ components
export function useApp() {
  return useAppStore();
}
