We're on RN 0.87. `@react-native-community/async-storage` is still in our package.json and the
build warns about it. Someone suggested replacing it with MMKV since it's faster.

We use it in 43 files — auth tokens, user preferences, a cached feed, and onboarding flags.

Should we switch to MMKV?
