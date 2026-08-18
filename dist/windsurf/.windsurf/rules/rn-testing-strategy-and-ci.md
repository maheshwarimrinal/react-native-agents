---
trigger: manual
description: "RN Testing: Test Strategy and CI"
---

# Test Strategy and CI

## What to test, concretely

Rank by **cost of the bug × likelihood of the bug**, not by what's easy to test.

**Always test:**
- Money: pricing, discounts, tax, currency conversion, totals.
- Auth and permissions: who can see and do what.
- Anything that can lose user data: drafts, offline queues, migrations.
- Pure business logic: validation, state machines, reducers, formatters. Cheapest tests you'll
  ever write, highest value per line.
- Every bug you fix. A regression test is the highest-value test there is, because you have proof
  that code path breaks.

**Usually test:**
- Screen-level happy path plus the main error path.
- Complex conditional rendering.
- Custom hooks with real logic.
- API client behaviour: retries, error mapping, response validation.

**Rarely worth testing:**
- Presentational components with no logic.
- Third-party library behaviour (test your usage, not their code).
- Generated code and constants.
- Styling (unless a computed style encodes logic — theme contrast is a good exception).

## Coverage

Coverage measures which lines ran, not whether they're correct. Use it to find *untested areas*,
never as a target.

```js
coverageThreshold: {
  global: { statements: 60, branches: 55, functions: 60, lines: 60 },
  './src/features/checkout/': { statements: 90, branches: 85 },   // high-stakes: high bar
  './src/shared/lib/pricing.ts': { statements: 100 },
}
```

Differential thresholds like this are far more useful than a global 80% — they say "the money
code is held to a higher standard", which is true.

A global 100% mandate produces tests written to touch lines: assertion-free renders, mocked
everything, and a suite that catches nothing while blocking every PR.

## Structure

```ts
describe('CheckoutScreen', () => {
  describe('when the cart is empty', () => {
    it('shows the empty state and disables checkout', async () => {
      // Arrange
      server.use(http.get('*/cart', () => HttpResponse.json({ items: [] })));
      renderWithProviders(<CheckoutScreen />);

      // Act — (nothing; this is a render assertion)

      // Assert
      expect(await screen.findByText('Your cart is empty')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
    });
  });
});
```

- Test names describe **behaviour and condition**: "disables checkout when the cart is empty",
  not "test checkout 2". When it fails at 2am, the name should tell you what broke.
- One logical assertion per test. Several `expect`s verifying one behaviour is fine; testing three
  behaviours in one test means you only learn about the first failure.
- No conditionals or loops in tests. If a test needs an `if`, it's two tests.
- `it.each` for genuine table-driven cases (validation rules, formatters).

## Performance of the suite

Target: unit + component tests under 2 minutes locally. Beyond that, people stop running them.

```bash
npx jest --maxWorkers=50%             # default oversubscribes on CI containers
npx jest --onlyChanged                # local loop
npx jest --detectOpenHandles          # find the leak keeping the process alive
npx jest --listTests | wc -l
```

Common slowness: rendering the full provider tree for tests that need none of it; real timers;
`transformIgnorePatterns` too broad causing needless transformation; no Jest cache in CI.

## Flake policy

Write it down and enforce it:

1. A test failing intermittently is a **bug**, filed like any other, with an owner.
2. If it can't be fixed within a sprint, `.skip` it with a linked issue — don't leave it failing.
3. Track flake rate in CI (re-run analytics, or a simple retry counter).
4. Never add a blanket retry to make CI green. Retries hide real race conditions, which are
   usually real bugs in the app, not in the test.

The moment the team learns that "CI is just flaky, re-run it", the suite has stopped being a
signal and become a tax.

## CI pipeline

```yaml
name: CI
on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint . --max-warnings=0
      - run: npx jest --ci --coverage --maxWorkers=50%
      - uses: codecov/codecov-action@<sha>

  e2e-smoke:
    needs: quality
    runs-on: ubuntu-latest
    steps: [ /* Maestro against an Android emulator — see e2e.md */ ]
```

Principles:
- **Fail fast**: type check and lint before tests.
- **`npm ci`**, never `npm install` — a lockfile-respecting install.
- **Pin actions to commit SHAs** (see the security agent — tags are mutable).
- **Cache** node_modules, Jest, and Gradle/Pods; RN builds are slow and cache is most of the win.
- **Upload artifacts on failure**: coverage, JUnit XML, E2E screenshots and video.
- **Required checks** on the protected branch, so a red build actually blocks merge.

## Adopting testing on an untested codebase

Don't start with a coverage mandate; you'll get 500 meaningless tests.

1. **Set up the harness** so writing a test is easy (render helper, MSW, factories, mocks). This
   is the highest-leverage step by far — most "we don't write tests" is really "writing the first
   test takes an hour".
2. **Regression tests for every bug fixed** from now on. Zero argument, immediate value.
3. **Test new code** as it's written. Ratchet coverage on changed files only.
4. **Backfill the risky areas** — money, auth, data loss — deliberately.
5. **Add E2E for the two or three flows that must never break.**

Six months of this beats a coverage push every time.

## Audit

```bash
ls jest.config.* jest.setup.* 2>/dev/null
rg 'coverageThreshold' jest.config.js
npx jest --listTests 2>/dev/null | wc -l
rg '\.skip\(|xit\(|xdescribe\(' --type tsx               # skipped tests — why?
rg 'retries|jest-retry|retryTimes' --glob "**/*.{js,jsx,ts,tsx}" .github/    # hidden flake
rg 'npm install' .github/workflows/                       # should be npm ci
rg 'max-warnings|--ci' .github/workflows/
```
