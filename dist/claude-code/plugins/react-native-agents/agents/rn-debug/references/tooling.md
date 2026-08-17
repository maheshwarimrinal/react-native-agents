# Tooling After Flipper

Flipper and the Chrome-based remote debugger are both gone. Advice written against them does not
apply, and a great deal of what is online was written against them.

The replacement is **React Native DevTools**, built on Chrome DevTools and connected directly to
Hermes. The important difference: your code runs in Hermes on the device, not in a browser. What
you observe is what actually happens.

## Opening it

```bash
# With the dev server running, press `j` in the Metro terminal,
# or shake the device / Cmd-D (iOS sim) / Cmd-M (Android emu) → "Open DevTools"
```

## What each panel is actually for

| Panel | Use it for |
|---|---|
| **Console** | Logs, and evaluating expressions against live app state |
| **Sources** | Real breakpoints, stepping, conditional breakpoints, watch expressions |
| **Components** | Props and state of any component; which are re-rendering and why |
| **Profiler** | Render timing — which commit was slow and what caused it |
| **Network** | Requests, headers, payloads, timing |
| **Memory** | Heap snapshots for leak hunting |

## Breakpoints beat logging

`console.log` answers only the question you thought to ask, and each iteration costs a reload. A
breakpoint lets you inspect everything in scope at the moment it matters.

Two features worth knowing because they change what is practical:

**Conditional breakpoints** — right-click a breakpoint and add a condition like `item.id === '42'`.
This is how you debug the one bad row in a list of four hundred without stepping through the rest.

**Logpoints** — a breakpoint that logs and does not pause. All the information of a `console.log`
with no code change, no reload, and nothing to forget to remove.

## The Components panel answers "why did this re-render?"

For the most common React performance complaint, this panel is the direct answer rather than an
inference. Enable "Highlight updates when components render" to see re-render activity visually,
then select a component to see which prop or state change triggered its last render.

That converts "something is re-rendering too much" into "this specific prop changes identity every
render", which is a fixable statement. Hand the fix to `rn-performance`.

## What DevTools cannot see

Be explicit about the boundary, because time gets lost here:

- **Native crashes** — nothing in the JS layer sees them. Use Xcode's console, `adb logcat`, or your
  crash reporter.
- **Native module internals** — you see the JS side of the call, not what the native code did.
- **Release builds** — DevTools attaches to development builds. For release-only bugs see
  `release-only-bugs.md`.
- **Anything before the JS bundle loads** — early startup is native territory.

```bash
adb logcat --pid=$(adb shell pidof -s <applicationId>)   # Android native
xcrun simctl spawn booted log stream --level debug       # iOS simulator
```

## Performance work belongs in the profiler

The React Profiler records commits and attributes time. Record the interaction that feels slow,
find the expensive commit, and look at what rendered.

Two cautions. Development builds are slower than release across the board, so use the profiler to
find *relative* hot spots, not to make absolute claims. And never quote a profiler number from a
debug build as though it described production — that is exactly the fabricated measurement the
shared rules forbid.
