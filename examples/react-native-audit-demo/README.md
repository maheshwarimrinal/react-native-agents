# React Native Audit Demo

This directory is an intentionally flawed React Native example for demonstrating the React Native Audit GitHub Action.

It contains realistic issues across performance, security, accessibility, code quality, testing, and release configuration. **Do not copy this code into production.**

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
| `eas.json` | Release | OTA channel configuration requiring runtime compatibility review |

The exact findings depend on the provider, model, and changed lines. These are expected issue categories, not guaranteed model output.

## Project setup

This is a lightweight fixture for code review. It is not intended to be a complete production Expo application or a teaching example of corrected code.
