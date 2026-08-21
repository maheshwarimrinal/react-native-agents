# Upgrade plan: 0.86 → 0.87

Single minor hop. Three commits in one PR, verified between each.

## 1. Dependency bump
- `react-native` 0.86.3 → 0.87.0
- `react` unchanged at 19.2.0 (0.87 pins the same)
- Lockfile regenerated from scratch; `Podfile.lock` regenerated via `bundle exec pod install`

## 2. Native template diff
Reconciled by hand against the Upgrade Helper diff for 0.86.3 → 0.87.0, preserving:
- our release signing config in `android/app/build.gradle`
- the two product flavours
- the modified `AppDelegate` push-registration hook

## 3. Code changes
None required. No deprecation warnings in the Gradle or Metro output.

## Verification
- [x] Clean release build, both platforms
- [x] Clean checkout builds (fresh clone, no local caches)
- [x] Release build launches cold on a physical device
- [x] Measurement-dependent screens exercised (bottom sheet, tooltip anchor)
- [x] Both custom native modules exercised directly
- [x] Deep link cold-start
- [x] Push received in background and foreground
- [x] Test crash in release build arrives symbolicated against release `4.3.0+412`
- [x] Bundle size recorded before (4,118,204 B) and after (4,121,880 B)

## Rollback
Pre-upgrade commit `a91c4e2` retained on `release/0.86.x`; previous lockfiles kept until the
staged rollout completes.
