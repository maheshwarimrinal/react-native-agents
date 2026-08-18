# Migrating from the Legacy Bridge

The legacy bridge was **removed in React Native 0.82**. Bridge-era modules don't work — this is a
correctness problem, not a modernisation preference.

## Identifying legacy code

```bash
rg 'RCTBridgeModule|RCT_EXPORT_METHOD|RCTViewManager|ReactContextBaseJavaModule|SimpleViewManager' \
   --type-add 'native:*.{h,m,mm,java,kt}' -t native

rg 'requireNativeComponent|NativeModules\.' --glob "**/*.{js,jsx,ts,tsx}"
```

| Legacy | Replacement |
|---|---|
| `NativeModules.Foo` | `TurboModuleRegistry.getEnforcing<Spec>('Foo')` |
| `requireNativeComponent('Foo')` | `codegenNativeComponent<Props>('Foo')` |
| `RCTBridgeModule` | Generated `NativeFooSpec` protocol |
| `ReactContextBaseJavaModule` | Generated `NativeFooSpec` base class |
| `RCT_EXPORT_METHOD` | Protocol method from the spec |
| `RCTViewManager` | `RCTViewComponentView` subclass |
| `@ReactProp` on a ViewManager | Same annotation, plus the generated delegate |
| `NativeEventEmitter` | Generated `emitOnX` helpers |

## Migration order

**1. Write the spec from the existing surface.** This is the real work — the spec forces you to
state types that the bridge let you leave vague.

```ts
// Was: NativeModules.Analytics.track('event', { foo: 'bar' })
export interface Spec extends TurboModule {
  track(event: string, properties?: Object): void;
  identify(userId: string, traits?: Object): Promise<void>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('Analytics');
```

**2. Add `codegenConfig`** and run a build so the base classes exist.

**3. Change the native class to inherit from the generated spec.** Signatures must match exactly —
the compiler will tell you where they don't, which is the point.

```kotlin
// Before
class AnalyticsModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "Analytics"
  @ReactMethod fun track(event: String, properties: ReadableMap?) { … }
}

// After
class AnalyticsModule(ctx: ReactApplicationContext) : NativeAnalyticsSpec(ctx) {
  override fun getName() = NAME
  override fun track(event: String, properties: ReadableMap?) { … }   // override, not @ReactMethod
}
```

**4. Update the package** to `BaseReactPackage` with `getReactModuleInfoProvider`, marking
`isTurboModule = true`.

**5. Rename `.m` to `.mm` on iOS.** The generated specs are C++; an Objective-C file cannot import
them. This one catches everyone.

**6. Rebuild fully.** Not a Metro reload — codegen runs at build time.

## The type problems migration surfaces

The bridge tolerated loose types; codegen does not. Expect to fix:

- **Integers.** There is no integer type across the boundary — everything is a double. Code
  relying on implicit truncation now needs explicit rounding.
- **Nullability.** The bridge silently passed `null` where the native side expected a value.
  Codegen makes this a compile error, which is an improvement but means real work.
- **Untyped `Object`.** Fine in a spec, but you lose all checking. Prefer a declared shape.
- **Unsupported types.** Unions, `Date`, `Map`/`Set`, functions as return values. These must be
  redesigned — usually to a string plus a converter on each side.
- **Callbacks.** Bridge-era success/error callback pairs should become a `Promise`.

## Fabric component migration

```objc
// Before: RCTViewManager subclass with RCT_EXPORT_VIEW_PROPERTY
// After:  RCTViewComponentView subclass with updateProps
```

The two things to get right, both of which are new obligations:

- **`updateProps` must diff.** It's called on every commit; reapplying unchanged props fights the
  user's gestures.
- **`prepareForRecycle` / `onDropViewInstance` must reset state.** Fabric recycles views. Without
  this you get state bleeding between list items.

## Interop layers

React Native provides interop shims so a legacy component can run under Fabric. They exist for
incremental migration and carry real caveats — measurement differences, missing commands, event
timing. Treat them as a temporary bridge, not a destination, and never as a reason to write new
legacy-style code.

## Verifying the migration

```bash
# 1. New Architecture actually on
rg 'newArchEnabled=true' android/gradle.properties
rg 'RCT_NEW_ARCH_ENABLED' ios/Podfile

# 2. Codegen produced the specs
find . -path '*generated*' -name '*Spec*' | head

# 3. No legacy APIs left
rg 'RCTBridgeModule|RCT_EXPORT_METHOD|requireNativeComponent'

# 4. It registers at runtime
# getEnforcing throws with a clear message if it didn't
```

## When the library isn't yours

If a dependency hasn't migrated, you cannot fix it from your app. Options, in order:

1. Check for a newer version — most active libraries migrated well before 0.82.
2. Find a maintained alternative.
3. Contribute the migration upstream.
4. `patch-package` as a stopgap, with an upstream issue linked.
5. Vendor it, accepting the maintenance.

Check this **before** debugging your own configuration. A lot of time gets lost assuming a local
setup problem when the library simply doesn't support the architecture the project is running.
