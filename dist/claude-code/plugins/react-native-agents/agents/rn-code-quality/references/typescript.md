# TypeScript in React Native

## Baseline config

```jsonc
{
  "extends": "expo/tsconfig.base",   // or @react-native/typescript-config
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,     // arr[0] is T | undefined — catches real crashes
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```

`noUncheckedIndexedAccess` is the highest-value non-default flag. `items[0].name` crashing on an
empty array is a top-five production crash in RN apps, and this flag turns it into a compile
error.

Adopting strict mode on an existing codebase: turn on one flag at a time, fix, commit. Turning
on all of `strict` at once produces 4,000 errors and gets reverted.

## The `any` problem

`any` disables checking for everything it touches, silently and transitively. Where it appears:

```ts
// ✗
const data: any = await res.json();
catch (e: any) { ... }
const x = y as any as Foo;
function f(props: any) { }

// ✓
const data: unknown = await res.json();
const parsed = UserSchema.parse(data);      // validated, then typed

catch (e) {                                  // e is unknown in modern TS
  const message = e instanceof Error ? e.message : String(e);
}
```

`unknown` forces you to narrow. That's the point.

Ban it in lint (`@typescript-eslint/no-explicit-any`) and require a comment for each `// eslint-disable`
so the exceptions are visible and reviewable.

## Validate at the boundary

TypeScript types are erased at runtime. A `User` type is a promise about what the server sends,
not a guarantee. The moment the backend changes a field, your typed code crashes with
`undefined is not an object`.

```ts
import { z } from 'zod';

const User = z.object({
  id: z.string(),
  email: z.string().email(),
  createdAt: z.coerce.date(),
  role: z.enum(['admin', 'member']),
  avatarUrl: z.string().url().nullable(),
});
export type User = z.infer<typeof User>;   // one source of truth

export async function fetchUser(id: string): Promise<User> {
  const res = await api.get(`/users/${id}`);
  return User.parse(res.data);             // throws with a useful message at the boundary
}
```

Validate at every trust boundary: network responses, deep-link params, persisted storage (schemas
change between app versions!), WebView `postMessage`, push payloads, native module returns.

Use `safeParse` where a failure should degrade rather than throw, and report parse failures to
your error tracker — they're your early warning that the backend changed.

## Discriminated unions over optional soup

```ts
// ✗ 8 impossible states representable; every consumer writes defensive checks
type State = { loading: boolean; data?: User; error?: Error };

// ✓ exactly the states that exist
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: User }
  | { status: 'error'; error: Error };

switch (state.status) {
  case 'success': return <Profile user={state.data} />;   // data is non-optional here
  case 'error':   return <Retry error={state.error} />;
  default:        return <Skeleton />;
}
```

Add exhaustiveness checking so a new variant becomes a compile error:

```ts
function assertNever(x: never): never { throw new Error(`Unhandled: ${JSON.stringify(x)}`); }
```

## Typed navigation

```ts
// navigation/types.ts
export type RootStackParamList = {
  Home: undefined;
  Product: { productId: string };
  Checkout: { cartId: string; promo?: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
```

Now `navigation.navigate('Product')` without params is a compile error, and `route.params` is
typed inside the screen. With Expo Router, `typedRoutes: true` in the Expo config generates this
from the file tree.

## Branded types for IDs

```ts
type UserId = string & { readonly __brand: 'UserId' };
type OrderId = string & { readonly __brand: 'OrderId' };
```

Prevents `getOrder(userId)` compiling. Worth it in domains with many ID types; overkill in a
small app. Judgement call.

## Component typing

```tsx
// Props: explicit, no React.FC (it adds implicit children and complicates generics)
type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
} & Omit<PressableProps, 'onPress'>;      // inherit the platform surface

export function Button({ title, onPress, variant = 'primary', ...rest }: ButtonProps) { ... }
```

- Type style props as `StyleProp<ViewStyle>` / `StyleProp<TextStyle>`, not `object` or `any`.
- Type refs with the element type: `useRef<TextInput>(null)`.
- `satisfies` when you want inference *and* a constraint:
  ```ts
  const theme = { primary: '#0af', bg: '#fff' } satisfies Record<string, ColorValue>;
  // theme.primary is '#0af', not string
  ```

## Assertions and non-null

```ts
// ✗ each one is a promise the compiler can't check
const el = ref.current!;
const user = data as User;

// ✓ narrow, or handle the absence
if (!ref.current) return;
const el = ref.current;
```

`as` is occasionally necessary at genuine boundaries (native module returns, third-party gaps).
Each use should be adjacent to a runtime check or a comment explaining why it's sound.

## Common RN type gaps

- Untyped native modules — write a `.d.ts` for them rather than sprinkling `any`.
- `TurboModuleRegistry` codegen specs give you generated types; use them.
- Third-party libraries without types: check `@types/*` first, then write a minimal local
  declaration for the surface you use, rather than `declare module 'x';` (which is `any`).
- `Platform.OS` narrowing works: `if (Platform.OS === 'ios')` narrows correctly in modern RN types.

## Audit

```bash
rg ':\s*any\b|as any|<any>' --type ts | rg -v '\.d\.ts'
rg '!\.' --type ts                              # non-null assertions
rg 'declare module' --type ts
rg '@ts-ignore|@ts-expect-error' --type ts      # expect-error is fine; ignore is not
rg '"strict"' tsconfig.json
npx tsc --noEmit                                 # does it actually pass?
```
