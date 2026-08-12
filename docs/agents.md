# Agents

Each specialist has a compact playbook and an on-demand reference library. The shared context first identifies React Native version, Expo workflow, TypeScript, router, state library, and native architecture.

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

## Release — `rn-release`

Use for EAS, Fastlane, signing, versioning, OTA updates, store submission, staged rollout, monitoring, and rollback.

The agent treats native/OTA compatibility, signing keys, source maps, crash thresholds, and rollback practice as release requirements.

Command: `/rn-release`

## Full audit

The `rn-audit` orchestrator runs all six specialists, deduplicates findings, applies the shared severity scale, and produces a prioritized action list.

Command: `/rn-audit`
