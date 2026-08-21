---
trigger: manual
description: "RN Platform Parity: The Divergence Catalogue"
---

# The Divergence Catalogue

Every entry produces **no error and no warning**. The code is correct. The behaviour differs.

| Area | iOS | Android | Cost if unhandled |
|---|---|---|---|
| Keyboard | Overlays content; `KeyboardAvoidingView` needs `padding` | `windowSoftInputMode` often resizes; `height` behaviour differs | Submit button unreachable |
| Safe area | Notch, dynamic island, home indicator | Cutouts vary; gesture nav bar | Content under system UI |
| Hardware back | Does not exist | Global, and unhandled means app exit | Data loss mid-flow |
| Shadows | `shadow*` props | `elevation` only | Flat cards on Android |
| Elevation ordering | `zIndex` | `elevation` also affects stacking | Wrong overlay order |
| Text truncation | Different metrics | Different metrics | Clipped or wrapped labels |
| Line height | Applied differently | Applied differently | Tight layouts break |
| Font weight | Full numeric range | Limited on older versions | Wrong visual hierarchy |
| Scroll physics | Bounce | Glow / stretch | Cosmetic, but jarring |
| `overScrollMode` | n/a | Configurable | Cosmetic |
| Date picker | Wheel, inline or modal | Material dialog | Layout assumptions break |
| Permissions | One prompt, ever | Re-promptable; rationale flow | Feature silently unusable |
| Status bar | `barStyle`, translucent by default | `backgroundColor`, `translucent` opt-in | Unreadable status text |
| Modals | Sheet presentation styles | Full screen | Different dismissal affordance |
| Haptics | Taptic engine | Vibration API | Feature absent, not broken |
| Deep links | Universal Links, `associatedDomains` | App Links, `assetlinks.json` | Link opens the browser |
| Text selection | Long press | Long press, different menu | Minor |
| `Alert` buttons | Order and styling differ | Order and styling differ | Destructive action mispositioned |

## The four that break flows

Everything above is worth knowing. These four are the ones that stop a user completing a task, and
they deserve disproportionate attention.

**1 — Keyboard covering an input or a submit button.** See `keyboard-and-layout.md`. The most
common React Native bug in existence.

**2 — The Android hardware back button.** See `navigation-and-input.md`. Unhandled, it exits the
app or unwinds a flow. Users lose entered data and blame the app.

**3 — Permission denial.** iOS asks once; a denied permission can only be changed in Settings.
Android permits re-prompting and has a rationale flow, and "never ask again" is a distinct state.
Code written against one model silently fails against the other. Hand the detail to
`rn-permissions`.

**4 — Safe areas.** A hardcoded 44pt top inset is wrong on most devices and has been for years.
Use the insets API and let it tell you.

## Cosmetic is still real

A card with no shadow on Android is not broken, but it is visibly worse, and it accumulates. The
distinction to hold: report cosmetic divergences at a low severity rather than not reporting them,
and never inflate one into a flow-breaking claim.

## Version-dependent behaviour

Some of these differ by OS version as well as by platform — font weight rendering, cutout handling,
and permission semantics have all shifted across releases. When behaviour depends on an OS version,
say which version, or say that you are not certain. An OS-version claim stated confidently and
wrongly is worse than an acknowledged gap, because it looks checkable and nobody checks it.
