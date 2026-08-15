# Codegen, Packaging, and Autolinking

Most "my native module isn't found" reports are a packaging problem, not a code problem. Check
this before debugging the implementation.

## Codegen

Generated at build time from your specs. Nothing is committed.

```jsonc
{
  "codegenConfig": {
    "name": "RNMyLibSpec",          // generated namespace — everything derives from this
    "type": "all",                  // "modules" | "components" | "all"
    "jsSrcsDir": "src/specs",       // where Native*.ts / *NativeComponent.ts live
    "android": { "javaPackageName": "com.example.mylib" },
    "ios": { "componentProvider": { "MyView": "MyViewComponentView" } }
  }
}
```

Rules that trip people:

- Spec files **must** be named `Native<Name>.ts` (modules) or `<Name>NativeComponent.ts`
  (components). Codegen finds them by filename, not by content.
- `jsSrcsDir` is a directory, and codegen scans it recursively.
- The `name` determines the generated base class (`NativeMyModuleSpec`) and the iOS spec header.
  A mismatch here is the cause of "cannot find NativeXSpec".
- Nothing in `generated/` should be committed. Stale generated files after a version change
  produce confusing errors.

```bash
# Force regeneration and inspect
cd android && ./gradlew generateCodegenArtifactsFromSchema --info
find . -path '*generated*' -name '*Spec*' | head

cd ios && rm -rf build && RCT_NEW_ARCH_ENABLED=1 pod install
ls ios/build/generated/ios
```

Codegen failing with an unhelpful message is almost always an unsupported type in the spec —
a union, a `Date`, a `Map`, a function return type. Check the spec first.

## iOS packaging — podspec

```ruby
# MyLib.podspec
require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "MyLib"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = package["license"]
  s.author       = package["author"]
  s.homepage     = package["homepage"]
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"

  # Wires up the New Architecture: codegen deps, header search paths, C++ flags.
  # Without it you get a wall of "no such module" / missing header errors.
  install_modules_dependencies(s)
end
```

- Include `.mm` in `source_files` — the generated specs are C++ and an Objective-C `.m` file
  cannot import them.
- `install_modules_dependencies(s)` replaces the old manual `React-Core` dependency plus
  `HEADER_SEARCH_PATHS` gymnastics. If you see hand-rolled search paths in a modern podspec,
  that's stale.
- The podspec must sit at the **package root** for autolinking to find it.

## Android packaging — build.gradle

```gradle
// android/build.gradle
apply plugin: 'com.android.library'
apply plugin: 'org.jetbrains.kotlin.android'
apply plugin: 'com.facebook.react'      // provides codegen

android {
  namespace "com.example.mylib"
  compileSdk 35
  defaultConfig { minSdk 24 }

  // Consumers pick the Kotlin/AGP versions — don't pin them here or you
  // create the version conflicts the doctor agent spends its life diagnosing.
}

dependencies {
  implementation 'com.facebook.react:react-android'
}

react {
  jsRootDir = file("../src/")
  codegenDir = file("../node_modules/@react-native/codegen")
}
```

## Autolinking

```bash
npx react-native config | head -60     # what the CLI actually resolved
```

A module isn't linked when:

- It's in `devDependencies` — those are **not** autolinked
- The podspec isn't at the package root
- `react-native.config.js` declares a platform as `null` (a deliberate opt-out)
- A monorepo hoists it somewhere the resolver doesn't look
- The package genuinely predates autolinking

```js
// react-native.config.js — only needed for non-standard layouts
module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: { sourceDir: 'android' },
    },
  },
};
```

## Expo config plugin

If the library needs native project changes (permissions, `Info.plist` keys, gradle
modifications), ship a config plugin. Managed-workflow users **cannot** apply manual native edits
— prebuild discards them.

```js
// app.plugin.js
const { withInfoPlist, withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withMyLib(config, props = {}) {
  config = withInfoPlist(config, (c) => {
    c.modResults.NSCameraUsageDescription =
      props.cameraPermission ?? 'This app uses the camera to scan codes.';
    return c;
  });
  return config;
};
```

Shipping a native library without a config plugin means Expo users cannot adopt it without
ejecting — which, given how much of the ecosystem is on Expo, effectively halves your audience.

## Library checklist

- [ ] `codegenConfig` present, with correct `name` and `jsSrcsDir`
- [ ] Spec filenames follow the required pattern
- [ ] Podspec at package root; `install_modules_dependencies(s)`; `.mm` included
- [ ] `android/build.gradle` applies `com.facebook.react`; doesn't pin consumer versions
- [ ] Kotlin/AGP/compileSdk compatible with the RN range you claim to support
- [ ] `peerDependencies` declares `react-native` with a range, not a pin
- [ ] Config plugin for anything requiring native changes
- [ ] Both platforms implemented, or the gap documented
- [ ] Example app in the repo that actually builds
- [ ] `.gitignore` excludes generated artefacts
- [ ] README states the minimum RN version and New Architecture support

## Publishing

```jsonc
{
  "files": ["src", "lib", "android", "ios", "cpp", "*.podspec", "app.plugin.js", "!**/__tests__"],
  "peerDependencies": { "react": "*", "react-native": "*" }
}
```

Verify before publishing — a missing `android/` or podspec in the tarball is a broken package
that works perfectly from a local path:

```bash
npm pack --dry-run
```
