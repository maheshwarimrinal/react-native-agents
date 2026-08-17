# New Architecture Migration

The New Architecture has been the default since **0.76**, and the legacy bridge was removed
entirely in **0.82**. On current versions this is not a decision — it is the only architecture.
What remains is finding the parts of your app that are still behaving as though it isn't.

## The four pieces

| Piece | Replaces | What breaks if you ignore it |
|---|---|---|
| **Fabric** | The old renderer | View flattening changes the native hierarchy; refs and native measurements |
| **TurboModules** | `RCTBridgeModule` | Old-style modules run via interop or not at all |
| **Codegen** | Hand-written bindings | Native bindings generated from TS specs; the spec is now the contract |
| **JSI** | The async bridge | Synchronous native calls become possible; some old assumptions stop holding |

## The interop layer is the thing to look for

Libraries that have not migrated do not necessarily break. They run through an interop layer that
makes old-style modules work with the new system — which is exactly why this is dangerous. It is
**silent**, so nobody investigates.

What is forfeited while a library runs through interop:

- Concurrent React features
- Synchronous layout
- Occasional behavioural differences that are hard to attribute to the library at all

A library on interop is not a bug. It is a **known cost you should be able to name**. The failure
is not knowing which of your dependencies are in that state.

## View flattening will null your refs

Fabric removes `View` wrappers that have no rendering effect. This is a performance win and it has
a consequence people hit and cannot explain:

```tsx
// The outer View contributes nothing, so Fabric may flatten it away.
// containerRef.current is then never assigned — silently, with no error.
const containerRef = useRef<View>(null);

return (
  <View ref={containerRef}>
    <Text>...</Text>
  </View>
);
```

The symptom is a ref that is `null` when you measure it, on a component that worked before the
upgrade. Nothing throws. `measure()` simply never fires, or fires with zeroes.

**Fix**: give the view a reason to exist in the native hierarchy — `collapsable={false}` is the
explicit escape hatch — or restructure so the ref points at a view that renders something.

Audit for it:

```bash
rg -n "useRef<View>|createRef<View>" --glob "**/*.{tsx,jsx}" -A6 | rg -B2 -A4 "measure|measureInWindow|measureLayout"
```

## Custom native modules need rewriting, not adapting

If you wrote modules against `RCTBridgeModule` / `ReactContextBaseJavaModule`, the migration is a
rewrite. The new flow inverts the direction of authorship:

1. Write a **TypeScript spec** (`NativeFoo.ts` / `FooNativeComponent.ts`).
2. Codegen generates the native interfaces from it.
3. Your native code implements the generated interface.

The TS spec is now the source of truth. A mismatch between spec and implementation is a build
error rather than a runtime surprise, which is the improvement — but it means the spec has to be
written first, and types that were loose before now have to be exact.

Hand this to `rn-native-modules` for the implementation detail; your job is identifying which
modules need it and how much work that is.

```bash
rg -ln "RCTBridgeModule|ReactContextBaseJavaModule|RCT_EXPORT_METHOD|@ReactMethod" ios/ android/ 2>/dev/null
```

## Auditing where you actually stand

```bash
# Is it on?
rg -n "newArchEnabled" android/gradle.properties app.json app.config.* 2>/dev/null
rg -n "RCT_NEW_ARCH_ENABLED" ios/ 2>/dev/null

# Old-style modules anywhere in your own code
rg -ln "RCTBridgeModule|ReactContextBaseJavaModule" ios/ android/ 2>/dev/null

# Codegen specs that exist
rg -ln "TurboModuleRegistry|codegenNativeComponent" --glob "**/*.ts"
```

For third-party libraries, the React Native directory publishes New Architecture support per
package. As of early 2026 the great majority of widely-used libraries are compatible — including
essentially everything above 200K weekly downloads — so a blocking library is now the exception
rather than the rule. Verify rather than assume: the specific library you depend on may be the
exception, and that is exactly the one that matters to you.
