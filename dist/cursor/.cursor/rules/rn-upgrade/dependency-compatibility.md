# Dependency Compatibility

The version bump is an afternoon. The dependencies are the project.

## Inventory before you start

Every package that ships native code is a potential blocker. Find them:

```bash
# Packages with native code
fd -t d -d 3 '^(android|ios)$' node_modules --exec dirname {} \; 2>/dev/null | sort -u

# Or from the manifest side
rg -l '"(react-native|expo)"' node_modules/*/package.json 2>/dev/null | head -50

# Autolinked modules — the authoritative list of what actually gets built in
npx react-native config 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(Object.keys(j.dependencies||{}).join('\n'))}catch{}})"
```

For each, you need three facts: **New Architecture support**, **the minimum RN version it
requires**, and **whether it is still maintained**. Without all three the upgrade estimate is not
grounded.

## Package scope moves

A namespacing change relocated a number of packages under the `@react-native` scope. This broke
imports across codebases and — the part that makes it expensive — **there is no predictable pattern
for where a given package went**. You cannot derive the new path from the old one; each has to be
looked up.

Symptom: `unable to resolve module` for something that is plainly still a dependency.

```bash
rg -n "from '(@react-native-community|react-native)/" --glob "**/*.{ts,tsx,js,jsx}" | head -40
```

Treat each as an individual lookup, not a find-and-replace. A blanket rewrite will map some
correctly and some to packages that do not exist.

## Reading maintenance signals honestly

A library that is unmaintained is a decision you are making, whether or not you notice.

| Signal | What it tells you |
|---|---|
| Last publish date | The single most useful number |
| Open issues mentioning your target RN version | Others have already hit it |
| Whether a New Arch PR is open but unmerged | Maintainer bandwidth, not capability |
| Weekly downloads | How many people will fix it if it breaks |
| Whether a maintained fork exists | Often the real answer |

Do not conclude "abandoned" from age alone. A small, complete, stable library may go a year without
a publish because it is finished. Distinguish **stable** from **stalled** by looking at whether
open issues are being answered, not at the publish date.

## When a library blocks you

In rough order of preference:

1. **Upgrade it** — check whether a newer major already supports your target.
2. **Replace it** — often a maintained alternative exists, sometimes now in core.
3. **Patch it** with `patch-package`, with the patch committed and a link to the upstream issue.
4. **Fork it** — honest about the cost, but sometimes correct for a small library.
5. **Vendor the parts you use** — for a library where you use 5% of the surface.
6. **Drop the feature** — legitimate, and worth naming as an option rather than assuming it isn't.

Never patch `node_modules` in place without `patch-package`. The next `npm install` reverts it and
the failure returns with no memory of why.

## Peer dependency errors are information

`--legacy-peer-deps` and `--force` convert a clear failure now into an unclear one later. The error
is telling you that two packages disagree about what version of something they need. That
disagreement does not go away when you silence it — it reappears as a runtime error with no
connection to its cause.

Resolve it: upgrade one side, or pin with `overrides` (npm) / `resolutions` (yarn, pnpm) and leave
a comment saying why.

## After every dependency change

Regenerate rather than hand-edit:

```bash
rm -f package-lock.json && npm install     # or the equivalent for your manager
cd ios && bundle exec pod install && cd ..
```

Hand-editing a lockfile produces a state no clean install will reproduce, which is the definition
of "works on my machine".
