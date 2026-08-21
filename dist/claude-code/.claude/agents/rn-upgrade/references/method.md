# Upgrade Method

## Decide the destination before the route

Name the reason for the upgrade first. "Latest" is not a reason. Common real ones: a library you
need requires a newer RN, a store deadline forces a target SDK bump, a security advisory, or the
version you are on has left the support window.

The reason determines the destination, and the destination determines whether this is a one-hop or
a multi-hop job.

## Sequence the hops

Jumping several minors in a single commit produces a failure you cannot attribute. Each React
Native minor may change the native templates — Gradle files, `AppDelegate`, `MainActivity`,
Podfile — and those changes compose badly.

| Distance | Approach |
|---|---|
| One minor | Single hop, one PR |
| Two or three minors | One hop per minor, one PR each, verified between |
| More than three, or crossing 0.76 / 0.82 | Treat as a project, not a task |

The two boundaries worth naming: **0.76** made the New Architecture the default, and **0.82**
removed the legacy bridge entirely. An app crossing either is doing a migration, not an upgrade,
and should be planned as one.

## Separate the three kinds of work

Upgrades fail when these are mixed into one commit, because a failure could have come from any of
them:

1. **The dependency bump** — `package.json`, lockfile, `Podfile.lock`.
2. **The native template diff** — what the Upgrade Helper shows: Gradle, AppDelegate, MainActivity,
   Podfile, project settings.
3. **The code changes** — deprecated APIs, moved imports, rewritten native modules.

Do them as separate commits within the PR. When something breaks, `git bisect` then has something
useful to work with.

## Use the Upgrade Helper as a reference, not a patch

`react-native-upgrade-helper` shows the diff between two versions' templates. It is the best
available map of the native changes, and it is a map rather than the territory: it assumes an
unmodified template. Any customisation you have made — signing config, flavours, extra permissions,
a modified `AppDelegate` — has to be reconciled by hand.

Read the diff for **what changed and why**, then apply the equivalent change to your actual files.
Applying the diff blindly is how teams lose their build configuration.

## Do not destroy the evidence

The instinct when an upgrade fails is to wipe everything — `node_modules`, `Podfile.lock`,
DerivedData, Gradle caches — and start again. This works often enough to be a habit and it is the
wrong first move, because it deletes the information that identifies the cause.

Read the error first. Reinstall when you have a hypothesis that a reinstall tests.

## Keep a rollback

An upgrade branch that has been rebased and squashed cannot be abandoned cheaply. Keep the
pre-upgrade commit reachable and keep the old lockfiles until the new build has been on a device.

## Budget honestly

An upgrade across a New Architecture boundary with a dozen native dependencies is not an afternoon.
Teams routinely plan for the version bump and not for the library long tail, which is where the
time actually goes. If you cannot name the New Architecture status of every native dependency, the
estimate is not grounded yet — see `dependency-compatibility.md`.
