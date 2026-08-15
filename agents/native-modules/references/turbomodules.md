# TurboModules

A TurboModule is a native module exposed through JSI: lazily instantiated, directly referenced
from JS (no serialisation queue), and type-checked at build time from a TypeScript spec.

## 1. The spec — the source of truth

File must be named `Native<Name>.ts` and live where `codegenConfig` points.

```ts
// src/specs/NativeDeviceInfo.ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  // Synchronous — only for cheap, non-blocking reads.
  getDeviceId(): string;
  isTablet(): boolean;

  // Asynchronous — anything doing I/O.
  getStorageInfo(): Promise<{ totalBytes: number; freeBytes: number }>;

  // Events
  readonly onBatteryChange: EventEmitter<{ level: number; charging: boolean }>;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DeviceInfo');
```

`getEnforcing` throws a clear error if the module is missing. `get` returns null and defers the
failure to a confusing place — prefer `getEnforcing` unless the module is genuinely optional.

### Types that cross the boundary

| TypeScript | Notes |
|---|---|
| `string` | fine |
| `number` | **always a double.** There is no integer type. Round explicitly on the native side. |
| `boolean` | fine |
| `Object` / an interface | plain data only |
| `Array<T>` | fine |
| `Promise<T>` | preferred for anything that can fail or block |
| `void` | fire-and-forget |
| `?T` / `T \| null` | nullability must match the native signature exactly |

Not supported: functions as return values, classes, `Date`, `Map`/`Set`, union types other than
nullable. Codegen fails on these — usually with an error that doesn't name the offending line, so
check the spec first when codegen breaks.

## 2. `codegenConfig`

```jsonc
// package.json
{
  "codegenConfig": {
    "name": "RNDeviceInfoSpec",
    "type": "modules",              // "components" for Fabric, "all" for both
    "jsSrcsDir": "src/specs",
    "android": {
      "javaPackageName": "com.example.deviceinfo"
    }
  }
}
```

The generated names derive from this. Get `name` wrong and the native class you're told to
inherit from won't exist.

## 3. Android

```kotlin
// android/src/main/java/com/example/deviceinfo/DeviceInfoModule.kt
package com.example.deviceinfo

import android.os.Build
import android.os.StatFs
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = DeviceInfoModule.NAME)
class DeviceInfoModule(reactContext: ReactApplicationContext) :
  NativeDeviceInfoSpec(reactContext) {   // generated base class

  override fun getName() = NAME

  // Synchronous: must be cheap. This blocks the JS thread while it runs.
  override fun getDeviceId(): String = Build.ID

  override fun isTablet(): Boolean =
    reactApplicationContext.resources.configuration.smallestScreenWidthDp >= 600

  // Asynchronous: never block. Do the work off the caller's thread.
  override fun getStorageInfo(promise: Promise) {
    executor.execute {
      try {
        val stat = StatFs(reactApplicationContext.filesDir.path)
        val map = Arguments.createMap().apply {
          // JS numbers are doubles — be explicit rather than relying on coercion.
          putDouble("totalBytes", stat.totalBytes.toDouble())
          putDouble("freeBytes", stat.availableBytes.toDouble())
        }
        promise.resolve(map)
      } catch (e: Exception) {
        // A code the JS side can branch on, not just a message.
        promise.reject("E_STORAGE_UNAVAILABLE", e.message, e)
      }
    }
  }

  override fun invalidate() {
    // Called on reload and teardown. Without this, every dev reload leaks.
    executor.shutdownNow()
    batteryReceiver?.let { reactApplicationContext.unregisterReceiver(it) }
    batteryReceiver = null
    super.invalidate()
  }

  private val executor = Executors.newSingleThreadExecutor()
  private var batteryReceiver: BroadcastReceiver? = null

  companion object { const val NAME = "DeviceInfo" }
}
```

```kotlin
// The package, registered via autolinking
class DeviceInfoPackage : BaseReactPackage() {
  override fun getModule(name: String, ctx: ReactApplicationContext): NativeModule? =
    if (name == DeviceInfoModule.NAME) DeviceInfoModule(ctx) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      DeviceInfoModule.NAME to ReactModuleInfo(
        DeviceInfoModule.NAME, DeviceInfoModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,        // true defeats lazy loading — justify it
        isCxxModule = false,
        isTurboModule = true,
      ),
    )
  }
}
```

