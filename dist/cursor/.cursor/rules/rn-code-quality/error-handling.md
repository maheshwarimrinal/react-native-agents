# Error Handling and Resilience

Mobile is a hostile environment: the network drops mid-request, the OS kills your process, the
user rotates the device during a save, permissions get revoked in Settings. Code that only
handles the happy path is not finished.

## Error boundaries

A JS error in render, without a boundary, unmounts the entire React tree — the user sees a blank
white screen with no way back. This is the single worst failure mode in a React Native app.

```tsx
import { ErrorBoundary } from 'react-error-boundary';

// Per-screen, so one broken screen doesn't take down the app
<ErrorBoundary
  FallbackComponent={ScreenErrorFallback}
  onError={(error, info) => Sentry.captureException(error, { extra: info })}
  onReset={() => queryClient.resetQueries()}
>
  <ProfileScreen />
</ErrorBoundary>
```

Place them:
- Around each screen (via a navigator `screenWrapper` or an HOC so you can't forget).
- Around independently-failing widgets (a feed card, a chart) so one bad item doesn't blank the
  list.
- At the app root as a last resort, with a "restart" action.

The fallback must offer a way forward: retry, go back, or contact support. A fallback that just
says "Something went wrong" strands the user.

**Boundaries do not catch:** event handlers, async code, timers, or errors during SSR. Those need
explicit `try/catch`.

## Global handlers

```ts
// Uncaught JS errors outside React
const defaultHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  Sentry.captureException(error, { level: isFatal ? 'fatal' : 'error' });
  defaultHandler(error, isFatal);       // don't swallow — keep the default behaviour
});

// Unhandled promise rejections
require('promise/setimmediate/rejection-tracking').enable({
  allRejections: true,
  onUnhandled: (id, error) => Sentry.captureException(error),
});
```

Native crashes need a native crash reporter (Sentry, Crashlytics) — JS handlers never see them.

## Never swallow errors

```ts
// ✗ the bug is now invisible; users report "it just doesn't work"
try { await save(); } catch (e) {}
try { await save(); } catch (e) { console.log(e); }

// ✓ decide: recover, report, or rethrow — and tell the user something true
try {
  await save();
} catch (e) {
  if (isNetworkError(e)) {
    await queueForRetry(draft);
    toast('Saved offline — will sync when you reconnect');
    return;
  }
  Sentry.captureException(e, { tags: { feature: 'draft-save' } });
  toast('Could not save. Try again.');
  throw e;                              // if the caller needs to know
}
```

An empty catch block is always worth a review comment. So is a catch that only logs.

## Typed errors

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) { super(message); this.name = 'ApiError'; }
}

export class OfflineError extends Error { name = 'OfflineError'; }
export class ValidationError extends Error {
  constructor(readonly fields: Record<string, string>) { super('Validation failed'); }
}
```

Now call sites can branch meaningfully instead of string-matching `e.message`. Map HTTP status to
behaviour once, in the client:

| Status | Behaviour |
|---|---|
| 401 | Refresh once (single-flight), then log out |
| 403 | Show "no access" — do **not** retry |
| 404 | Empty state, not an error toast |
| 409 | Conflict — refetch and let the user reconcile |
| 422 | Field-level validation errors onto the form |
| 429 | Back off, honour `Retry-After` |
| 5xx | Retry with exponential backoff + jitter, then a real error |
| Network/timeout | Offline path, queue, retry on reconnect |

## Retries

```ts
retry: (failureCount, error) => {
  if (error instanceof ApiError && !error.retryable) return false;   // never retry a 403
  return failureCount < 3;
},
retryDelay: (n) => Math.min(1000 * 2 ** n + Math.random() * 300, 30_000),  // backoff + jitter
```

Retrying a non-idempotent mutation can double-charge someone. Use idempotency keys on mutations,
and don't blanket-retry POSTs.

## Offline

- Detect with NetInfo, but don't trust it as a reachability oracle — captive portals report
  "connected". The authoritative signal is a failed request.
- Show connectivity state in the UI. Silent failure is worse than a visible offline banner.
- Queue mutations with idempotency keys and replay on reconnect, in order, with conflict handling.
- Serve cached data with a "last updated" indicator rather than an empty screen.

## The three states every async surface needs

Loading, empty, and error — plus success. Missing any of them produces a bug report:

```tsx
if (isPending) return <Skeleton />;              // skeleton over spinner: less layout shift
if (error)     return <ErrorState onRetry={refetch} error={error} />;
if (!data?.length) return <EmptyState action={<Button title="Add" onPress={add} />} />;
return <List data={data} />;
```

Empty state ≠ error state. "You have no orders yet" and "We couldn't load your orders" require
different UI and different user actions, and conflating them is a common and confusing bug.

## Error messages

- Say what happened and what to do: "Couldn't save your changes. Check your connection and try
  again." Not "Error 500" and not "Oops!".
- Never surface a stack trace, internal hostname, or raw exception to the user.
- Don't leak whether an account exists ("no user with that email") — that's account enumeration.
- Localise them.

## Crash reporting hygiene

- Upload source maps on every release, or your stack traces are unreadable minified noise.
- Set a release/version and a user-scoped ID (not PII) so you can group and triage.
- Scrub PII in `beforeSend` (see the security agent).
- Add breadcrumbs for navigation and key actions — reproducing a crash without them is guesswork.
- Watch **crash-free session rate** per release, and wire it to your rollout gate.

## Audit

```bash
rg 'catch\s*\([^)]*\)\s*\{\s*\}' --type ts          # empty catch
rg 'catch' --type ts -A 3 | rg -c 'console\.'        # log-and-continue
rg 'ErrorBoundary' --type tsx -l                      # any at all? per screen?
rg 'setGlobalHandler|rejection-tracking' --type ts
rg 'isPending|isLoading' --type tsx -A 6 | rg -c 'EmptyState|empty'
rg 'throw new Error\(' --type ts                      # untyped errors
rg 'status === 401|response\.status' --type ts -A 5
```
