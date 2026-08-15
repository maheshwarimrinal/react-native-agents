---
trigger: manual
description: "RN Native Modules: Threading and JSI"
---

# Threading and JSI

Where the real bugs are. A native module that is correct on a fast device and wrong on a slow one
is almost always a threading problem.

## The threads

| Thread | Runs | Rule |
|---|---|---|
| **JS thread** | Your JavaScript, JSI calls, synchronous TurboModule methods | Blocking it freezes the app |
| **UI / main thread** | All view manipulation | All UIKit/Android View work must be here |
| **Background** | Your own queues/executors | Where actual work belongs |
| **UI (worklet) thread** | Reanimated worklets, Fabric layout | Not the JS thread |

## Synchronous methods block JS

A synchronous TurboModule method runs **on the JS thread**. While it runs, nothing else in your
app's JavaScript happens — no rendering, no touch handling, no timers.

```kotlin
// ✓ acceptable: reading a constant
override fun getDeviceId(): String = Build.ID

// ✗ freezes the UI for the duration
override fun readFile(path: String): String = File(path).readText()
```

Rule of thumb: synchronous is fine for reading something already in memory. Anything touching
disk, network, or a database gets a `Promise`.

## Dispatch UI work to the main thread

```kotlin
// Android — module methods do NOT run on the main thread
override fun showToast(message: String) {
  UiThreadUtil.runOnUiThread {
    Toast.makeText(reactApplicationContext, message, Toast.LENGTH_SHORT).show()
  }
}
```

```objc
// iOS — this method makes the whole module run on the main queue
+ (BOOL)requiresMainQueueSetup { return YES; }

// Or dispatch per call, which is usually better than forcing every method onto main
- (void)present:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{ /* UIKit work */ });
}
```

`requiresMainQueueSetup` returning `YES` means the module is **initialised** on the main thread —
useful if `init` touches UIKit, but it also means initialisation blocks app startup. Return `NO`
unless you need it, and don't do heavy work in `init` either way.

## Don't block, and don't spawn unboundedly

```kotlin
// ✗ a new thread per call — a fast caller exhausts the device
override fun process(data: String, promise: Promise) {
  Thread { promise.resolve(heavy(data)) }.start()
}

// ✓ a bounded executor owned by the module, shut down on invalidate
private val executor = Executors.newFixedThreadPool(2)

override fun process(data: String, promise: Promise) {
  executor.execute {
    try { promise.resolve(heavy(data)) }
    catch (e: Exception) { promise.reject("E_PROCESS_FAILED", e.message, e) }
  }
}

override fun invalidate() {
  executor.shutdownNow()
  super.invalidate()
}
```

A promise that is neither resolved nor rejected leaves the JS `await` hanging forever, with no
error and nothing in the logs. Every path through the method must terminate the promise — this is
worth checking explicitly in review, because the failure is completely silent.

## JSI

JSI is the direct C++ interface between JS and native. It's what makes synchronous calls and
zero-copy data sharing possible.

```cpp
// Installing a function directly on the JS global
void install(jsi::Runtime &rt) {
  auto multiply = jsi::Function::createFromHostFunction(
    rt,
    jsi::PropNameID::forAscii(rt, "multiply"),
    2,
    [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
      if (count < 2) throw jsi::JSError(rt, "multiply expects 2 arguments");
      return jsi::Value(args[0].asNumber() * args[1].asNumber());
    });
  rt.global().setProperty(rt, "multiply", std::move(multiply));
}
```

**The rules that matter:**

- **`jsi::Runtime` is not thread-safe.** Touching it from any thread other than the one that owns
  it is undefined behaviour — usually a crash, sometimes silent corruption. To call back into JS
  from a background thread, go through `CallInvoker`:

  ```cpp
  jsInvoker->invokeAsync([callback = std::move(callback)](jsi::Runtime &rt) {
    callback->call(rt, jsi::String::createFromUtf8(rt, result));
  });
  ```

- **JSI values don't outlive the runtime.** Holding a `jsi::Value` past a reload crashes. Use
  `jsi::Function` captured in a `shared_ptr` and always route through the invoker.

- **Throw `jsi::JSError`,** not a C++ exception — it becomes a catchable JS error rather than
  terminating the process.

## Zero-copy for large data

Serialising a large buffer to base64 and parsing it in JS is slow and doubles memory. Share the
memory instead:

```cpp
class ImageBuffer : public jsi::MutableBuffer {
 public:
  explicit ImageBuffer(size_t size) : data_(size) {}
  size_t size() const override { return data_.size(); }
  uint8_t *data() override { return data_.data(); }
 private:
  std::vector<uint8_t> data_;
};

auto buffer = std::make_shared<ImageBuffer>(bytes);
auto arrayBuffer = jsi::ArrayBuffer(rt, buffer);   // JS sees it without a copy
```

This is the right answer whenever you'd otherwise move megabytes across the boundary — image
pixels, audio frames, file contents.

## Memory

**Objective-C retain cycles:**

```objc
// ✗ block retains self, self retains the block
[self.manager setHandler:^{ [self doThing]; }];

// ✓
__weak __typeof(self) weakSelf = self;
[self.manager setHandler:^{ [weakSelf doThing]; }];
```

**Kotlin context leaks:** holding `ReactApplicationContext` in a companion object or a static
field keeps it alive across reloads. Hold it on the instance and release in `invalidate()`.

**Reload leaks:** in development the JS runtime is torn down and rebuilt on every reload. Any
listener, timer, or observer not removed in `invalidate`/`deinit` accumulates once per reload.
The symptom is a dev session that gets slower over an afternoon and a callback firing several
times for one event.

## Reanimated worklets

Worklets run on the UI thread with a separate runtime.

```ts
const handler = useAnimatedScrollHandler((e) => {
  scrollY.value = e.contentOffset.y;   // UI thread — free

  // Each runOnJS is a thread hop. In a per-frame callback that's 60-120
  // hops per second, which defeats the point of being on the UI thread.
  if (e.contentOffset.y > 100) runOnJS(setShowHeader)(true);
});
```

Call `runOnJS` at gesture boundaries, or guard it so it fires on a state change rather than every
frame.

## Review checklist

- [ ] Synchronous methods are genuinely cheap
- [ ] No blocking work on the JS thread
- [ ] UI work dispatched to the main thread
- [ ] Bounded executor/queue, not a thread per call
- [ ] **Every code path resolves or rejects the promise**
- [ ] `invalidate()` / `deinit` removes every listener, timer, and observer
- [ ] No retain cycles in blocks; no static context references
- [ ] `jsi::Runtime` touched only from its own thread; `CallInvoker` used otherwise
- [ ] Large payloads shared, not serialised
- [ ] Errors become JS rejections with a branchable code
