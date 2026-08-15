# React Native Audit Demo

This directory is an intentionally flawed React Native example for demonstrating the React Native Audit GitHub Action.

It contains realistic issues across performance, security, accessibility, code quality, testing, native modules, and release configuration. **Do not copy this code into production.**

## Run the demonstration

The root workflow at [`.github/workflows/demo-audit.yml`](../../.github/workflows/demo-audit.yml) runs when this demo changes.

To try it yourself:

1. Fork or clone the repository.
2. Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` under repository **Settings → Secrets and variables → Actions**.
3. Change one of the files under `examples/react-native-audit-demo/` and open a pull request.
4. Inspect the inline findings and summary comment posted by the Action.

## Expected findings

| File | Specialist | Example issue |
|---|---|---|
| `src/screens/CatalogueScreen.tsx` | Performance | Unstable list data, index keys, inline row callbacks, and unbounded image loading |
| `src/screens/CatalogueScreen.tsx` | UI & Accessibility | Icon-only button without an accessible label or role |
| `src/lib/auth.ts` | Security | Token stored in AsyncStorage and a credential-like value shipped in JavaScript |
| `src/hooks/useCatalogue.ts` | Code Quality | Derived state and incomplete effect dependencies |
| `src/screens/CatalogueScreen.test.tsx` | Testing | Snapshot and implementation-coupled assertions |
| `android/src/main/java/com/demo/DeviceInfoModule.kt` | Native Modules | Legacy bridge API, synchronous file I/O on the JS thread, a promise that never settles, and a timer that survives every reload |
| `eas.json` | Release | OTA channel configuration requiring runtime compatibility review |

The exact findings depend on the provider, model, and changed lines. These are expected issue categories, not guaranteed model output.

## Which agents run

Routing selects only the specialists the changed files warrant, so a pull request
touching one file will not run all of them. Changing the whole demo routes six:

```text
rn-performance  rn-security  rn-code-quality
rn-ui-accessibility  rn-testing  rn-native-modules  rn-release
```

`rn-doctor` and `rn-build` are deliberately excluded from pull-request review —
they need an error log or a request rather than a diff.

Preview the routing for any change without spending anything:

```bash
node action/index.mjs --diff-file your.diff --provider mock --dry-run true
```

## Project setup

This is a lightweight fixture for code review. It is not intended to be a complete production Expo application or a teaching example of corrected code.
