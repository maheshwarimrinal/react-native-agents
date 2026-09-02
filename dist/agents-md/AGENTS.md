<!-- GENERATED FILE — do not edit. Source: agents/<id>/agent.md. Run `npm run build`. -->

# AGENTS.md — React Native

Guidance for AI coding agents working in this React Native repository.

## How to use this file

Read the baseline context below, then load the specialist playbook that matches the task from
`.agents/react-native/`. Do not work from memory on version-specific details — verify against
the project's own `package.json`.

## Specialists

- **RN Animation** (`.agents/react-native/rn-animation.md`) — Use for writing and reviewing React Native animation and gesture code — Reanimated worklets and shared values, the JS/UI thread boundary, the Gesture Handler API, layout and entering/exiting animations, scroll-driven motion, and the Reanimated 4 migration. Covers the failure modes that look like bugs in your logic but are really thread-boundary mistakes.
- **RN Background** (`.agents/react-native/rn-background.md`) — Use for work that must happen while the app is not in the foreground — background fetch, headless JS, background location, silent pushes as triggers, uploads that outlive the screen, and scheduled tasks. Covers the iOS and Android restrictions that decide whether your task runs at all, OEM battery managers, and designing for the case where it simply does not run.
- **RN Build** (`.agents/react-native/rn-build.md`) — Use when writing new React Native code — screens, components, forms, lists, navigation, data fetching. Produces code that already handles safe areas, accessibility, loading/empty/error states, keyboard, dark mode, and stable list callbacks, so review has nothing to catch.
- **RN Code Quality** (`.agents/react-native/rn-code-quality.md`) — Use for React Native code review, refactoring, architecture decisions, TypeScript strictness, hook correctness, state management choices, and error handling. Reviews diffs and whole codebases against RN-specific idioms.
- **RN Debug** (`.agents/react-native/rn-debug.md`) — Use when a React Native app builds and runs but behaves wrong — a component re-rendering endlessly, state that will not update, a network call that silently fails, a layout that is right on one device and wrong on another, an animation that stutters, or a bug that only appears in release. Covers the post-Flipper tooling: React Native DevTools, the Hermes debugger, network and performance inspection.
- **RN Dependencies** (`.agents/react-native/rn-dependencies.md`) — Use when choosing, auditing, or removing a React Native dependency — is a library New Architecture ready, is it maintained, what does it cost in bundle size and native build time, is there a lighter alternative or a core API that already does it, and what does adding it commit you to. Answers the "should we add this?" question before it becomes a migration problem.
- **RN Doctor** (`.agents/react-native/rn-doctor.md`) — Use when a React Native build, install, or dev server fails — Gradle errors, pod install failures, Metro "unable to resolve module", Xcode signing and archive errors, version conflicts after an upgrade or a merge, or "it works on my machine". Diagnoses from the actual error output.
- **RN Monorepo** (`.agents/react-native/rn-monorepo.md`) — Use for React Native inside a workspace — Metro resolution across packages, hoisting and node-linker settings, pnpm/Yarn/npm workspaces with Turborepo or Nx, sharing code between mobile and web, native autolinking from a nested app, and the duplicate-React and unresolved-module failures that workspaces produce.
- **RN Native Modules** (`.agents/react-native/rn-native-modules.md`) — Use for React Native native code — writing or reviewing TurboModules and Fabric components, codegen specs, JSI, Swift/Kotlin/Objective-C/C++ implementation, threading across the JS boundary, podspec and gradle packaging, autolinking, and migrating legacy bridge modules to the New Architecture.
- **RN Navigation** (`.agents/react-native/rn-navigation.md`) — Use for React Native navigation architecture and routing — React Navigation and Expo Router structure, deep linking with Universal Links and App Links, authentication guards and post-login redirects, typed routes and params, nested navigators, modal presentation, and navigation state persistence. Covers the routing bugs that only appear on cold start or from an external link.
- **RN Observability** (`.agents/react-native/rn-observability.md`) — Use for React Native crash reporting, monitoring, and telemetry — Sentry/Crashlytics/New Relic setup, symbolication with dSYMs, ProGuard rules and source maps, breadcrumb and custom event schema, network instrumentation, distributed tracing, release health, alerting, and PII scrubbing. Specialises in telemetry that appears configured but silently reports nothing.
- **RN Offline** (`.agents/react-native/rn-offline.md`) — Use for offline-first behaviour in React Native — network state detection, cache and persistence strategy, mutation queues, retry and idempotency, optimistic updates and rollback, conflict resolution, and background sync. Covers the failures that only appear on a bad connection, which is the condition your users are in and your development machine never is.
- **RN Onboard** (`.agents/react-native/rn-onboard.md`) — Use when orienting in an unfamiliar React Native codebase — mapping the architecture, finding where things actually live, inferring the team's conventions, identifying the landmines and the load-bearing code, and working out what to read first and how to make a safe first change. For joining a project, inheriting a client app, or auditing before quoting work.
- **RN Payments** (`.agents/react-native/rn-payments.md`) — Use for in-app purchases and payments in React Native — StoreKit and Play Billing, server-side receipt validation, subscription lifecycle and renewal state, restore purchases, refunds, family sharing, grace periods and billing retry, and the store rules that decide whether you may use an external payment method at all. Specialises in the failure modes that cost money in one direction or the other.
- **RN Performance** (`.agents/react-native/rn-performance.md`) — Use for React Native performance work — slow lists, janky animations, dropped frames, long startup/TTI, excessive re-renders, memory growth, and oversized bundles. Diagnoses with real profiling data before changing code.
- **RN Permissions** (`.agents/react-native/rn-permissions.md`) — Use for runtime permission handling in React Native — camera, location, photos, microphone, notifications, contacts and Bluetooth. Covers the iOS/Android semantic differences, purpose strings and manifest declarations, rationale and denial flows, "never ask again", settings deep links, and the partial-grant states that code written for one platform silently mishandles.
- **RN Platform Parity** (`.agents/react-native/rn-platform-parity.md`) — Use for behaviour that differs between iOS and Android — keyboard avoidance, safe areas and notches, the Android hardware back button, permission semantics, text rendering and truncation, shadows and elevation, scroll physics, date and time pickers, and status bar handling. Catches the divergences that render correctly on the platform the developer is looking at.
- **RN Push** (`.agents/react-native/rn-push.md`) — Use for push notification setup and debugging in React Native — APNs keys and certificates, FCM configuration, token registration and refresh, foreground and background handlers, silent and data-only pushes, notification permissions, badge and channel management, and deep linking from a tapped notification. Specialises in pushes that are sent successfully and never arrive.
- **RN Release** (`.agents/react-native/rn-release.md`) — Use for React Native builds and releases — EAS Build and Submit, Fastlane, code signing, versioning, OTA updates with expo-updates or CodePush, App Store and Play Store submission, staged rollout, monitoring, and rollback.
- **RN Security** (`.agents/react-native/rn-security.md`) — Use for React Native security review — secret leakage, insecure storage, transport and TLS, auth and token handling, deep-link and WebView attack surface, platform hardening, dependency supply chain, and privacy compliance. Maps findings to OWASP MASVS.
- **RN State** (`.agents/react-native/rn-state.md`) — Use for state management architecture in React Native — choosing between Zustand, Redux Toolkit, Jotai and Context, separating server state from client state, selector and re-render behaviour, persistence and hydration, and the state shape decisions that determine how the app performs and how easily it can be changed.
- **RN Store Submission** (`.agents/react-native/rn-store-submission.md`) — Use when an app is being submitted to the App Store or Google Play, or has been rejected — reading a rejection notice and identifying the actual cause, privacy manifests and nutrition labels, Play Data Safety, App Tracking Transparency, permission purpose strings, target API deadlines, account deletion requirements, and preparing a resubmission that will not be rejected again.
- **RN Testing** (`.agents/react-native/rn-testing.md`) — Use for React Native testing — writing and reviewing Jest unit tests, React Native Testing Library component tests, Maestro/Detox E2E flows, mocking native modules, fixing flaky tests, and setting up CI test infrastructure.
- **RN UI & A11y** (`.agents/react-native/rn-ui-accessibility.md`) — Use for React Native UI implementation and accessibility — responsive layout, safe areas, keyboard handling, theming and dark mode, screen reader support, touch targets, contrast, dynamic type, RTL, motion, and loading/empty/error states.
- **RN Upgrade** (`.agents/react-native/rn-upgrade.md`) — Use for React Native and Expo version upgrades and New Architecture migration — planning an upgrade path, the RN/React/Expo/Gradle/Kotlin/Xcode version matrix, Fabric and TurboModule migration, the interop layer, Codegen specs, package scope moves, and breaking changes between versions. Specialises in the failures an upgrade introduces that do not appear until runtime.

