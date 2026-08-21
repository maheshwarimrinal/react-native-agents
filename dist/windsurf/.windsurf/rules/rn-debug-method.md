---
trigger: manual
description: "RN Debug: Debugging Method"
---

# Debugging Method

## Reproduce first, always

A bug that happens "sometimes" cannot be verified as fixed. You will change something, fail to see
it, and believe you succeeded.

Getting to a reliable reproduction is usually most of the work:

- **What is the exact sequence?** Write it down. The step someone omits as irrelevant is often the
  cause.
- **Does state matter?** Fresh install, logged in, after a specific screen, with cached data.
- **Does timing matter?** Fast tapping, slow network, backgrounding the app mid-action.
- **Does the device matter?** Older hardware, different OS version, different screen size.

If it will not reproduce reliably, that irregularity is itself the strongest clue you have.
Intermittent behaviour is nearly always timing, ordering, or an uncontrolled external state.

## Bisect the space

Each of these questions eliminates roughly half of where the bug can live. Ask them before reading
code.

| Question | If yes |
|---|---|
| Release only? | Minification, dead-code elimination, ProGuard, `__DEV__` branches |
| One platform only? | Native module, platform API, or a platform-conditional code path |
| Only after upgrade, not fresh install? | Persisted state, migration, schema change |
| Only with the debugger detached? | Timing — the debugger changes it |
| Only on slow networks? | Race condition or missing loading state |
| Only on older devices? | Memory pressure or timing |
| Started recently? | `git bisect` — actually run it |

`git bisect` is underused. If the bug is reproducible and was introduced within a known range, it
will find the commit faster than reading code will, and it produces a definite answer rather than a
plausible one.

## One hypothesis at a time

Changing three things and seeing the bug disappear teaches you nothing. You now have a working app
and no understanding, and two of those changes are probably unnecessary complexity you will carry.

State the hypothesis, then design the observation that would **falsify** it. If you cannot imagine
evidence that would prove you wrong, you are not testing — you are looking for confirmation.

## Binary search the code

When the space is narrowed but the cause is not obvious, halve it mechanically:

- Comment out half the children — does it persist?
- Replace a component's body with a static placeholder — still there?
- Stub the network layer with fixed data — still there?
- Remove the state management — still there?

Crude, and much faster than reasoning about code you have not written. Each cut is a definite
answer rather than an impression.

## Know when to stop and ask

If you have been on it for hours with no narrowing, the problem is usually an assumption you have
not questioned. The most productive move is often to explain it out loud to someone — not for their
insight, but because articulating it forces the assumptions into the open.

Also worth checking at that point: is the thing you are debugging actually the thing that is
broken? A surprising number of long debugging sessions end with the discovery that the data was
wrong upstream, or the build was stale, or the device was running a different version than
expected.
