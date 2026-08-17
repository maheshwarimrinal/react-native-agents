# Native Dependencies Cost More

The single most useful question about a dependency is whether it ships native code, because it
changes what kind of decision you are making.

| | JS-only | Ships native code |
|---|---|---|
| Adding it | An install | An install and a rebuild |
| Removing it | Delete the import | Rebuild, and often a Podfile/Gradle cleanup |
| RN upgrades | Usually unaffected | A constraint on every future upgrade |
| New Architecture | Not applicable | Must be migrated, or runs via interop |
| Expo Go | Works | Requires a development build |
| CI | Negligible | Adds native build time on every run |
| Platform gaps | Rare | Common — verify each platform you ship |

A JS-only dependency is a bundle-size decision, and bundle size is recoverable. A native dependency
is an entry in your upgrade matrix for as long as you keep it.

## Detecting native code

```bash
# Does the package contain native source?
ls node_modules/<pkg>/{android,ios} 2>/dev/null
fd -e podspec . node_modules/<pkg> 2>/dev/null

# Is it autolinked — i.e. actually built into your app?
npx react-native config 2>/dev/null | rg -A3 '"<pkg>"'
```

A package can also be native *transitively*. The dependency you are evaluating may be pure JS while
pulling in something that is not.

## What a native dependency commits you to

- **Every future RN upgrade** must clear it. If it is unmaintained, it is a blocker, and it becomes
  a blocker at exactly the moment you are already dealing with an upgrade.
- **New Architecture status**, which is not binary — working through the interop layer is a third
  state that looks like success.
- **Platform coverage.** Verify against the platforms you ship, including any you plan to. A
  library that is iOS/Android only is a wall if you later target web or desktop.
- **Build time**, on every CI run, forever.
- **Expo workflow.** A native dependency means development builds rather than Expo Go, which is a
  change in how the whole team works.

## The Expo module question

If you are on Expo, check whether an Expo-maintained module covers the need. Expo's first-party
modules support the New Architecture out of the box and their native configuration is managed for
you — which removes most of the cost in this file. That is a meaningful advantage and worth
preferring, all else being close.

Do not overstate it: Expo modules do not cover everything, and adopting one for a need it only
partially serves creates its own problem.

## Before recommending a native dependency

State plainly: *"this adds a native dependency, which means a rebuild to adopt, a constraint on
every future React Native upgrade, and a development build instead of Expo Go."*

If the person still wants it after hearing that, the decision is informed. That is the goal — not
to discourage native dependencies, which are frequently the right answer, but to make sure the
commitment is visible at the moment it is being made rather than two years later during an upgrade.
