---
trigger: manual
description: "RN Performance: Memory and Leaks"
---

# Memory and Leaks

Symptoms: the app gets slower the longer it runs, Android kills it in the background, crash
reports show OOM, or scrolling degrades after visiting a screen many times.

## Diagnose

- **React Native DevTools → Memory.** Take a heap snapshot, perform the suspect cycle 5–10 times
  (navigate in and out of a screen), force GC, take a second snapshot, and diff. Objects with a
  growing retained count are your leak. Follow the retainer chain to the holder.
- **Xcode Instruments → Allocations / Leaks** for native-side growth.
- **Android Studio Profiler → Memory**, or `adb shell dumpsys meminfo <pkg>` sampled over time.
- A steadily rising floor after GC is a leak. Sawtooth that returns to baseline is normal.

## The leak sources, in order of frequency

### 1. Uncleaned subscriptions

```tsx
useEffect(() => {
  const sub = eventEmitter.addListener('update', onUpdate);
  return () => sub.remove();            // ← the part people forget
}, [onUpdate]);
```

Every one of these needs a teardown: `AppState.addEventListener`, `Dimensions.addEventListener`,
`Keyboard.addListener`, `Linking.addEventListener`, `NetInfo.addEventListener`,
`BackHandler.addEventListener`, navigation listeners, WebSocket handlers, Firebase
`onSnapshot`/`onValue`, notification listeners, and any `NativeEventEmitter`.

Note the modern API returns a subscription with `.remove()`; the old `removeEventListener` form
is removed in current RN. Code still calling `removeEventListener` is both broken and leaking.

### 2. Timers

```tsx
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, []);
```

An uncleaned `setInterval` keeps its closure — and everything the closure captures — alive
forever, and keeps burning CPU while the screen is unmounted.

### 3. Async work resolving after unmount

```tsx
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal })
    .then((r) => r.json())
    .then(setData)
    .catch((e) => { if (e.name !== 'AbortError') setError(e); });
  return () => controller.abort();
}, [url]);
```

Better: use TanStack Query, which handles cancellation, dedupe, and cache eviction for you.

### 4. Retained navigation state

- Deep stacks keep every screen mounted. `react-navigation` doesn't unmount on push by design.
  Use `navigation.replace` instead of `push` for flows that shouldn't be re-enterable, and
  `popToTop` / `reset` to collapse stacks after completion.
- `freezeOnBlur` stops background screens re-rendering but does **not** free their memory.
- A screen that subscribes to a live feed and never unmounts is a permanent cost.

### 5. Unbounded caches

Any `Map`, object, or array that only grows: image caches, memoisation caches, offline queues,
log buffers, chat message stores. Give every cache a bound and an eviction policy (LRU, TTL, or
max-size). `WeakMap` where keys are objects you don't own.

### 6. Closures capturing large objects

```tsx
// ✗ the callback captures the whole 5MB response for the lifetime of the subscription
const [response, setResponse] = useState<HugeResponse>();
useEffect(() => emitter.addListener('x', () => doThing(response)), [response]);

// ✓ capture only what's needed
const id = response?.id;
useEffect(() => emitter.addListener('x', () => doThing(id)), [id]);
```

### 7. Native-side retention

Circular strong references in native modules, un-invalidated `NSTimer`s, unregistered Android
`BroadcastReceiver`s, retained `Context` in a static field. These show up in Instruments/Android
Studio but not in the JS heap snapshot — if JS looks clean and memory still grows, look native.

## Hermes specifics

- Hermes uses a generational GC. Short-lived allocations are cheap; long-lived retention is what
  hurts.
- Large string and array allocations can fragment the heap. Streaming or chunking a huge JSON
  payload beats parsing it whole.
- `global.gc()` is not available in release. Don't write code that depends on manual GC.

## Preventive patterns

```tsx
// One place to hang all teardowns for a screen
function useCleanup() {
  const cleanups = useRef<Array<() => void>>([]);
  useEffect(() => () => { cleanups.current.forEach((fn) => fn()); }, []);
  return useCallback((fn: () => void) => { cleanups.current.push(fn); }, []);
}
```

Enable the ESLint rule `react-hooks/exhaustive-deps` — a surprising share of leaks start as a
missing dependency that made someone drop the cleanup.

## Audit grep

```bash
rg 'addListener|addEventListener' --type tsx -A 6 | rg -v 'remove\(\)|return \(\)'
rg 'setInterval|setTimeout' --type tsx -A 6 | rg -v 'clear(Interval|Timeout)'
rg 'removeEventListener'                      # removed API — broken cleanup
rg 'new Map\(\)|new Set\(\)' --type ts        # check each for a size bound
rg 'onSnapshot|onValue|subscribe\(' --type ts -A 5
```
