---
trigger: manual
description: "RN Release: Over-the-Air Updates"
---

# Over-the-Air Updates

OTA lets you ship JavaScript, images, and assets without a store review. It is the fastest way to
fix a bug — and the fastest way to break every install at once. Treat it as a production
deployment system with the same rigour, because that is what it is.

## What OTA can and cannot change

| Can | Cannot |
|---|---|
| JS bundle, React components, business logic | Native modules (adding, removing, upgrading) |
| Images and bundled assets | Native permissions, entitlements, manifest changes |
| Configuration read at runtime | App icon, name, splash screen |
| Copy and translations | Anything requiring recompilation |

**The rule that prevents the worst outage:** if the native side changed, the OTA is invalid for
the installed binary. Shipping JS that calls a native module the installed app doesn't have is a
guaranteed crash on launch — and because the app crashes before it can fetch a newer update, the
user **cannot update out of it**. Their only remedy is deleting and reinstalling. This is the
single most damaging mistake in mobile OTA, and runtime versions exist to prevent it.

## Runtime versions

```jsonc
// app.json — the safe default
{
  "expo": {
    "runtimeVersion": { "policy": "fingerprint" },
    "updates": {
      "url": "https://u.expo.dev/<project-id>",
      "fallbackToCacheTimeout": 0,
      "checkAutomatically": "ON_LOAD"
    }
  }
}
```

The `fingerprint` policy hashes your native dependency graph and configuration, so any native
change produces a new runtime version automatically and old binaries simply stop receiving
incompatible updates. Use it. Manual runtime version strings drift the moment someone forgets to
bump one.

```bash
npx expo-updates fingerprint:generate       # inspect what's in the fingerprint
```

Verify before every OTA publish: does the fingerprint match the binaries already in the field?

## Channels and branches

```
channel (baked into the binary at build time)  →  branch (what you publish to)  →  update
```

```bash
eas update --branch production --message "Fix crash in checkout totals"
eas channel:edit production --branch production-hotfix   # repoint without rebuilding
```

The channel→branch indirection is the useful part: you can repoint a channel at a different
branch instantly, which is your rollback and your canary mechanism.

Verify the mapping — a production binary pointed at a staging branch is a real and quiet failure
mode:

```bash
eas channel:list
eas branch:list
```

## Code signing — mandatory

An unsigned update channel is a remote code execution channel into every user's device. Anyone who
compromises your Expo account, your CI publish token, or (without TLS pinning) the network path
can ship arbitrary code.

```bash
npx expo-updates codesigning:generate --key-output-directory keys --certificate-output-directory certs \
  --certificate-validity-duration-years 10 --certificate-common-name "Example Inc"
npx expo-updates codesigning:configure --certificate-input-directory certs --key-input-directory keys
```

The private key lives in your secret store, never in the repo. The certificate is embedded in the
binary; the client verifies every update against it and rejects unsigned or mis-signed manifests.

Also lock down who can publish: publish tokens are equivalent to signing keys in blast radius.

## Rollout and rollback

```bash
# Canary: 10% of the channel
eas update --branch production --rollout-percentage 10 --message "Checkout fix"

# Watch crash-free rate, then widen
eas update:edit --rollout-percentage 50
eas update:edit --rollout-percentage 100

# Rollback options, fastest first
eas update:rollback                                    # revert to the previous update
eas channel:edit production --branch production-stable # repoint the channel
eas update:republish --group <previous-group-id>       # re-publish a known-good update
```

**Rollback is not instant for users.** With `checkAutomatically: 'ON_LOAD'`, a client fetches on
next launch, applies on the launch after that. So a user may run the bad JS once more before
recovering. Design for that: never OTA anything that corrupts persisted state, because the
rollback won't undo the corruption.

Practise the rollback before you need it. A rollback path you've never executed is a hope.

## Applying updates

```ts
import * as Updates from 'expo-updates';

export function useUpdatePrompt() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || __DEV__) return;
      try {
        const { isAvailable } = await Updates.checkForUpdateAsync();
        if (!isAvailable) return;
        await Updates.fetchUpdateAsync();
        // Don't reload mid-task — ask, or apply on next cold start
        promptUser('An update is ready', () => Updates.reloadAsync());
      } catch (e) {
        Sentry.captureException(e);     // never let an update check crash the app
      }
    });
    return () => sub.remove();
  }, []);
}
```

- Never call `reloadAsync()` while the user is mid-form or mid-checkout. Losing input to a silent
  reload is worse than the bug you're fixing.
- Wrap every update call in try/catch — network failures during a check must be invisible.
- `fallbackToCacheTimeout: 0` starts from the cached bundle immediately and downloads in the
  background. A non-zero timeout blocks launch waiting on the network, which is a bad experience
  on poor connections.

## Store policy

Both stores permit OTA for bug fixes and content, and prohibit using it to change the app's
purpose or add functionality not disclosed at review. Shipping a whole feature via OTA to bypass
review is a policy violation and a real risk to your listing. Keep OTA for fixes, copy,
configuration, and small improvements.

## Pre-publish checklist

- [ ] Native dependencies unchanged since the target binary (fingerprint verified)
- [ ] Correct branch, and the channel maps to it
- [ ] Code signing configured and the update signed
- [ ] Tested on a build with the same runtime version — not just in Expo Go
- [ ] Persisted-state migrations, if any, are backward compatible
- [ ] Starting at a partial rollout, not 100%
- [ ] Crash-free rate dashboard open, threshold agreed
- [ ] Rollback command known and previously exercised
- [ ] Source maps uploaded for the new bundle

## CodePush note

Microsoft's App Center retired, and CodePush now lives on as a community/Expo-supported path.
If a project still depends on the legacy App Center CodePush service, that's a migration finding
— plan the move to `expo-updates` or a maintained alternative rather than waiting for it to break.

## Audit

```bash
rg 'runtimeVersion' app.json app.config.*                 # policy: fingerprint?
rg 'codeSigningCertificate' app.json app.config.*         # signing on?
rg 'fallbackToCacheTimeout|checkAutomatically' app.json
rg 'reloadAsync' --glob "**/*.{js,jsx,ts,tsx}" -B 5                            # guarded by a prompt?
rg 'checkForUpdateAsync|fetchUpdateAsync' --glob "**/*.{js,jsx,ts,tsx}" -A 5 | rg -c catch
rg 'channel' eas.json
eas channel:list && eas branch:list
```
