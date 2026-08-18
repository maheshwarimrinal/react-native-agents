---
trigger: manual
description: "RN Code Quality: Tooling and Automated Gates"
---

# Tooling and Automated Gates

A rule a linter enforces is worth more than a rule in a style guide. Move as much review as
possible into tooling so human review can focus on design and correctness.

## ESLint (flat config)

```js
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactNative from 'eslint-plugin-react-native';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-native': reactNative,
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      // Correctness — errors
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',        // warn by default; make it an error
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      'no-console': ['error', { allow: ['error'] }],

      // React Native specific
      'react-native/no-inline-styles': 'warn',
      'react-native/no-unused-styles': 'warn',
      'react-native/no-raw-text': 'error',           // catches the bare-string crash
      'react-native/no-single-element-style-arrays': 'warn',

      // Hygiene
      'unused-imports/no-unused-imports': 'error',
      'import/no-cycle': ['error', { maxDepth: 4 }],
      'import/order': ['warn', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      'import/no-restricted-paths': ['error', { zones: [/* feature boundaries */] }],
      eqeqeq: ['error', 'smart'],
    },
  },
);
```

Two high-value rules people leave off:

- **`no-floating-promises`** — an unawaited async call whose rejection disappears. This is
  responsible for a large share of "it silently didn't save" bugs. Requires type-aware linting.
- **`react-native/no-raw-text`** — catches a genuine runtime crash at lint time.

If React Compiler is in use, add `eslint-plugin-react-compiler` — it reports code the compiler
can't safely optimise, which usually means it's violating the rules of React.

## TypeScript

Covered in `typescript.md`. The gate: `tsc --noEmit` must pass in CI. A codebase where type
errors are "normal" has no type safety at all.

## Prettier

Formatting is not worth reviewing. Configure once, enforce, never discuss again.

```json
{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100, "arrowParens": "always" }
```

Use `eslint-config-prettier` to switch off ESLint's stylistic rules so the two don't fight.

## Pre-commit

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix --max-warnings=0", "prettier --write"],
    "*.{json,md,yml}": ["prettier --write"]
  }
}
```

With `husky` or `lefthook`. Keep it fast — a pre-commit hook that takes 40 seconds gets
`--no-verify`'d. Run only on staged files; leave the full type-check and tests to CI.

Add a secret scanner here too (`gitleaks protect --staged`) — cheapest possible place to catch a
committed key.

## Dead code and dependencies

```bash
npx knip                      # unused files, exports, types, dependencies — the best single tool
npx depcheck                  # unused/missing deps
npx madge --circular src/     # circular imports
npx ts-prune                  # unused exports
```

Run `knip` in CI on a schedule rather than per-PR; it needs occasional config tuning and a
failing build over an unused export annoys people.

## CI gates

```yaml
# .github/workflows/ci.yml
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version: 20, cache: npm }
      - run: npm ci                          # frozen install, never `npm install`
      - run: npx tsc --noEmit
      - run: npx eslint . --max-warnings=0
      - run: npx prettier --check .
      - run: npm test -- --coverage
      - run: npx osv-scanner --lockfile=package-lock.json
```

`--max-warnings=0` matters: warnings that never fail anything accumulate into thousands and stop
being read.

Also worth gating: bundle size regression (fail if the JS bundle grows more than N%), and
`npx expo-doctor` / `npx react-native doctor` for environment and dependency-version drift.

## Adopting this on an existing codebase

Turning everything on at once produces 5,000 errors and gets reverted. Instead:

1. Add the rules as `warn`, get a baseline count.
2. Fix by directory or by rule, one PR at a time, promoting each rule to `error` as it reaches
   zero.
3. Use `eslint --fix` and codemods for the mechanical ones.
4. Gate **new and changed files** at the stricter level immediately (lint-staged does this
   naturally) so the problem stops growing while you fix the backlog.
5. Consider `git blame` hygiene: put bulk formatting changes in their own commit and add it to
   `.git-blame-ignore-revs`.

## What to check in review

```bash
ls eslint.config.* .eslintrc*                 # does config exist at all?
rg 'eslint-disable' --glob "**/*.{js,jsx,ts,tsx}" -c | sort -t: -k2 -rn | head   # where are the exceptions?
rg '@ts-ignore' --glob "**/*.{js,jsx,ts,tsx}"                      # prefer @ts-expect-error
rg '"strict"' tsconfig.json
rg 'max-warnings' .github/workflows/ package.json
npx tsc --noEmit 2>&1 | tail -5
npx eslint . 2>&1 | tail -5
```

A large `eslint-disable` count concentrated in one directory is more interesting than the total —
it usually marks the part of the codebase that needs real attention.
