# Agents

Each specialist has a compact playbook and an on-demand reference library. The shared context first identifies React Native version, Expo workflow, TypeScript, router, state library, and native architecture.

Agents fall into two groups. **Interactive** agents need something brought to them — an error log, a question, a rejection notice — so they are never selected for pull-request review. **Review** agents work from a diff and run in the GitHub Action.

There are 24 agents: 7 interactive and 17 review. Routing is narrow by design, so a typical pull request reaches about three of them rather than all seventeen.

## Doctor — `rn-doctor` (interactive)

Use when a build, install, or dev server fails: Gradle errors, `pod install` failures, `Unable to resolve module`, Xcode signing and archive errors, version conflicts after an upgrade or a merge, and "works on my machine".

The agent diagnoses from the actual error output rather than guessing. It classifies the failure family first, establishes what changed, then gives one hypothesis with the single command that confirms or eliminates it. It deliberately does not lead with the full reset — that costs twenty minutes, destroys the evidence, and fails identically if the cause is a version conflict.

Command: `/rn-doctor`

## Build — `rn-build` (interactive)

Use when writing new code: screens, components, forms, lists, navigation, data fetching.

The other agents review code after it exists; this one exists so there is less for them to find. Output handles safe-area insets, accessibility roles and labels, loading/empty/error states, keyboard behaviour, theme tokens, text scaling, and stable list callbacks by default. It reads the project's conventions first and uses the libraries already installed.

Command: `/rn-new`

## Debug — `rn-debug` (interactive)

Use when the app builds and runs but behaves wrong: an infinite render loop, state that will not update, a network call that silently fails, a layout that differs by device, or a bug that only appears in release.

Flipper and the Chrome remote debugger are both gone, so a large share of the debugging advice online describes tools that no longer exist. The agent covers React Native DevTools, the Hermes debugger, and the states that hide bugs — but its main discipline is refusing to propose a cause before there is a reliable reproduction, because forming a hypothesis in the first minute and spending a day confirming it is the most expensive habit in debugging.

Command: `/rn-debug`

## Dependencies — `rn-dependencies` (interactive)

Use when choosing, auditing, or removing a library: New Architecture support, maintenance health, native build cost, transitive weight, and whether a core API already covers the need.

Deliberately not a review agent. By the time a dependency reaches a pull request the decision is made, and supply chain, bundle weight and compatibility are already covered by Security, Performance and Upgrade. Its value is earlier — the question is "what does this commit us to, and what is the exit if it stops being maintained?"

Command: `/rn-deps`

## Onboard — `rn-onboard` (interactive)

Use when orienting in an unfamiliar codebase: joining a team, inheriting a client app, or auditing before quoting work. Produces an architecture map, the team's inferred conventions, and a reading order.

Its most valuable output is the landmines — patched dependencies, an unversioned persisted store, a custom native module nobody maintains, a library blocking upgrades, a bus factor of one on the payment flow. These are what nobody tells a newcomer and what they otherwise discover painfully.

Command: `/rn-onboard`

## Store submission — `rn-store-submission` (interactive)

Use when submitting to the App Store or Google Play, or when an app has been rejected: reading a rejection notice and identifying the actual trigger, privacy manifests and nutrition labels, Play Data Safety, App Tracking Transparency, target API deadlines, and account deletion requirements.

Rejection notices are written to be defensible rather than diagnostic — the guideline cited is a category, not a diagnosis. The agent's first job is deciding which artefact is at fault, because submitting a new build for a metadata rejection wastes a review cycle, and near a launch date that is the expensive part.

Command: `/rn-submit`

## Monorepo — `rn-monorepo` (interactive)

Use for React Native inside a workspace: Metro resolution across packages, hoisting and `node-linker` settings, pnpm/Yarn/npm workspaces with Turborepo or Nx, sharing code with a web app, and native autolinking from a nested app directory.

Its premise is that **most monorepo errors are one of four causes wearing the same message** — Metro cannot see the file, Metro cannot resolve its dependencies, there are two copies of a package, or autolinking did not run from the app directory. `Unable to resolve module` and `Invalid hook call` are the two most common symptoms and neither names its cause. The agent identifies which of the four before changing any configuration, and pushes back on adopting a monorepo at all without a concrete reason.

Command: `/rn-monorepo`

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

## Observability — `rn-observability`

Use for crash reporting, monitoring, and telemetry: Sentry/Crashlytics/New Relic setup, symbolication with dSYMs and ProGuard mappings, source-map upload, breadcrumb and event schema, network instrumentation, distributed tracing, release health, alerting, and PII scrubbing.

The agent's premise is that **broken telemetry looks exactly like a healthy app**. An empty crash dashboard means either the app is stable or the reporter is not working, and those are indistinguishable from the outside. It therefore starts by asking for proof — a symbolicated stack trace from a release build — before looking at coverage, and treats anything that silently disables reporting (a ProGuard rule that strips the SDK, an inverted `__DEV__` guard, a release/dist mismatch) as P0 or P1, because it removes the team's ability to know the app is broken.

Command: `/rn-observe`

## Release — `rn-release`

Use for EAS, Fastlane, signing, versioning, OTA updates, store submission, staged rollout, monitoring, and rollback.

The agent treats native/OTA compatibility, signing keys, source maps, crash thresholds, and rollback practice as release requirements.

Command: `/rn-release`

## Upgrade — `rn-upgrade`

