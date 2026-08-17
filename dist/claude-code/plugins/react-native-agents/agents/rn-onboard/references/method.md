# Orientation Method

## The first ten minutes

Read the decisions, not the code. These files carry more information per minute than anything else
in the repository.

```bash
# What is this, and what did they choose?
node -p "const p=require('./package.json'); JSON.stringify({rn:p.dependencies['react-native'], expo:p.dependencies.expo, react:p.dependencies.react, scripts:Object.keys(p.scripts)}, null, 2)"

# Bare or managed?
ls -d ios android 2>/dev/null || echo 'managed Expo — no native directories'

# New Architecture?
rg -n "newArchEnabled|RCT_NEW_ARCH_ENABLED" android/gradle.properties ios/Podfile app.json app.config.* 2>/dev/null

# The shape of the thing
fd -t d -d 2 . src app 2>/dev/null | head -30

# Size and age
git log --oneline | wc -l
git log -1 --format='last commit: %ci'
git shortlog -sn --all | head -10
```

That tells you the framework, the architecture, the structure, the activity level, and who has been
involved — before you have opened a single component.

## Then the dependencies, read as decisions

```bash
node -p "Object.keys(require('./package.json').dependencies).join('\n')"
```

Scan for the ones that answer a structural question: navigation (`@react-navigation/*`,
`expo-router`), state (`zustand`, `@reduxjs/toolkit`, `jotai`), server state
(`@tanstack/react-query`), storage (`async-storage`, `mmkv`, `keychain`), backend (`firebase`,
`supabase`, `amplify`), and anything with native code.

Two dependencies at the same job — two state libraries, two HTTP clients, two date libraries — is
one of the most informative things you can find. It usually means a migration that was started and
not finished, and there is now code written both ways.

## Then the entry points

```bash
cat index.js 2>/dev/null || cat index.ts
rg -l "NavigationContainer|createNativeStackNavigator|expo-router" --glob "**/*.tsx" | head
```

`index.js` shows what is registered before the app mounts — crash reporting, background handlers,
polyfills. The navigation tree shows every screen and how they relate. Between them you have the
skeleton.

## Then one feature, all the way through

Pick something real and central — login, checkout, the main list. Follow it from the screen, through
the state, through the network layer, to the API, and back through the error path.

This single exercise teaches more about the team's actual patterns than any amount of browsing,
because it shows what they do repeatedly rather than what they wrote in a README once.

Follow the **error path** specifically. How a codebase handles failure tells you more about its
maturity than how it handles success.

## What git tells you

```bash
# Files that change most — the hot spots, and where the risk is
git log --format=format: --name-only | sort | uniq -c | sort -rn | head -20

# Who knows what
git log --format='%an' -- src/features/checkout | sort | uniq -c | sort -rn | head -5

# Recent direction
git log --oneline -30
```

The most-changed files are where bugs and merge conflicts concentrate. If one person wrote all of a
critical area and has left, that is a risk worth naming early.

## Say what you verified

Distinguish what you read from what you inferred. "There is no test for checkout" should mean you
looked. Onboarding output that mixes observation with assumption is worse than none, because the
newcomer cannot tell which is which.
