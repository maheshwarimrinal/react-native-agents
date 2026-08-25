# Native Builds from a Nested App

The JavaScript side of a monorepo is mostly Metro configuration. The native side is a set of
assumptions about where things are, and a nested app violates several.

## Autolinking scans from the app directory

React Native discovers native dependencies by reading the app's `package.json` and walking
`node_modules` from there. Two consequences:

- A native dependency declared **only at the workspace root** may not be linked. The JS import
  resolves, the native module is `undefined` at runtime, and there is no build error — a genuinely
  confusing failure because everything looks correct.
- Hoisting means the package's files may live at the root while the declaration is in the app. This
  usually works; when it does not, the error names Gradle or CocoaPods rather than autolinking.

```bash
# What does React Native think is linked?
cd apps/mobile && npx react-native config | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);console.log(Object.keys(j.dependencies||{}).join('\n'));
});"
```

If a native package you depend on is absent from that list, you have found the problem.

## Gradle and CocoaPods paths

Both build systems reference React Native's own files by relative path, and templates assume
`node_modules` is a sibling of `android/` and `ios/`. In a workspace with hoisting it may be two
levels up.

```gradle
// android/settings.gradle — resolve rather than assume
def reactNativeDir = new File(["node", "--print", "require.resolve('react-native/package.json')"]
  .execute(null, rootDir).text.trim()).getParentFile().getAbsolutePath()
```

```ruby
# ios/Podfile
require Pod::Executable.execute_command('node', ['-p',
  'require.resolve("react-native/scripts/react_native_pods.rb", {paths: [process.argv[1]]})',
  __dir__]).strip
```

Using `require.resolve` rather than a hardcoded `../node_modules` is the durable fix: it works
whether the package is hoisted or local, and it survives a package-manager change.

## Xcode and Gradle caches

Both cache aggressively and neither invalidates on a workspace layout change. After moving packages
or changing hoisting, a stale cache produces failures that describe the old layout.

```bash
cd ios && rm -rf Pods Podfile.lock && bundle exec pod install
cd android && ./gradlew clean
```

Reach for this **after** you have a hypothesis, not before — it is slow and it destroys the evidence
of what was actually being resolved.

## CI

Two things reliably differ from local:

- **Cold install.** No leftover hoisted packages. See `package-manager.md`.
- **Working directory.** Native build steps often assume the app directory; a CI job running from
  the repo root silently builds nothing or builds the wrong thing.

```yaml
- run: pnpm install --frozen-lockfile     # from the root
- run: pnpm --filter mobile build:ios     # scoped to the app
```

## Turborepo and Nx caching

Task caching is the main reason to adopt these, and it goes wrong in one specific way: a task whose
`inputs` do not include everything it reads will return a cached result after a change that should
have invalidated it. For native builds that produces an artefact built from stale JavaScript, which
is very hard to diagnose because everything reports success.

If you cache native build steps, be conservative about inputs, and be suspicious of a green build
that produced an app behaving like an older commit.