## 4. iOS

```objc
// ios/DeviceInfo.h
#import <RNDeviceInfoSpec/RNDeviceInfoSpec.h>

@interface DeviceInfo : NSObject <NativeDeviceInfoSpec>
@end
```

```objc
// ios/DeviceInfo.mm   — .mm, not .m: the generated spec is C++
#import "DeviceInfo.h"

@implementation DeviceInfo {
  dispatch_queue_t _queue;
}

RCT_EXPORT_MODULE()

- (instancetype)init {
  if (self = [super init]) {
    _queue = dispatch_queue_create("com.example.deviceinfo", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

// Synchronous — runs on the JS thread. Keep it trivial.
- (NSString *)getDeviceId {
  return [[[UIDevice currentDevice] identifierForVendor] UUIDString];
}

- (NSNumber *)isTablet {
  return @([UIDevice currentDevice].userInterfaceIdiom == UIUserInterfaceIdiomPad);
}

- (void)getStorageInfo:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {
  // __weak breaks the retain cycle: block → self → queue → block
  __weak __typeof(self) weakSelf = self;
  dispatch_async(_queue, ^{
    __strong __typeof(weakSelf) self = weakSelf;
    if (!self) return;

    NSError *error = nil;
    NSDictionary *attrs =
      [NSFileManager.defaultManager attributesOfFileSystemForPath:NSHomeDirectory() error:&error];
    if (error) {
      reject(@"E_STORAGE_UNAVAILABLE", error.localizedDescription, error);
      return;
    }
    resolve(@{
      @"totalBytes": attrs[NSFileSystemSize],
      @"freeBytes": attrs[NSFileSystemFreeSize],
    });
  });
}

// Required so the runtime can construct the C++ turbo module.
- (std::shared_ptr<facebook::react::TurboModule>)
    getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDeviceInfoSpecJSI>(params);
}

- (void)invalidate {
  // Teardown on reload — mirror of Android's invalidate().
  [NSNotificationCenter.defaultCenter removeObserver:self];
}

@end
```

### Swift

Swift can't conform to the generated C++ protocol directly. The standard shape is a Swift
implementation plus a thin Objective-C++ bridge:

```swift
// ios/DeviceInfoImpl.swift
@objc public class DeviceInfoImpl: NSObject {
  @objc public func deviceId() -> String {
    UIDevice.current.identifierForVendor?.uuidString ?? ""
  }
}
```

```objc
// ios/DeviceInfo.mm
#import "YourModule-Swift.h"     // generated umbrella header
- (NSString *)getDeviceId { return [[DeviceInfoImpl new] deviceId]; }
```

Requires a bridging header and `SWIFT_OBJC_INTERFACE_HEADER_NAME` set correctly — a frequent
source of "no such module" build failures.

## Events

```kotlin
// Android — emit through the generated helper
emitOnBatteryChange(Arguments.createMap().apply {
  putDouble("level", level)
  putBoolean("charging", charging)
})
```

```objc
// iOS
[self emitOnBatteryChange:@{ @"level": @(level), @"charging": @(charging) }];
```

Only register the underlying OS listener when JS actually subscribes, and tear it down in
`invalidate`/`deinit`. A permanently-registered battery or location listener is a real battery
drain that users notice and blame the app for.

## Verifying it loaded

```bash
find . -path '*generated*' -name '*DeviceInfoSpec*' | head
cd android && ./gradlew generateCodegenArtifactsFromSchema --info
cd ios && RCT_NEW_ARCH_ENABLED=1 pod install
npx react-native config | grep -A5 deviceinfo
```

```ts
// In the app
import DeviceInfo from './specs/NativeDeviceInfo';
console.log(DeviceInfo.getDeviceId());
```

`getEnforcing` throwing means the module didn't register — check autolinking and codegen before
suspecting your implementation. Also remember: **adding a native module requires a full rebuild.**
Reloading JS is not enough, and this trips people constantly.
