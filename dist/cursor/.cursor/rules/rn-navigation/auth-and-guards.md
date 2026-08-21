# Auth Guards and Redirects

## One boundary, not a check per screen

Per-screen auth checks are unverifiable. You cannot tell by reading whether every protected screen
has one, and the screen added next sprint will not.

Put the boundary in the tree itself:

```tsx
function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') return <SplashScreen />;

  return (
    <Stack.Navigator>
      {status === 'authenticated' ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
}
```

Now a protected screen is unreachable when signed out because it **does not exist in the tree** —
which is a much stronger guarantee than a check that has to be remembered.

## Three states, not two

`loading` is a real state and conflating it with `unauthenticated` produces a specific, common bug:
on launch, auth is restored from storage asynchronously, so for the first frames the user appears
signed out. Render the app and they see the login screen flash before landing on the home screen.
Worse, if a deep link is being processed during that window, it is evaluated against the wrong auth
state and dropped.

Hold on a splash until auth resolves.

## Preserve intent across login

A link to a protected screen must survive the login and land there afterwards. Dropping the user on
a generic home screen after they logged in specifically to see something is a bad experience and a
common one.

```tsx
const pendingTarget = useRef<Target | null>(null);

function handleDeepLink(url: string) {
  const target = toTarget(url);
  if (!target) return;

  if (auth.status !== 'authenticated' && target.requiresAuth) {
    pendingTarget.current = target;   // hold it
    return;                            // the tree will render AuthStack
  }
  navigate(target);
}

// After a successful login
useEffect(() => {
  if (auth.status === 'authenticated' && pendingTarget.current) {
    navigate(pendingTarget.current);
    pendingTarget.current = null;
  }
}, [auth.status]);
```

The same pattern serves notification taps. Keep one implementation — see `structure.md`.

## Reset, do not navigate, at auth transitions

```tsx
// ✗ leaves the login screen in the stack; back returns to it
navigation.navigate('Home');

// ✓ new stack
navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
```

If the tree already swaps on auth state as above, this happens naturally — which is another
argument for that structure.

## Clear state on logout

Navigation state can outlive a session. On logout, reset the tree and clear any persisted
navigation state, or the next user of the device can land in a screen belonging to the previous
account. If any params carry personal data, those are in memory and possibly in persisted state
too.

## Expiry mid-session is a navigation problem

A token expiring while the user is deep in the app is usually handled at the network layer, and the
navigation half is forgotten. The user sees failed requests on a screen they cannot use.

Handle it centrally: on an unrecoverable auth failure, reset to the auth stack and preserve where
they were so they return there after signing in.

## Do not rely on navigation for authorisation

Hiding a screen prevents navigation, not access. If the data behind it matters, the **server** must
enforce it. Client-side routing is user experience; it is not a security boundary, and treating it
as one is a finding for `rn-security`.
