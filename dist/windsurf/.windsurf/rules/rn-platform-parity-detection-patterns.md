---
trigger: manual
description: "RN Platform Parity: Detection Patterns"
---

# Detection Patterns

## Prefer `Platform.select` over ternaries

```tsx
// ✗ scales badly, hides the reasoning, and hits every platform not named
const pad = Platform.OS === 'ios' ? 20 : 16;

// ✓ explicit, extensible, and `default` covers web and anything future
const pad = Platform.select({ ios: 20, android: 16, default: 16 });
```

The ternary's real weakness is that it treats "not iOS" as "Android". If the project ever targets
web, macOS, or Windows, every one of those ternaries silently takes the Android branch.

## Platform-specific files beat inline branching

When divergence is more than a value, split the file:

```
Picker.ios.tsx
Picker.android.tsx
Picker.tsx          // shared types / fallback
```

`import { Picker } from './Picker'` resolves correctly per platform with no conditionals in the
consuming code. This is the right tool when the platforms need genuinely different components — a
date picker, a share sheet, a map — and much cleaner than a component that is half `if`.

## Feature detection ages better than platform detection

```tsx
// ✗ what this actually means is "does this API exist?"
if (Platform.OS === 'ios') { useTaptic(); }

// ✓ says what it means, and survives the API arriving elsewhere
if (typeof Haptics?.impactAsync === 'function') { Haptics.impactAsync(); }
```

Platform checks encode an assumption about capability that may stop being true. This matters most
for anything under active development across platforms.

## Version checks

```tsx
if (Platform.OS === 'android' && Platform.Version >= 33) { /* ... */ }
if (Platform.OS === 'ios' && parseInt(Platform.Version as string, 10) >= 17) { /* ... */ }
```

Note the type difference: `Platform.Version` is a **number** on Android (API level) and a **string**
on iOS. Comparing the iOS value numerically without parsing is a real bug that passes type checking
in JS and fails at runtime in a way that looks like a logic error.

## One-sided branches are worth a second look

```tsx
if (Platform.OS === 'ios') { configureIOSThing(); }
// no else — deliberate, or forgotten?
```

Both are common. The distinction is whether the Android path *needs* nothing or was never written.
This is exactly what a reviewer can catch and a compiler cannot, so it is worth asking rather than
assuming either way.

## Auditing

```bash
# Where the codebase already knows about platform differences
rg -n "Platform\.(OS|select|Version)" --glob "**/*.{ts,tsx,js,jsx}" -c | sort -t: -k2 -rn | head -20

# Platform-specific files
fd -e ios.tsx -e android.tsx -e ios.ts -e android.ts

# Ternaries that assume two platforms
rg -n "Platform\.OS\s*===\s*['\"](ios|android)['\"]\s*\?" --glob "**/*.{ts,tsx}"

# iOS version compared without parsing
rg -n "Platform\.Version\s*[><=]" --glob "**/*.{ts,tsx}" -B2 | rg -i "ios"
```

A file with many platform checks is a candidate for splitting into `.ios` / `.android` variants. A
file with none, that renders UI, is a candidate for the divergence catalogue.
