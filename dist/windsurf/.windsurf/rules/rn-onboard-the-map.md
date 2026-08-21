---
trigger: manual
description: "RN Onboard: Building the Map"
---

# Building the Map

## Recognise the structure

Most React Native codebases are one of three shapes, and identifying which tells you where to look
for anything.

**By type** — `screens/`, `components/`, `hooks/`, `utils/`, `services/`. Common, easy to start,
and it scales badly: one feature is spread across six directories.

**By feature** — `features/orders/`, `features/cart/`, each holding its own screens, components,
hooks, and API calls. Scales better; related code changes together.

**Hybrid** — features plus a shared layer. The most common mature shape.

```bash
fd -t d -d 3 . src 2>/dev/null | head -40
fd -e tsx -e ts . src 2>/dev/null | wc -l
```

If it is by feature, you can read one feature and understand the pattern. If it is by type, you must
trace across directories, and you should expect the boundaries to be blurrier.

## Find the load-bearing files

Not the biggest files — the most **depended-upon** ones.

```bash
# Most imported modules
rg -o "from '(\.\./|@/)[^']+'" --glob "**/*.{js,jsx,ts,tsx}" -N | sort | uniq -c | sort -rn | head -20

# The network layer
rg -l "fetch\(|axios|createApi" --glob "**/*.{js,jsx,ts,tsx}" | head

# Auth
rg -l "token|signIn|login|authenticate" --glob "**/*.{js,jsx,ts,tsx}" -i | head

# Storage
rg -n "AsyncStorage|MMKV|SecureStore|Keychain" --glob "**/*.{js,jsx,ts,tsx}" -l
```

A module imported in eighty places is one you must understand and must be careful changing. These
are usually the API client, the theme, the auth store, and a few shared components.

## The navigation tree is the app's table of contents

```bash
rg -n "name=\"[A-Za-z]+\"" --glob "**/*.{jsx,tsx}" -o | sed 's/.*name="//;s/"//' | sort -u
```

Every screen the app has. Reading the navigator files gives you the whole feature surface in a few
minutes — faster than any other route to the same knowledge.

## Native code is where the surprises are

```bash
fd -e swift -e kt -e java -e m -e mm ios android 2>/dev/null | rg -v Pods | head -20
ls ios/*/AppDelegate* android/app/src/main/java/**/MainApplication* 2>/dev/null
```

Custom native code means someone needed something the ecosystem did not provide. It is usually
under-documented, often written by someone who has left, and it is the most likely thing to block a
React Native upgrade. Find it early even if you do not read it yet.

## Configuration worth reading

| File | Tells you |
|---|---|
| `app.json` / `app.config.*` | Expo config, plugins, permissions |
| `metro.config.js` | Custom resolution, monorepo setup, asset handling |
| `babel.config.js` | Plugins, module resolution aliases, Reanimated |
| `tsconfig.json` | Strictness, path aliases |
| `eas.json` | Build profiles, environments |
| `.github/workflows/` | What is enforced versus merely encouraged |
| `patches/` | **Read this** — see `landmines.md` |

`metro.config.js` and `babel.config.js` deserve attention because a custom resolver or alias
explains import paths that otherwise make no sense.

## Produce a reading order

The output of orientation should be a short ordered list: *read these six files, in this order, and
you will understand the app.* Typically the entry file, the navigator, the API client, the auth
store, one representative feature, and the shared component that everything uses.

That is far more useful than a complete inventory, and it is the thing an experienced engineer
actually provides on someone's first day.
