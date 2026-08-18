---
trigger: manual
description: "RN State: Persistence and Hydration"
---

# Persistence and Hydration

Where the bugs that only affect **existing users** live — which means they pass every test on a
fresh install and reach production reliably.

## Version and migrate, always

```ts
export const useSettings = create(
  persist<SettingsState>(
    (set) => ({ theme: 'system', units: 'metric' }),
    {
      name: 'settings',
      version: 3,
      migrate: (persisted, fromVersion) => {
        let s = persisted as any;
        if (fromVersion < 2) s = { ...s, units: s.useMetric ? 'metric' : 'imperial' };
        if (fromVersion < 3) s = { ...s, theme: s.darkMode ? 'dark' : 'system' };
        return s as SettingsState;
      },
    },
  ),
);
```

Without a version, an app update that changes the shape loads old data into new code. Best case a
field is undefined; worst case it crashes on launch — **only for users who had the previous
version**. A fresh install works perfectly, so this survives testing and ships.

Every persisted store needs a version from the beginning, even at version 1. Adding it later means
the first migration has no idea what it is migrating from.

## Hydration is asynchronous

```tsx
// ✗ this reads defaults before hydration finishes
const theme = useSettings((s) => s.theme);

// ✗ hasHydrated() is a plain method call, not a subscription. If it returns
//   false on first render, nothing re-renders when hydration completes and the
//   splash screen stays up forever.
const hydrated = useSettings.persist?.hasHydrated();

// ✓ subscribe, and seed with the current value in case hydration already finished
function useHydrated() {
  const [hydrated, setHydrated] = useState(() => useSettings.persist.hasHydrated());

  useEffect(() => {
    const unsubFinish = useSettings.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useSettings.persist.hasHydrated());   // covers the race before subscribing
    return unsubFinish;
  }, []);

  return hydrated;
}

if (!useHydrated()) return <SplashScreen />;
```

The seeding matters as much as the subscription: hydration can finish before the effect runs, and a
listener registered afterwards never fires.

The window is short and consequential. Code reading the store during it sees defaults — a signed-out
user who is signed in, a light theme for someone who chose dark, an onboarding flow for someone who
finished it months ago. The flash is the visible symptom; the dropped deep link is the invisible one.

## Choose what not to persist

```ts
partialize: (s) => ({ theme: s.theme, units: s.units }),   // and nothing else
```

Default to persisting nothing and add deliberately. Persisting the whole store means transient UI
state, error objects, and possibly personal data all end up on disk.

**Never persist tokens or credentials to AsyncStorage.** It is unencrypted. Use Keychain/Keystore
via `react-native-keychain` or `expo-secure-store`. This is a `rn-security` finding whenever it
appears.

## Storage choice

| | AsyncStorage | MMKV | SecureStore / Keychain |
|---|---|---|---|
| Speed | Async, slower | Synchronous, fast | Slower |
| Encryption | None | Optional | Hardware-backed |
| Use for | General persistence | Frequently-read values | Tokens, secrets |

MMKV being synchronous removes the hydration race entirely for the values it holds, which is a real
architectural advantage and not only a speed one.

Do not switch storage libraries without planning the **data migration** — an existing user's data
lives in the old store, and a swap that works on a fresh install silently loses it for everyone
else. This is the same class of bug as the missing version, and it is the most common way a storage
migration goes wrong.

## Bound what you store

Persisting a large list means writing it on every change and parsing it on every launch, which
shows up as slow startup. Persist what is needed to restore the user's context; refetch the rest.

## Clear on logout, including disk

```ts
// Both halves. Clearing storage alone leaves the current process holding the
// previous user's data until the app is relaunched.
useSettings.getState().reset();               // in memory, now
await useSettings.persist?.clearStorage();    // on disk, for the next launch
```

In-memory reset is not enough on its own — the persisted copy outlives it and the next launch restores the
previous user's data.
