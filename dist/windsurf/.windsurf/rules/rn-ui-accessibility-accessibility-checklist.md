---
trigger: manual
description: "RN UI & A11y: Accessibility Checklist"
---

# Accessibility Checklist

## Labels, roles, states

Every interactive element needs to announce **what it is**, **what it does**, and **what state
it's in**.

```tsx
<Pressable
  onPress={toggleFavorite}
  accessibilityRole="button"
  accessibilityLabel="Add to favourites"       // what it does, not what it looks like
  accessibilityHint="Saves this item to your favourites list"   // only if non-obvious
  accessibilityState={{ selected: isFavorite, disabled: isSaving }}
>
  <HeartIcon filled={isFavorite} />
</Pressable>
```

**Labels:**
- Required on every icon-only control. Without one, VoiceOver says "button" and nothing else.
- Describe the **action or content**, not the glyph. "Add to favourites", not "heart icon".
- Don't include the role — RN appends it. "Submit button" is announced "Submit button button".
- Don't label decorative images. Hide them: `accessibilityElementsHidden` (iOS) +
  `importantForAccessibility="no-hide-descendants"` (Android), or `accessible={false}`.

**Roles** — use the real one so the screen reader gives the right affordance and gesture:
`button`, `link`, `image`, `header`, `search`, `switch`, `checkbox`, `radio`, `tab`, `tablist`,
`menuitem`, `progressbar`, `alert`, `summary`, `adjustable`.

`header` is important and almost always missing — it enables heading-based navigation, which is
how screen reader users skim a screen. Every section title should have it.

**States** — `accessibilityState={{ disabled, selected, checked, busy, expanded }}`. A visually
disabled button that doesn't report `disabled: true` is announced as tappable.

**Values** — for sliders and steppers:
```tsx
accessibilityRole="adjustable"
accessibilityValue={{ min: 0, max: 100, now: volume, text: `${volume} percent` }}
onAccessibilityAction={(e) => e.nativeEvent.actionName === 'increment' ? up() : down()}
```

## Grouping

By default every `Text` is a separate stop. A card with a title, subtitle, price, and badge makes
the user swipe four times for one item.

```tsx
<View accessible accessibilityRole="button" accessibilityLabel={`${title}, ${price}, in stock`}>
  <Text>{title}</Text>
  <Text>{price}</Text>
  <Badge />
</View>
```

`accessible` merges descendants into one element. Use it for list rows and cards. Don't use it on
a container holding multiple *interactive* children — that makes the inner controls unreachable.

## Touch targets

| Platform | Minimum |
|---|---|
| iOS (HIG) | 44 × 44 pt |
| Android (Material) | 48 × 48 dp |
| WCAG 2.2 AA (2.5.8) | 24 × 24 CSS px minimum; 44×44 for AAA |

Use 44/48 as the working rule. Where the visual must be smaller:

```tsx
<Pressable hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} />
```

`hitSlop` extends the touch area without changing layout. Also ensure adjacent targets have
spacing — two 48dp buttons flush against each other cause mis-taps.

## Contrast

WCAG AA:

| Content | Minimum |
|---|---|
| Body text | **4.5:1** |
| Large text (≥18pt, or ≥14pt bold) | **3:1** |
| UI components, icons, focus indicators, chart elements | **3:1** |

Compute it rather than guessing:

```ts
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
```

Habitual failures: placeholder text (`#999` on white is 2.85:1 — fails), disabled states, white
text on brand colours, text over photographs (needs a scrim), and light-grey secondary text.

**Never convey meaning by colour alone.** A red border on an invalid field must be accompanied by
an icon or text; ~8% of men have colour vision deficiency.

## Dynamic type

Text scales with the OS setting up to 200%+ (iOS supports much larger with accessibility sizes).

```tsx
// ✗ actively harmful — this is the exact user who needs it
<Text allowFontScaling={false}>

// ✓ scale, with a sane ceiling on tight UI like tab labels
<Text maxFontSizeMultiplier={1.5}>
```

Rules:
- Never fix a container's height in a way that clips scaled text — use `minHeight`.
- Test at maximum size before shipping. Buttons pushed off screen and truncated labels are the
  usual breakages.
