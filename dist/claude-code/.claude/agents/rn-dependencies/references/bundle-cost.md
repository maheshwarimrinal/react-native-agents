# Bundle Cost

## Measure, do not estimate

Published bundle-size figures are measured against a different app, a different bundler config, and
a different set of already-present shared dependencies. They do not transfer.

The only number that means anything is the one from your bundle, before and after:

```bash
# Before
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output /tmp/before.bundle --sourcemap-output /tmp/before.map
wc -c /tmp/before.bundle

npm install <pkg>

# After
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output /tmp/after.bundle --sourcemap-output /tmp/after.map
wc -c /tmp/after.bundle
```

The delta is the answer. If you have not run this, **say the size impact is unmeasured** rather
than quoting a figure from the library's README. This repository ships `rn-size` for deterministic
per-dependency attribution from the source map — use it rather than guessing.

## Why library-reported sizes mislead

- They usually report minified, sometimes minified+gzipped, and rarely say which.
- They exclude transitive dependencies, which are frequently the larger share.
- They do not account for what your app already includes — a library that shares a dependency you
  already have costs far less than its headline number.
- Tree-shaking claims depend on your bundler configuration and your import style.

That last one matters more than it sounds: a library that tree-shakes well when you import one
named export contributes its whole surface if someone writes a namespace import.

## Native size is a separate number

Bundle size is JavaScript. A native dependency also adds to the compiled app, and that is what the
store lists and what users see before downloading. Check the APK/IPA delta separately:

```bash
cd android && ./gradlew assembleRelease
ls -la app/build/outputs/apk/release/*.apk
```

Android APK size varies by ABI split; compare like with like.

## When size actually matters

Be proportionate. A 40KB library in a 4MB bundle is not a finding. Size becomes a real concern when:

- The app targets markets where download size affects install conversion
- The library is large *and* used for a small part of its surface
- Two libraries overlap and one could be removed
- It is on the startup path, where parse and execute time matter more than bytes

Startup cost and byte count are not the same thing. A large library loaded lazily on a rarely-used
screen is cheaper than a small one parsed during launch. Route the startup-path question to
`rn-performance`, which owns it.