Use for React Native and Expo version upgrades and New Architecture migration: planning the path, the RN/React/Expo/Gradle/Kotlin/JDK matrix, Fabric and TurboModule migration, the interop layer, Codegen specs, package scope moves, and breaking changes.

The premise is that **the upgrade that builds is not the upgrade that works**. The failure teams expect is a red build; the one that costs them is an upgrade that compiles cleanly and changes behaviour — a ref silently `null` because Fabric flattened the view, a library quietly running through the interop layer without concurrent features. It weights behavioural changes that compile cleanly as P0 or P1.

Command: `/rn-upgrade`

## Navigation — `rn-navigation`

Use for navigation architecture and routing: React Navigation and Expo Router structure, deep linking with Universal Links and App Links, auth guards and post-login redirects, typed routes and params, nested navigators, and navigation state persistence.

Its premise is that **a route that works from inside the app tells you nothing about the same route from outside it**. A deep-link bug reproduces only when the app is killed — the state nobody tests and the one most users are in when they tap a link in an email — so it weights anything that breaks on cold start as P0 or P1.

Command: `/rn-nav`

## Push notifications — `rn-push`

Use for push setup and debugging: APNs keys and certificates, FCM configuration, token registration and refresh, foreground and background handlers, silent pushes, notification channels, badge management, and deep linking from a tapped notification.

A push that was sent successfully and never arrived produces no error anywhere — the backend gets a 200, the device is online, nothing is logged. The agent therefore treats push as a ten-link chain and locates the last link that can be proven to work, rather than reading the JavaScript first.

Command: `/rn-push`

## Permissions — `rn-permissions`

Use for runtime permission handling: camera, location, photos, microphone, notifications, contacts and Bluetooth — the iOS/Android semantic differences, purpose strings and manifest declarations, rationale and denial flows, "never ask again", settings deep links, and partial grants.

"Denied" is not one state and not the same state on both platforms. iOS asks once; Android permits re-prompting and has a rationale step. A missing iOS usage description is P0 because it terminates the app at the moment of request, and collapsing `blocked` into `denied` produces a retry button that silently does nothing forever.

Command: `/rn-permissions`

## Platform parity — `rn-platform-parity`

Use for behaviour that differs between iOS and Android: keyboard avoidance, safe areas and notches, the Android hardware back button, permission semantics, text rendering, shadows and elevation, scroll physics, date pickers, and status bar handling.

This is the class of bug a general-purpose reviewer is worst at, because finding it requires knowing which specific APIs diverge — and the code is correct on the platform the author was looking at, so there is no error, no warning, and no failing test. Severity follows what the divergence does to the user flow, not how visually different it looks.

Command: `/rn-parity`

## Offline — `rn-offline`

Use for offline-first behaviour: network state detection, cache and persistence strategy, mutation queues, retry and idempotency, optimistic updates and rollback, conflict resolution, and background sync.

Developers work on fast, stable wifi, so the entire offline surface is invisible during development and discovered by users on a train. Reads and writes are separated deliberately: a failed read shows stale data, while a failed write can lose something the user created — so anything that can lose or duplicate user data is weighted P0.

Command: `/rn-offline`

## State — `rn-state`

Use for state architecture: choosing between Zustand, Redux Toolkit, Jotai and Context, separating server state from client state, selector and re-render behaviour, persistence and hydration, and state shape.

Its premise is that **most "state management problems" are server state kept in a client state library** — caching, refetching, loading flags and retry hand-rolled badly. The library choice matters far less than that split. Persistence bugs are weighted high because an unversioned schema change crashes on launch for existing users only, passing every fresh-install test.

Command: `/rn-state`

## Payments — `rn-payments`

Use for in-app purchases and subscriptions: StoreKit and Play Billing, server-side receipt validation, subscription lifecycle, restore purchases, refunds, family sharing, grace periods, and the store rules governing external payment.

Its premise is that **a purchase is not an event, it is a state you must be able to re-derive**. Code that unlocks a feature in the purchase callback is wrong even when it works, because entitlement also changes through renewal, restore on a new device, family sharing and refund — none of which that callback sees. This is the only area where a bug moves money directly, so findings are weighted by direction: granting entitlement without validation is revenue loss, taking payment without delivering is user harm, and both are P0.

Command: `/rn-pay`

## Background — `rn-background`

Use for work that must happen while the app is not in the foreground: background fetch, headless JS, background location, uploads that outlive the screen, and scheduled tasks — plus the iOS and Android restrictions that decide whether any of it runs.

Its premise is that **scheduled background work is a hint, so design as though it will not run**. Both platforms have tightened background execution for years, and a task may run late, rarely, or never for a given user — silently, with no error. The agent's most valuable question is what the user experiences if the task never fires until they next open the app; if the answer is "the feature is broken", the design needs changing rather than more background APIs.

Command: `/rn-background`

## Full audit

The `rn-audit` orchestrator runs every review specialist, deduplicates findings, applies the shared severity scale, and produces a prioritized action list. Interactive agents are excluded.

Command: `/rn-audit`

## Bundle size — `rn-size` (tool, not an agent)

Bundle composition is a measurement, not a judgement, so this runs no model at all. It builds the production bundle, attributes bytes per source-map segment, and compares against a base branch.

```bash
npx @maheshwarimrinal/react-native-agents size --base main --budget-delta 100kb
```

Because it is deterministic it costs nothing per run and needs no API key, which makes it viable on every pull request. A failed base build exits non-zero rather than falling back to a single-bundle report, so a budget can never be silently skipped.
