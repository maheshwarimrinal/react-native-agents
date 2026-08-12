# Theming and Dark Mode

## Tokens, not values

Every colour, spacing, radius, and type size in a component should reference a token. Hardcoded
values are what make dark mode, rebrands, and consistency impossible.

```ts
// theme/tokens.ts
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius  = { sm: 4, md: 8, lg: 16, full: 9999 } as const;

export const typography = {
  displayLg: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title:     { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  body:      { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  caption:   { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const;
```

Two colour layers — **primitives** (the palette) and **semantic** (the meaning). Components only
ever use semantic tokens, which is what makes theme switching a one-file change.

```ts
const palette = {
  blue500: '#0A84FF', blue600: '#0060DF',
  gray50: '#FAFAFA', gray100: '#F4F4F5', gray500: '#71717A', gray900: '#18181B',
  red500: '#DC2626', red400: '#F87171',
  white: '#FFFFFF', black: '#000000',
};

export const lightTheme = {
  bg: palette.white,
  bgElevated: palette.gray50,
  border: palette.gray100,
  textPrimary: palette.gray900,
  textSecondary: palette.gray500,      // verify contrast on bg!
  accent: palette.blue600,
  danger: palette.red500,
  onAccent: palette.white,
} as const;

export const darkTheme: typeof lightTheme = {
  bg: palette.black,
  bgElevated: '#1C1C1E',
  border: '#2C2C2E',
  textPrimary: palette.white,
  textSecondary: '#98989F',
  accent: palette.blue500,             // brighter — dark backgrounds need more luminance
  danger: palette.red400,
  onAccent: palette.white,
};
```

Typing dark as `typeof lightTheme` guarantees the two stay in sync — a missing dark token becomes
a compile error rather than a black-on-black surprise.

## Wiring it up

```tsx
const ThemeContext = createContext(lightTheme);

export function ThemeProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme();                 // 'light' | 'dark' | null
  const [override, setOverride] = useState<'light' | 'dark' | 'system'>('system');
  const active = override === 'system' ? scheme ?? 'light' : override;
  const theme = active === 'dark' ? darkTheme : lightTheme;

  const value = useMemo(() => ({ theme, mode: override, setMode: setOverride }), [theme, override]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
```

Offer three options — Light, Dark, **System** — and default to System. Persist the choice.

Because styles now depend on the theme, `StyleSheet.create` at module scope no longer works
directly. Either memoise per theme, or keep layout in a static stylesheet and apply only colours
inline:

```tsx
const useStyles = () => {
  const { theme } = useTheme();
  return useMemo(() => StyleSheet.create({
    card: { backgroundColor: theme.bgElevated, borderColor: theme.border, padding: spacing.md },
  }), [theme]);
};
```

## Dark mode is not an inversion

Things that go wrong when people just swap black and white:

- **Pure black (#000) plus pure white (#FFF)** is harsh and causes halation for many readers.
  Prefer near-black backgrounds (#0B0B0D–#1C1C1E) and slightly-off-white text.
- **Elevation.** In light mode, shadows convey elevation. On a dark background shadows are
  invisible — use lighter surface colours for higher elevation instead.
- **Brand colours often fail contrast on dark.** A blue that reads well on white is usually too
  dark on black; brighten it. Re-check every ratio, don't assume the light-mode audit carries
  over.
- **Images and illustrations** with baked-in white backgrounds glow. Provide dark variants, or
  use transparent PNG/SVG.
- **Semi-transparent overlays** tuned for light mode disappear on dark.
- **Status bar** must switch content style, or you get black icons on a black bar:
  ```tsx
  <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
  ```
- **Native surfaces** — Android's `windowBackground`, the splash screen, and the app-switcher
  card each need a dark variant, or the app flashes white on launch. This is very visible and
  commonly missed.
- **WebView content** needs its own dark styling; it doesn't inherit yours.
- **Maps, charts, and video players** typically need explicit dark styles.

Declare support so the OS doesn't force-adapt:
```json
{ "expo": { "userInterfaceStyle": "automatic" } }
```

## Contrast in both themes

Every semantic pair (text-on-bg, text-on-elevated, accent-on-bg, onAccent-on-accent) must meet
4.5:1 for body text and 3:1 for large text and UI elements — **in both themes**. Write it as a
test so it can't regress:

```ts
test.each([
  ['light', lightTheme], ['dark', darkTheme],
])('%s theme meets WCAG AA', (_name, t) => {
  expect(contrast(t.textPrimary, t.bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.textSecondary, t.bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.border, t.bg)).toBeGreaterThanOrEqual(3);
});
```

Secondary/muted text is the token that fails most often — it's chosen for visual hierarchy and
then never measured.

## Typography

- Use a scale; don't invent a `fontSize: 15` because it looked better.
- `lineHeight` on every text style. RN's default line height is tight and hurts readability,
  especially for dyslexic readers.
- Load custom fonts properly (`expo-font`) and handle the loading state, or text reflows visibly
  when the font arrives.
- Include weights you actually use; on Android, `fontWeight` on a font family without that weight
  falls back to synthetic bolding, which looks wrong.
- Respect `fontScale` (see `accessibility-checklist.md`) — a type scale that hardcodes pixel
  heights will clip.

## Component variants

```tsx
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variantStyle = (t: Theme): Record<ButtonVariant, ViewStyle> => ({
  primary:   { backgroundColor: t.accent },
  secondary: { backgroundColor: t.bgElevated, borderWidth: 1, borderColor: t.border },
  ghost:     { backgroundColor: 'transparent' },
  danger:    { backgroundColor: t.danger },
});
```

A typed variant map beats a chain of ternaries and makes adding a theme mechanical.

## Audit grep

```bash
rg "#[0-9a-fA-F]{3,8}\b" --type tsx | rg -v 'theme|tokens|palette' | head -40
rg "'(white|black|red|blue|gray|grey)'" --type tsx | head -20
rg 'useColorScheme' --type tsx -c
rg 'userInterfaceStyle' app.json app.config.*
rg 'StatusBar' --type tsx -A 2 | rg barStyle
rg 'shadowColor|elevation' --type tsx -c        # elevation strategy in dark mode?
rg 'fontSize:' --type tsx | rg -v 'typography|theme' | head -20
rg 'lineHeight' --type tsx -c
```
