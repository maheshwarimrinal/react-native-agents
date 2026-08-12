# Mocking

## Mock at the boundary, not inside your code

The best mock is the one furthest from the code under test. Mocking your own modules couples the
test to your structure; mocking the network keeps the whole real code path under test.

```
[ component ] → [ hook ] → [ service ] → [ fetch ] ⟵ mock here (MSW)
```

## MSW for network

```ts
// test/msw/server.ts
import { setupServer } from 'msw/native';
import { http, HttpResponse } from 'msw';

export const server = setupServer(
  http.get('*/api/orders', () => HttpResponse.json([{ id: '1', total: 1999 }])),
  http.post('*/api/orders', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ id: '2', ...body }, { status: 201 });
  }),
);

// jest.setup.ts
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: 'error'` is important — it turns "the test silently hit a real endpoint"
into a loud failure.

Override per test for edge cases:

```ts
it('shows an error when the server fails', async () => {
  server.use(http.get('*/api/orders', () => new HttpResponse(null, { status: 500 })));
  renderWithProviders(<Orders />);
  expect(await screen.findByText(/couldn't load/i)).toBeVisible();
});
```

This is how you cheaply test the states that are hardest to reach manually: 500s, timeouts, empty
arrays, malformed payloads.

## Native modules

Most well-maintained libraries ship a mock. Check before writing your own.

```ts
// jest.setup.ts
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// expo-secure-store — hand-rolled, in-memory
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (k, v) => { store.set(k, v); }),
    getItemAsync: jest.fn(async (k) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k) => { store.delete(k); }),
    __store: store,
  };
});

// react-native-mmkv
jest.mock('react-native-mmkv', () => {
  const s = new Map();
  return { MMKV: jest.fn(() => ({
    set: (k, v) => s.set(k, v),
    getString: (k) => s.get(k),
    delete: (k) => s.delete(k),
    clearAll: () => s.clear(),
  })) };
});
```

A **stateful** mock (backed by a `Map`) is far more useful than one returning fixed values — it
lets you test the write-then-read cycle, which is where the real bugs live.

Permissions, camera, geolocation, biometrics, and notifications all need mocks. Give each one a
way to simulate denial:

```ts
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 0, longitude: 0 } })),
}));

// in the denial test
(Location.requestForegroundPermissionsAsync as jest.Mock)
  .mockResolvedValueOnce({ status: 'denied' });
```

The denied/unavailable paths are the ones that ship broken, because nobody exercises them by
hand.

## Navigation

Prefer rendering a real navigator — it catches param and route bugs that a mocked
`navigation.navigate` never will:

```tsx
function renderScreen(initial = 'Product') {
  return render(
    <NavigationContainer>
      <Stack.Navigator initialRouteName={initial}>
        <Stack.Screen name="Product" component={ProductScreen} initialParams={{ id: '1' }} />
        <Stack.Screen name="Cart" component={CartScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}
```

When you do need to assert on navigation, spy rather than replace:

```ts
const navigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate, goBack: jest.fn() }),
}));
```

`jest.requireActual` spread is the pattern to remember — it mocks one export without breaking the
rest of the module.

## Timers

```ts
jest.useFakeTimers();

it('debounces search', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await user.type(screen.getByLabelText('Search'), 'shoe');
  expect(mockSearch).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(500); });
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

afterEach(() => { jest.useRealTimers(); });
```

Fake timers plus un-advanced promises is a classic hang. `userEvent.setup({ advanceTimers })`
wires them together correctly.

Freeze time when testing anything date-dependent, or the test fails at midnight or in another
timezone:

```ts
jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
```

## Test data

Use factories with sensible defaults and per-test overrides:

```ts
export const makeUser = (o: Partial<User> = {}): User => ({
  id: 'u1', email: 'a@b.com', role: 'member', createdAt: new Date('2026-01-01'), ...o,
});
```

Never share a mutable fixture object across tests — one test mutating it makes another fail
depending on order, which is maddening to debug.

Validate fixtures against your real schema so they can't drift from the API:

```ts
export const makeUser = (o: Partial<User> = {}) => UserSchema.parse({ ...defaults, ...o });
```

## What not to mock

- **The component under test**, or its hooks. You'd be testing the mock.
- **Pure functions.** Just call them.
- **Your own store.** Render with a real store seeded to the state you want.
- **Everything, reflexively.** Each mock is a claim about how a dependency behaves. Claims drift;
  drifted mocks make tests pass while production breaks.

## Audit

```bash
rg 'jest\.mock\(' --type tsx -c | sort -t: -k2 -rn | head    # most-mocked files
rg 'jest\.mock\(.\./' --type tsx                              # mocking local modules — suspicious
rg 'msw|setupServer' --type ts -l
rg 'useFakeTimers' --type tsx -A 20 | rg -c useRealTimers     # timers restored?
rg 'new Date\(\)' --type tsx --glob '*test*'                  # unfrozen time
rg 'mockResolvedValue' --type tsx -c
```
