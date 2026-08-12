---
trigger: manual
description: "RN Security: Dependency and Supply-Chain Security"
---

# Dependency and Supply-Chain Security

A React Native app has ~1000 transitive dependencies. Any one of them runs with your app's full
privileges, and many run arbitrary code on your developers' machines at install time.

## Scan

```bash
npm audit --omit=dev                 # noisy; triage rather than obey
npx osv-scanner --lockfile=package-lock.json     # better data, fewer false positives
npx better-npm-audit audit           # allows documented exceptions
npx snyk test                        # if licensed
```

**Triage, don't panic-upgrade.** Most `npm audit` criticals are in build-time tooling and are not
reachable from a mobile runtime. Ask: is this package in the *app bundle*, and is the vulnerable
code path *reachable*? A prototype-pollution CVE in a webpack plugin is not a mobile
vulnerability. Conversely, an RCE in a package that parses server responses at runtime is P0.

For native transitive dependencies, `npm audit` sees nothing — you also need to check the
CocoaPods and Gradle graphs:

```bash
cd ios && pod outdated
cd android && ./gradlew app:dependencies --configuration releaseRuntimeClasspath
```

## Vet before adding

Before recommending or accepting any new dependency:

| Signal | Bad sign |
|---|---|
| Last publish | > 12 months with open issues, on a fast-moving RN ecosystem |
| Maintainers | Single maintainer, no org, recently transferred |
| Downloads vs stars | Wildly mismatched — possible typosquat or promotion |
| Install scripts | `postinstall` / `preinstall` running arbitrary code |
| Native code | Requires manual linking, patches, or an unmaintained podspec |
| New-Architecture support | No Fabric/TurboModule support = dead end on RN ≥0.82 |
| License | GPL/AGPL in a proprietary app is a legal finding |
| Bundle cost | See the performance agent |

```bash
npm view <pkg> time.modified maintainers dist-tags
npx howfat <pkg>
rg '"(pre|post)install"' node_modules/*/package.json | head -50
```

**Typosquatting** — check the exact name. `reacte-native-*`, `react-nativ-*`, and lookalikes with
a swapped character are a live attack vector. Confirm the package the docs actually name.

## Lockfile discipline

- **Commit the lockfile.** Always. A build without one resolves different code each time.
- Use `npm ci` / `yarn --frozen-lockfile` / `pnpm --frozen-lockfile` in CI, never `install`.
- Review lockfile diffs in PRs. A dependency bump nobody requested is worth a question.
- Pin exact versions for anything security-relevant (crypto, auth, storage). Caret ranges mean a
  compromised patch release lands automatically.
- Enable `npm config set ignore-scripts true` for CI where feasible, with an explicit allow-list
  for the packages that genuinely need build scripts.

## Patches

```bash
ls patches/          # patch-package output
```

Every patch is unreviewed code injected into a dependency. Read each one: what does it change,
who wrote it, is there an upstream PR, when can it be dropped? Stale patches silently break on
upgrade and are a natural hiding place for malicious changes.

## CI/CD supply chain

The pipeline that builds your app is part of your attack surface — and it holds signing keys.

- **Secrets in CI:** scoped to the minimum, not exposed to PR builds from forks, rotated,
  and never echoed into logs.
- **Signing keys:** in a managed store (EAS credentials, Play App Signing, Xcode Cloud), not in
  the repo, not in a shared drive. Play App Signing means a stolen upload key is recoverable;
  losing a self-managed key is permanent.
- **Third-party GitHub Actions:** pin to a full commit SHA, not a tag. Tags are mutable — this
  is how several real supply-chain compromises propagated.
  ```yaml
  - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
  ```
- **`pull_request_target`** with checkout of the PR head gives untrusted code access to your
  secrets. A well-known and still-common misconfiguration.
- **Branch protection** on release branches, required review for anything touching CI config,
  release channels, or native build files.
- **Publish tokens for OTA updates** deserve the same care as signing keys — they're a direct
  code-execution channel to users (see `platform-hardening.md`).

## SBOM and continuous monitoring

```bash
npx @cyclonedx/cyclonedx-npm --output-file sbom.json
```

Generate an SBOM per release so that when the next widely-used package is compromised you can
answer "are we affected, and in which shipped versions?" in minutes rather than days.

Enable Dependabot or Renovate with grouped, scheduled updates — automated bumps that nobody
reviews are their own risk, so pair them with a real review policy and a good test suite.

## Third-party SDK review

Analytics, ads, attribution, chat, and crash SDKs are the highest-risk dependencies because they
are *designed* to collect and exfiltrate data. For each one:

- What does it collect by default? (Often: device ID, IP, location, installed-app list.)
- Does that match your privacy policy, App Store privacy label, and Play Data Safety form?
- Does it ship its own OTA/config-fetch mechanism (i.e. remote code or behaviour change)?
- Can you disable collection pending consent (GDPR requires consent *before* collection)?
- Does it have its own network stack that bypasses your pinning?

An SDK that quietly collects the installed-app list is both a privacy violation and a store
policy problem — and the app developer is accountable, not the SDK vendor.

## Audit commands

```bash
npx osv-scanner --lockfile=package-lock.json
npx depcheck                                       # unused deps still ship
rg '"resolutions"|"overrides"' package.json        # forced versions — why?
ls patches/ 2>/dev/null && cat patches/*
rg 'uses: .*@(v?[0-9]|main|master)' .github/workflows/   # unpinned actions
rg 'pull_request_target' .github/workflows/
git log --oneline -- package-lock.json | head
```
