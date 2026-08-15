# Agents

Each specialist has a compact playbook and an on-demand reference library. The shared context first identifies React Native version, Expo workflow, TypeScript, router, state library, and native architecture.

Agents fall into two groups. **Interactive** agents need something brought to them — an error log, a request — so they are never selected for pull-request review. **Review** agents work from a diff and run in the GitHub Action.

## Doctor — `rn-doctor` (interactive)

Use when a build, install, or dev server fails: Gradle errors, `pod install` failures, `Unable to resolve module`, Xcode signing and archive errors, version conflicts after an upgrade or a merge, and "works on my machine".

The agent diagnoses from the actual error output rather than guessing. It classifies the failure family first, establishes what changed, then gives one hypothesis with the single command that confirms or eliminates it. It deliberately does not lead with the full reset — that costs twenty minutes, destroys the evidence, and fails identically if the cause is a version conflict.

Command: `/rn-doctor`

## Build — `rn-build` (interactive)

Use when writing new code: screens, components, forms, lists, navigation, data fetching.

The other agents review code after it exists; this one exists so there is less for them to find. Output handles safe-area insets, accessibility roles and labels, loading/empty/error states, keyboard behaviour, theme tokens, text scaling, and stable list callbacks by default. It reads the project's conventions first and uses the libraries already installed.

Command: `/rn-new`

## Performance — `rn-performance`

Use for slow lists, dropped frames, startup/TTI, memory growth, bundle size, images, animations, and network work.

The agent measures before optimizing. It covers React Native DevTools, Hermes profiling, Perfetto, Instruments, list identity, row rendering, image decode, Reanimated, and bundle analysis.

Command: `/rn-perf`

## Security — `rn-security`

Use for secrets, storage, authentication, TLS, certificate pinning, WebViews, deep links, platform hardening, dependency supply chain, and privacy.

The agent assumes the app binary and JavaScript bundle are public and maps findings to OWASP MASVS. It distinguishes secure key release from cosmetic biometric gates and reminds teams to rotate secrets already shipped in builds.

Command: `/rn-security`

## Code quality — `rn-code-quality`

Use for architecture, TypeScript, hooks, state management, error handling, navigation, platform divergence, and React Native idioms.

The agent prioritizes correctness, then clarity, then consistency. It avoids turning reviews into low-value lint lists.

Command: `/rn-review`

## UI and accessibility — `rn-ui-accessibility`

Use for responsive layout, safe areas, keyboard handling, dark mode, screen readers, touch targets, contrast, dynamic type, RTL, motion, and loading/error states.

The agent checks what users on small screens, large text, foldables, landscape, and assistive technologies actually experience.

Command: `/rn-ui`

## Testing — `rn-testing`

Use for Jest, React Native Testing Library, native-module mocking, Maestro, Detox, flaky tests, and CI test strategy.

The agent favors behavioral assertions and accessibility queries over implementation details, snapshots, arbitrary waits, and excessive mocking.

Command: `/rn-test`

## Native modules — `rn-native-modules`

Use for native code: TurboModules, Fabric components, JSI, codegen specs, Swift/Kotlin/Objective-C++, threading across the JS boundary, podspec and gradle packaging, autolinking, and migrating legacy bridge modules.

The agent treats the New Architecture as the only architecture — the legacy bridge was removed in React Native 0.82, so `RCTBridgeModule` and `ViewManager` are correctness findings rather than style preferences. It weights crashes, threading, and memory above style, because a mistake here takes the whole app down rather than showing a red screen.

Command: `/rn-native`

## Release — `rn-release`

Use for EAS, Fastlane, signing, versioning, OTA updates, store submission, staged rollout, monitoring, and rollback.

The agent treats native/OTA compatibility, signing keys, source maps, crash thresholds, and rollback practice as release requirements.

Command: `/rn-release`

## Full audit

The `rn-audit` orchestrator runs every review specialist, deduplicates findings, applies the shared severity scale, and produces a prioritized action list. Interactive agents are excluded.

Command: `/rn-audit`

## Bundle size — `rn-size` (tool, not an agent)

Bundle composition is a measurement, not a judgement, so this runs no model at all. It builds the production bundle, attributes bytes per source-map segment, and compares against a base branch.

```bash
npx @maheshwarimrinal/react-native-agents size --base main --budget-delta 100kb
```

Because it is deterministic it costs nothing per run and needs no API key, which makes it viable on every pull request. A failed base build exits non-zero rather than falling back to a single-bundle report, so a budget can never be silently skipped.
