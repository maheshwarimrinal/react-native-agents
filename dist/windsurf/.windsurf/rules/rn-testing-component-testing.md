---
trigger: manual
description: "RN Testing: Component Testing with RNTL"
---

# Component Testing with RNTL

## Setup

```js
// jest.config.js
module.exports = {
  preset: 'jest-expo',            // or 'react-native'
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/**/index.ts'],
};
```

`transformIgnorePatterns` is the single most common source of "Jest failed to parse a file" —
node_modules aren't transformed by default, but RN libraries ship untranspiled ESM. When a new
library breaks the suite, this is almost always why: add it to the negative lookahead.

```ts
// jest.setup.ts
import '@testing-library/react-native/extend-expect';

// Reanimated needs its mock
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Silence the animation warning
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');
```

## Query priority

```tsx
// 1. Role + accessible name — best. Also proves screen-reader reachability.
screen.getByRole('button', { name: 'Add to cart' });
screen.getByRole('header', { name: 'Your orders' });

// 2. Label / accessibility label
screen.getByLabelText('Email address');

// 3. Visible text — good for content assertions
screen.getByText('Order confirmed');
screen.getByText(/shipped on/i);

// 4. Placeholder / display value
screen.getByPlaceholderText('Search products');

// 5. testID — last resort, for elements with no accessible handle
screen.getByTestId('chart-canvas');
```

Variants: `getBy*` throws if absent (assert presence), `queryBy*` returns null (assert
**absence**), `findBy*` returns a promise (assert appearance after async work). Using `getBy*`
to check something is gone always fails with a confusing error — use `queryBy*`.

## user-event, not fireEvent

```tsx
import { render, screen, userEvent } from '@testing-library/react-native';

const user = userEvent.setup();

await user.press(screen.getByRole('button', { name: 'Submit' }));
await user.type(screen.getByLabelText('Email'), 'a@b.com');
await user.clear(input);
await user.scrollTo(screen.getByTestId('list'), { y: 400 });
```

`userEvent` simulates the real event sequence (focus, press-in, press-out, change) and advances
timers. `fireEvent.press` fires a single synthetic event and can pass when a real user
interaction would fail. Prefer `userEvent`; keep `fireEvent` for low-level cases it doesn't cover.

## Async

```tsx
// ✓ findBy — waits for the element
expect(await screen.findByText('Order confirmed')).toBeVisible();

// ✓ waitFor — for non-element conditions
await waitFor(() => expect(mockAnalytics).toHaveBeenCalledWith('purchase'));

// ✓ waitForElementToBeRemoved — for disappearance
await waitForElementToBeRemoved(() => screen.queryByTestId('spinner'));

// ✗ pointless — the assertion is synchronous
await waitFor(() => expect(screen.getByText('Hi')).toBeVisible());

// ✗ flaky and slow
await new Promise((r) => setTimeout(r, 1000));
```

**`act` warnings** mean state updated outside React's knowledge — almost always an un-awaited
promise resolving after the test moved on. The fix is to await the thing, not to wrap in `act()`.

## Render helpers

Wrap once so every test gets the real providers:

```tsx
// test-utils.tsx
export function renderWithProviders(ui: ReactElement, { route = '/' } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },   // no retries in tests
  });
  return {
    ...render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 },
                                          insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <NavigationContainer>{ui}</NavigationContainer>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    ),
    queryClient,
  };
}
```

`SafeAreaProvider` needs `initialMetrics` in tests or insets are zero and layout-dependent
assertions behave differently than on device.

## Testing hooks

```tsx
import { renderHook, act, waitFor } from '@testing-library/react-native';

const { result } = renderHook(() => useCart(), { wrapper: Providers });

act(() => { result.current.add(item); });
expect(result.current.total).toBe(1999);

await waitFor(() => expect(result.current.isSynced).toBe(true));
```

Test a hook directly only when it has substantial logic of its own. A hook that just wires a
component to a store is better tested through the component.

## What to assert

```tsx
// ✓ user-visible outcomes
expect(await screen.findByText('2 items')).toBeVisible();
expect(screen.getByRole('button', { name: 'Checkout' })).toBeEnabled();
expect(screen.queryByText('Out of stock')).toBeNull();

// ✓ contract with the outside world
expect(mockApi.createOrder).toHaveBeenCalledWith({ cartId: 'c1', promo: undefined });

// ✗ implementation details
expect(useStore.getState().internalFlag).toBe(true);
expect(mockSetState).toHaveBeenCalled();
```

Matchers from `@testing-library/react-native`: `toBeVisible`, `toBeOnTheScreen`, `toBeEnabled`,
`toBeDisabled`, `toHaveTextContent`, `toHaveStyle`, `toHaveAccessibilityValue`,
`toHaveDisplayValue`.

## Accessibility assertions come free

```tsx
// If this query fails, a screen reader user can't find the button either
expect(screen.getByRole('button', { name: 'Delete account' })).toBeVisible();
expect(screen.getByLabelText('Email address')).toBeOnTheScreen();
expect(screen.getByRole('switch')).toHaveAccessibilityState({ checked: true });
```

Writing tests this way is the cheapest accessibility enforcement available — it catches missing
labels and roles at PR time rather than in an audit.

## Common failures and fixes

| Symptom | Cause | Fix |
|---|---|---|
| "Unable to find an element" | Async not awaited | `findBy*` instead of `getBy*` |
| `act(...)` warning | Promise resolved after the test | Await the interaction/assertion |
| "Cannot use import outside a module" | Untransformed node_modules | `transformIgnorePatterns` |
| Timers never fire | Fake timers without advancing | `jest.advanceTimersByTime()` or `userEvent` |
| Passes alone, fails in the suite | Shared state | Reset mocks/stores in `beforeEach` |
| Reanimated errors | Missing mock | `react-native-reanimated/mock` in setup |
| Test finds two elements | Ambiguous query | Scope with `within()`, or make the label distinct |

Always `jest.clearAllMocks()` (or `restoreMocks: true` in config) and reset any module-level
store between tests. Cross-test contamination is the second-biggest source of flakiness after
un-awaited async.

## Audit

```bash
rg 'toMatchSnapshot' --type tsx -c                      # snapshot-heavy suites
rg 'getByTestId' --type tsx -c                          # vs getByRole count
rg 'fireEvent' --type tsx -c                            # migrate to userEvent
rg 'setTimeout|sleep\(' --type tsx --glob '*test*'      # arbitrary waits
rg 'jest\.mock\(' --type tsx -c | sort -t: -k2 -rn | head   # over-mocked files
rg 'waitFor\(\(\) => expect' --type tsx -A 1 | rg -c 'getBy'
```
