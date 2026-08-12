---
trigger: manual
description: "RN UI & A11y: Internationalisation and RTL"
---

# Internationalisation and RTL

Even if you ship English-only today, the cheap decisions made now determine whether adding a
language later is a week or a quarter.

## No hardcoded strings

```tsx
// ✗
<Text>Add to cart</Text>

// ✓
<Text>{t('cart.add')}</Text>
```

Use `i18next` + `react-i18next`, or `@lingui/react`. Key by meaning (`cart.add`), not by English
text — otherwise every copy change breaks every translation.

## Plurals and interpolation

```ts
// ✗ breaks in Polish (3 forms), Arabic (6), Japanese (0)
`${count} item${count === 1 ? '' : 's'}`

// ✓ ICU plurals — the library picks the right form per locale
t('cart.items', { count })
// en: { "cart.items_one": "{{count}} item", "cart.items_other": "{{count}} items" }
```

Never build a sentence from concatenated fragments — word order differs by language. Pass
variables into a single interpolated string so translators can reorder them.

```ts
// ✗ "Showing" + n + "of" + total + "results"
// ✓ t('list.showing', { n, total })   →  "Showing {{n}} of {{total}} results"
```

## Formatting

Use `Intl` — it's built into Hermes now, so no polyfill is needed.

```ts
new Intl.NumberFormat(locale, { style: 'currency', currency: 'JPY' }).format(1234);
new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day');   // "yesterday"
new Intl.ListFormat(locale, { type: 'conjunction' }).format(['a', 'b', 'c']);
```

Construct formatters once at module scope, not per render — construction is the expensive part.

Never hand-format dates, currency, or numbers. Decimal separators, currency symbol position,
digit grouping, and calendars all vary.

Get the device locale from `expo-localization` (`getLocales()`), and honour the user's region
separately from their language — someone can want English text with metric units.

## Text expansion

German and Finnish run 30–40% longer than English; Arabic and Japanese are often shorter but
taller. Consequences:

- Never fix a container's width around English text.
- `numberOfLines` + `ellipsizeMode` on anything that could overflow — but truncating a button
  label is a failure, not a solution. Let buttons grow or wrap.
- Test with a pseudo-locale that pads strings (`[!!! Ǎdd tö çȧrt !!!]`) to catch overflow before
  translation exists.

## RTL (Arabic, Hebrew, Farsi, Urdu)

RTL is a full mirror of the layout, not just text alignment.

### Use logical properties

```tsx
// ✗ physically left/right — wrong in RTL
{ marginLeft: 16, paddingRight: 8, left: 0, textAlign: 'left' }

// ✓ logical — flips automatically
{ marginStart: 16, paddingEnd: 8, start: 0, textAlign: 'left' }
```

RN maps `start`/`end` to left/right based on direction. Note `textAlign: 'left'` already means
"start" in RN, but `textAlign: 'right'` for numbers should usually stay explicit.

`flexDirection: 'row'` flips automatically under RTL. If a row must *not* flip (a media player's
timeline, for instance), use `row-reverse` conditionally or `direction: 'ltr'` on that subtree.

### Enable it

```ts
import { I18nManager } from 'react-native';

I18nManager.allowRTL(true);
I18nManager.forceRTL(isRTLLocale);
// ⚠️ a direction change requires an app RELOAD to take effect
```

The reload requirement is a real UX problem for in-app language switching — you have to prompt
the user to restart. Plan for it (`expo-updates`' `reloadAsync`, or a clear "restart to apply"
message) rather than discovering it late.

### What needs manual attention

- **Icons that imply direction:** back arrows, next/previous, send, undo/redo, progress. Mirror
  them: `transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }]`.
- **Icons that must not mirror:** clocks, media play buttons, checkmarks, logos, most
  representational images.
- **Animations and gestures:** a drawer that slides from the left must slide from the right;
  swipe directions invert.
- **Numbers, phone numbers, code, and URLs** stay LTR even inside RTL text. Wrap with directional
  isolates (`⁨`…`⁩`) if you see mangled ordering.
- **Charts and progress bars** need explicit direction handling.
- **`ScrollView` initial offset** and `contentOffset` behave differently.

Test by forcing RTL in a debug build and walking every screen. Bugs here are always visual and
always obvious once you look.

## Fonts and scripts

- Bundled fonts frequently lack Arabic, Hebrew, Devanagari, Thai, or CJK glyphs — text renders as
  tofu boxes. Either include the glyph coverage or fall back to the system font for those locales.
- Line height needs to be larger for scripts with tall ascenders/descenders (Thai, Devanagari) —
  a `lineHeight` tuned for Latin will clip.
- Don't `toUpperCase()` for styling: it's wrong in Turkish (dotted/dotless i), meaningless in
  CJK, and breaks screen reader pronunciation. Use `textTransform` if you must, and prefer a
  design that doesn't need it.

## Other locale gotchas

- **Sorting** — use `Intl.Collator`, not `Array.sort()` on strings.
- **Search** — normalise diacritics and case per locale.
- **Names** — don't assume first/last; a single `fullName` field is safer.
- **Addresses** — field order and required fields vary hugely by country.
- **Week start** — Sunday vs Monday vs Saturday.
- **Time zones** — store UTC, render local. Don't do date arithmetic on local strings.

## Audit grep

```bash
rg '<Text[^>]*>[A-Z][a-z]{3,}' --type tsx | head -30       # hardcoded UI strings
rg 'marginLeft|marginRight|paddingLeft|paddingRight' --type tsx -c
rg "left:\s|right:\s" --type tsx | head -20
rg 'I18nManager' --type tsx -c
rg 'toUpperCase\(\)' --type tsx
rg 'new Intl\.' --type ts -c                                # inside render?
rg 'toLocaleDateString|toLocaleString' --type ts            # check a locale is passed
rg '\$\{.*\}\s*(item|result|day)s?' --type tsx              # manual pluralisation
```
