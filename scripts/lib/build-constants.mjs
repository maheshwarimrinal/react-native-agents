/**
 * Constants shared between the build and the tests that police it.
 *
 * Deliberately a separate module with no imports and no side effects.
 * `scripts/build.mjs` runs a build at import time, so it cannot export this —
 * importing it to read one string would trigger a build. The test suite was
 * therefore hardcoding the marker filename in two places while build.mjs
 * defined it in a third, and a change to one would have silently disarmed the
 * `--out` safety check rather than failing anything.
 */

/**
 * Written into any `--out` target so a later build recognises the directory as
 * its own and may reuse it.
 *
 * The name matters. The first version of the `--out` guard keyed on
 * `index.json`, which every npm package directory has — so `--out` pointed at
 * an unrelated project was accepted and then pruned. A marker only this build
 * writes cannot be there by coincidence.
 */
export const BUILD_MARKER = '.rn-agents-build';
