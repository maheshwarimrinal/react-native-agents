---
trigger: manual
description: "RN Native Modules: Fabric Components"
---

# Fabric Components

A Fabric component exposes a native view to React. Layout runs in a C++ shadow tree, so measure
and layout are synchronous — the round trips that made the old renderer janky are gone.

## 1. The spec

Named `<Name>NativeComponent.ts`.

```ts
// src/specs/MapViewNativeComponent.ts
import type { ViewProps } from 'react-native';
import type { HostComponent } from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';
import type { Double, Int32, WithDefault, DirectEventHandler } from 'react-native/Libraries/Types/CodegenTypes';

type RegionChangeEvent = Readonly<{ latitude: Double; longitude: Double; zoom: Double }>;

export interface NativeProps extends ViewProps {
  latitude: Double;
  longitude: Double;
  // WithDefault makes the default explicit on both sides.
  zoom?: WithDefault<Double, 10>;
  mapType?: WithDefault<'standard' | 'satellite' | 'hybrid', 'standard'>;
  showsUserLocation?: WithDefault<boolean, false>;
  maxMarkers?: WithDefault<Int32, 100>;

  onRegionChange?: DirectEventHandler<RegionChangeEvent>;
}

// Imperative methods on the view instance.
interface NativeCommands {
  animateToRegion: (
    viewRef: React.ElementRef<HostComponent<NativeProps>>,
    latitude: Double,
    longitude: Double,
    durationMs: Int32,
  ) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['animateToRegion'],
});

export default codegenNativeComponent<NativeProps>('MapView') as HostComponent<NativeProps>;
```

`Int32` vs `Double` matters here in a way it doesn't for TurboModules — the generated C++ props
struct uses the exact type, and a mismatch is a compile error rather than a silent coercion.

## 2. Android

```kotlin
// ViewManager
@ReactModule(name = MapViewManager.NAME)
class MapViewManager : SimpleViewManager<MapView>(), MapViewManagerInterface<MapView> {

  private val delegate = MapViewManagerDelegate(this)   // generated
  override fun getDelegate() = delegate
  override fun getName() = NAME

  override fun createViewInstance(context: ThemedReactContext) = MapView(context)

  @ReactProp(name = "latitude")
  override fun setLatitude(view: MapView, value: Double) { view.latitude = value }

  @ReactProp(name = "zoom", defaultDouble = 10.0)
  override fun setZoom(view: MapView, value: Double) { view.zoom = value }

  override fun animateToRegion(view: MapView, lat: Double, lng: Double, durationMs: Int) {
    view.animateTo(lat, lng, durationMs)
  }

  // Views are recycled — reset any state that would leak between items.
  override fun onDropViewInstance(view: MapView) {
    view.cleanup()
    super.onDropViewInstance(view)
  }

  companion object { const val NAME = "MapView" }
}
```

Emitting an event:

```kotlin
val surfaceId = UIManagerHelper.getSurfaceId(context)
UIManagerHelper.getEventDispatcherForReactTag(context, id)?.dispatchEvent(
  RegionChangeEvent(surfaceId, id, latitude, longitude, zoom),
)
```

## 3. iOS

```objc
// ios/MapViewComponentView.mm
#import <react/renderer/components/RNMapViewSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNMapViewSpec/Props.h>
#import <react/renderer/components/RNMapViewSpec/EventEmitters.h>

using namespace facebook::react;

@implementation MapViewComponentView {
  MKMapView *_mapView;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<MapViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const MapViewProps>();
    _props = defaultProps;
    _mapView = [MKMapView new];
    self.contentView = _mapView;
  }
  return self;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  const auto &newProps = *std::static_pointer_cast<const MapViewProps>(props);
  const auto &prev = *std::static_pointer_cast<const MapViewProps>(_props ?: props);

  // Compare before applying — updateProps is called on every commit, and
  // reapplying an unchanged region will fight the user's gestures.
  if (newProps.latitude != prev.latitude || newProps.longitude != prev.longitude) {
    [_mapView setCenterCoordinate:CLLocationCoordinate2DMake(newProps.latitude, newProps.longitude)
                         animated:NO];
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args {
  RCTMapViewHandleCommand(self, commandName, args);
}

- (void)prepareForRecycle {
  // Fabric recycles component views. Reset everything, or state bleeds
  // between list items — a genuinely confusing class of bug.
  [_mapView removeAnnotations:_mapView.annotations];
  _mapView.delegate = nil;
  [super prepareForRecycle];
}

@end

Class<RCTComponentViewProtocol> MapViewCls(void) { return MapViewComponentView.class; }
```

Emitting an event:

```objc
if (_eventEmitter) {
  std::static_pointer_cast<const MapViewEventEmitter>(_eventEmitter)
    ->onRegionChange({ .latitude = lat, .longitude = lng, .zoom = zoom });
}
```

Always null-check `_eventEmitter` — it is nil before mount and after unmount, and emitting then
crashes.

## The two mistakes that cause most Fabric bugs

**1. Not resetting on recycle.** `prepareForRecycle` (iOS) and `onDropViewInstance` (Android) are
mandatory for any view holding state, a delegate, a subscription, or a player. Skipping them
produces "the wrong image/video/marker appears in this row", which gets misdiagnosed as a list
bug for a long time.

**2. Applying props unconditionally in `updateProps`.** It's called on every commit. Reapplying
an unchanged camera position, scroll offset, or animation resets the user's interaction mid-gesture.
Always diff `newProps` against `oldProps` first.

## Using it

```tsx
import MapView, { Commands } from './specs/MapViewNativeComponent';

const ref = useRef<React.ElementRef<typeof MapView>>(null);

<MapView
  ref={ref}
  style={styles.map}
  latitude={51.5}
  longitude={-0.12}
  onRegionChange={(e) => setRegion(e.nativeEvent)}
/>;

Commands.animateToRegion(ref.current!, 48.85, 2.35, 300);
```

## Wrap it before shipping it

Never export the codegen component directly from a library. Wrap it so you can add sensible
defaults, accessibility, and a stable public API that survives internal changes:

```tsx
export function Map({ region, onRegionChange, ...props }: MapProps) {
  return (
    <MapViewNative
      latitude={region.latitude}
      longitude={region.longitude}
      accessibilityRole="image"
      accessibilityLabel="Map"    // otherwise it's invisible to screen readers
      onRegionChange={(e) => onRegionChange?.(e.nativeEvent)}
      {...props}
    />
  );
}
```

A native view is opaque to accessibility unless you give it a role and a label, and it's easy to
ship a screen where the main content is unreachable.