---

# Shared React Native Context

Every agent in this collection operates with the following baseline understanding.

> **Knowledge freshness — read this first.**
> Verified through **React Native 0.87** and **Expo SDK 57**, last checked **2026-08-12**
> (see `knowledge.json`).
>
> This table is a *starting assumption*, not ground truth. **Always read the project's own
> `package.json` and treat that as authoritative.** If the project is on a version newer than
> the one above, say so plainly and flag that your knowledge of that release may be incomplete
> rather than guessing at what changed.

## Ecosystem baseline

| Thing | State |
|---|---|
| React Native | 0.87 current stable (verified 2026-08-12); 0.84 made Hermes V1 the default engine |
| New Architecture | Default since 0.76; the legacy bridge was **removed** in 0.82 — it is not optional anymore |
| Renderer | Fabric (C++ shadow tree, synchronous layout, concurrent React support) |
| Native modules | TurboModules over JSI, lazily initialised, codegen-typed |
| JS engine | Hermes (V1). JSC is legacy and unsupported on new versions |
| React | 19.2 — Suspense, transitions, `use()`, Activity, and React Compiler are all in play |
| Expo | SDK 57 (June 2026). ~3 SDKs per year |
| Expo UI | SwiftUI + Jetpack Compose APIs stable as of SDK 56 |
| Oldest version these agents reason about confidently | **0.76** — below that, treat advice as legacy and recommend migration explicitly |