- Consider switching to a vertical layout at large text sizes:
  ```tsx
  const { fontScale } = useWindowDimensions();
  <View style={{ flexDirection: fontScale > 1.3 ? 'column' : 'row' }} />
  ```

## Screen reader flow

- **Order follows the visual layout.** Absolute positioning can put a visually-first element last
  in the tree. Read the JSX in order; that's what gets announced.
- **Focus management on navigation:** when a screen opens or content replaces content, move focus:
  ```tsx
  const ref = useRef(null);
  useEffect(() => {
    const tag = findNodeHandle(ref.current);
    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
  }, []);
  ```
- **Modals must trap focus.** The content behind needs
  `importantForAccessibility="no-hide-descendants"` / `accessibilityElementsHidden` while open, or
  users swipe straight out of the dialog into invisible content. Use `accessibilityViewIsModal`
  on iOS.
- **Announce async changes** that aren't otherwise focusable:
  ```tsx
  AccessibilityInfo.announceForAccessibility('5 results found');
  ```
  Use `accessibilityLiveRegion="polite"` on Android for regions that update in place.
- **Loading states** need `accessibilityState={{ busy: true }}` or an announcement — otherwise a
  screen reader user hears silence and assumes the tap failed.

## Forms

```tsx
<Text nativeID="emailLabel">Email address</Text>
<TextInput
  accessibilityLabel="Email address"
  accessibilityLabelledBy="emailLabel"     // Android
  accessibilityHint="We'll send your receipt here"
  accessibilityInvalid={!!error}
  keyboardType="email-address"
  autoComplete="email"
  textContentType="emailAddress"
  autoCapitalize="none"
/>
{error && (
  <Text accessibilityLiveRegion="assertive" accessibilityRole="alert">{error}</Text>
)}
```

- Placeholders are **not** labels. They vanish on focus and often fail contrast.
- Errors must be adjacent to their field, announced, and specific ("Password needs 8+
  characters", not "Invalid input").
- Correct `keyboardType`, `autoComplete`, and `textContentType` — this is accessibility (less
  typing) as well as UX, and it's what enables password managers and OTP autofill.
- On submit failure, move focus to the first error.

## Motion and other settings

```tsx
const reduceMotion = useReducedMotion();                     // react-native-reanimated
const [screenReader, setScreenReader] = useState(false);
useEffect(() => {
  AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
  const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
  return () => sub.remove();
}, []);
```

Respect reduce-motion for parallax, autoplay, and large transitions — vestibular disorders make
these genuinely unpleasant, not merely a preference. Also check `isReduceTransparencyEnabled` and
`isBoldTextEnabled` on iOS.

Auto-advancing carousels need a pause control and should not auto-advance under reduce-motion.

## Testing

```tsx
// If RNTL can't find it by role and name, a screen reader user can't either
expect(screen.getByRole('button', { name: 'Add to cart' })).toBeVisible();
expect(screen.getByLabelText('Email address')).toBeOnTheScreen();
```

Manual passes that catch what static analysis can't:
- **VoiceOver / TalkBack:** navigate the whole flow with the screen curtain on. If you can't
  complete the task, neither can your users.
- **Accessibility Scanner (Android):** audits a live screen for contrast and target size.
- **Accessibility Inspector (Xcode):** audit tab flags missing labels and low contrast.
- **Max font size + smallest device** in combination — that's where layouts actually break.

## Audit grep

```bash
rg '<Pressable|<TouchableOpacity' --type tsx -A 6 | rg -v accessibilityLabel | head -40
rg 'allowFontScaling=\{false\}' --type tsx
rg '<Modal' --type tsx -A 8 | rg -v 'accessibilityViewIsModal|importantForAccessibility'
rg 'accessibilityRole' --type tsx -c        # compare against interactive-element count
rg 'placeholder=' --type tsx -B 3 | rg -v accessibilityLabel
rg 'hitSlop' --type tsx -c
rg 'accessibilityState|accessibilityLiveRegion|announceForAccessibility' --type tsx -c
```
