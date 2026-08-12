---
trigger: manual
description: "RN Performance: Images and Media"
---

# Images and Media

Images are usually the largest memory consumer and a top cause of scroll jank. A 4000×3000 JPEG
decodes to roughly **48MB of uncompressed bitmap** regardless of how small you display it.

## Use `expo-image`

`expo-image` (works in bare RN too) beats the core `Image` on caching, decoding, transitions,
and memory behaviour. `react-native-fast-image` is the older alternative but is less actively
maintained.

```tsx
<Image
  source={{ uri: post.thumbUrl }}
  style={styles.thumb}
  contentFit="cover"
  transition={150}
  cachePolicy="memory-disk"
  placeholder={{ blurhash: post.blurhash }}
  recyclingKey={post.id}          // critical inside recycled lists (FlashList)
/>
```

## The rules

### 1. Request the size you display

The single biggest win. Serve a thumbnail-sized image for a thumbnail.

```tsx
// ✗ full-resolution original in a 72px row
<Image source={{ uri: `${cdn}/photos/${id}.jpg` }} style={{ width: 72, height: 72 }} />

// ✓ let the CDN resize; account for pixel density
const px = Math.round(72 * PixelRatio.get());
<Image source={{ uri: `${cdn}/photos/${id}.jpg?w=${px}&h=${px}&fit=cover&fm=webp` }} />
```

If your backend has no image-resizing CDN (Cloudinary, imgix, Cloudflare Images, Thumbor), that
is the finding — recommend adding one. It usually beats every other image optimisation combined.

### 2. Modern formats

WebP is universally supported on both platforms and is typically 25–35% smaller than JPEG at
equal quality. AVIF is smaller still, with narrower support — feature-detect or let the CDN
content-negotiate. Use PNG only where you need lossless or alpha, and run it through `pngquant`.

### 3. Give images explicit dimensions

Without width/height, layout shifts when the image loads and the list re-measures. Store
intrinsic dimensions with your data and reserve the space.

### 4. Cache policy on purpose

| Policy | Use |
|---|---|
| `memory-disk` | Default for remote content that changes rarely |
| `memory` | Short-lived content, or when disk pressure matters |
| `disk` | Large images shown infrequently |
| `none` | Signed URLs, one-shot content, sensitive images |

Cache keys should not include expiring query params (signed URL tokens) or you get a permanent
cache miss and unbounded disk growth. Use `source.cacheKey` to pin a stable key.

### 5. `recyclingKey` in recycled lists

FlashList recycles row views. Without `recyclingKey`, a recycled row briefly shows the previous
item's image. This looks like a rendering bug and is reported as one constantly.

### 6. Prefetch deliberately

```tsx
Image.prefetch(nextPageUrls);   // expo-image
```

Prefetch the *next* screen's hero image during idle time, not everything at once — mass prefetch
saturates the network and starves the images actually on screen.

### 7. Bundled assets

- `require('./img.png')` assets are bundled and inflate download size. Prefer remote for anything
  large or infrequently used.
- Supply @2x/@3x variants; RN picks by density. A single @3x asset scaled down wastes memory on
  every device.
- SVG (`react-native-svg`) is great for icons and terrible for complex illustrations — parsing
  and rasterising a detailed SVG per render is expensive. Rasterise complex art to WebP.

## Memory ceilings

Android's per-process heap is limited (often 192–512MB). A list of full-resolution images will
OOM before it jank.

- Cap the memory cache. `expo-image` manages this, but you can clear on memory pressure:
  ```tsx
  useEffect(() => {
    const sub = AppState.addEventListener('memoryWarning', () => Image.clearMemoryCache());
    return () => sub.remove();
  }, []);
  ```
- Android manifest `android:largeHeap="true"` is a smell, not a fix. It masks the real problem.
- Watch for images retained by closures in a long-lived store.

## Video and audio

- `expo-video` (the successor to `expo-av`'s Video) or `react-native-video`. Pause and release
  players on blur — a video decoding offscreen burns CPU and battery.
- Autoplaying multiple videos in a feed: keep at most one active player, pause others, and use
  a poster image for the rest.
- Prefer HLS/DASH adaptive streaming over a single large MP4.
- Audio sessions must be configured or you break the user's music playback — an
  under-tested, frequently-reported bug.

## Audit grep

```bash
rg 'from .react-native.' -l | xargs rg '<Image' -l     # core Image usage — candidates for expo-image
rg 'source=\{\{\s*uri' --type tsx -A 2 | rg -v 'w=|width='   # unsized remote images
rg 'require\(.\./.*\.(png|jpg|jpeg)' --type tsx        # bundled raster assets
rg 'largeHeap'
rg 'FlashList' -A 15 | rg '<Image' -A 5 | rg -v recyclingKey
find . -path ./node_modules -prune -o \( -name '*.png' -o -name '*.jpg' \) -size +200k -print
```