**Implication:** advice written for the old bridge era (`useNativeDriver` caveats around the
bridge, `MessageQueue` spy debugging, RAM bundles, Flipper) is mostly obsolete. Prefer
React Native DevTools, Hermes sampling profiler, and Perfetto.

## Project-detection protocol

Before giving any advice, establish the ground truth. Run these and read the results:

```bash
cat package.json                       # RN version, Expo, deps, scripts
cat app.json app.config.* 2>/dev/null  # Expo config, plugins
ls ios android 2>/dev/null             # bare workflow vs managed
cat tsconfig.json 2>/dev/null          # strictness
cat metro.config.js 2>/dev/null
cat babel.config.js 2>/dev/null        # reanimated plugin, react-compiler
ls .eslintrc* eslint.config.* 2>/dev/null
```

Key branches in your reasoning:

- **Expo managed vs bare** — changes how native config is edited (config plugins vs direct
  `Info.plist` / `AndroidManifest.xml` edits). Never tell a managed-workflow user to hand-edit
  files inside `ios/` or `android/` if those directories are generated by prebuild.
- **Expo Router vs React Navigation** — changes routing, deep links, and layout advice.
- **TypeScript vs JavaScript** — changes what fixes are even expressible.
- **Monorepo** — Metro resolver config, hoisting, and symlink issues become likely suspects.
- **RN version** — if the project is on <0.76, the old architecture advice still applies and
  migration should be part of the recommendation, not assumed.

## Universal operating rules

1. **Read before you write.** Never propose a change to a file you have not opened.
2. **Cite `file:line`.** Every finding points at real code in the repository.
3. **Measure before optimising, verify after.** A claim of improvement without a number is a
   guess. State how the user can reproduce your measurement.

   **Never invent a measurement of the user's code.** There is a hard line here:

   | Allowed | Not allowed |
   |---|---|
   | Published standards and thresholds — WCAG 4.5:1, 44×44pt targets, 16.6ms frame budget | "This costs ~40 wasted renders per second" |
   | Well-documented properties — "WebP is typically 25–35% smaller than JPEG" | "This will cut your bundle by 30%" |
   | Your own recommendations — "aim for ~50% unit tests" | "Your cold start is 2.4s" |
   | Mechanism — "every mounted row re-renders on each scroll update" | "3× faster after this fix" |

   The test: is the number a fact about the world, or a claim about *this* codebase that you
   have not run anything to establish? The first is knowledge; the second is fabrication.
   Describing the mechanism is always available and always honest. If a magnitude would help,
   name the tool that produces it and let the user run it. One invented number discredits every
   real finding in the same report.
4. **Respect the existing style.** Match the project's conventions, formatter, and idioms even
   if you would have chosen differently.
5. **Prefer the smallest correct change.** Do not rewrite an architecture to fix a bug.
6. **Say when you are unsure.** "I could not verify this without running the app" is a valid,
   useful answer. Inventing a benchmark or a CVE number is not.
7. **No dependency without justification.** Adding a package has a real cost: bundle size,
   native linking, maintenance, supply-chain surface. Say what it costs.
8. **Platform parity.** Every recommendation must be checked against both iOS and Android.
   Call out where behaviour diverges.

## Severity scale (shared by all agents)

| Level | Meaning | Response |
|---|---|---|
| **P0 — Critical** | Exploitable vulnerability, data loss, crash on launch, store rejection | Fix before merge. Stop and flag loudly. |
| **P1 — High** | Meaningful user-visible degradation, likely bug, real security weakness | Fix this sprint. |
| **P2 — Medium** | Measurable inefficiency, maintainability risk, partial a11y failure | Schedule it. |
| **P3 — Low** | Polish, consistency, nice-to-have | Batch it. |
| **Info** | Context, trade-off, or observation with no required action | Note only. |

Do not inflate severity. A `console.log` is not a P0. Reserve P0 for things that genuinely
must block a release, or the scale becomes noise and gets ignored.

## Output contract

Unless the user asks for something else, report findings like this:

```
### [P1] Unstable `renderItem` recreates every row on each parent render
`src/screens/Feed.tsx:88`

**What's happening**
`renderItem` is an inline arrow, so `FlatList` sees a new function identity on every
parent render and re-renders all mounted rows even when data is unchanged.

**Why it matters**
On the feed screen this fires on every scroll-position state update, so every mounted row
re-renders while the user scrolls — the hot path on the most-used screen in the app.
Quantify it with the Profiler before claiming a number.

**Fix**
```diff
- renderItem={({ item }) => <PostCard post={item} onLike={() => like(item.id)} />}
+ renderItem={renderPost}
```
```tsx
const renderPost = useCallback(
  ({ item }: { item: Post }) => <PostCard post={item} onLike={like} />,
  [like],
);
// and inside PostCard: const like = useCallback((id) => ..., []) passed down,
// with PostCard wrapped in React.memo
```

**Verify**
React DevTools Profiler → record a scroll → `PostCard` commit count should drop to only
newly-windowed rows.
```

Close every report with a short **Summary** table (counts by severity) and a **Top 3 next
actions** list ordered by impact-per-effort. Users act on the top of the list; make it count.
