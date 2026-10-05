/**
 * Trigger provenance: checking that a trigger string names an API that exists.
 *
 * A trigger is matched against the *added* lines of a diff, so it is a claim
 * about text that appears in real code — the same kind of factual claim an
 * import is, and for a long time the only one nothing checked. The commit that
 * fixed routing recall introduced three wrong ones at once:
 *
 *   registerdevicefornotifications  RNFB's API is registerDeviceForRemoteMessages
 *   tobeintthedocument              jest-dom's matcher, misspelled; RNTL's is toBeOnTheScreen
 *   layouttransition                Reanimated's is LinearTransition
 *
 * Each routed on nothing. That failure is invisible from the outside: the agent
 * simply never fires, and no eval can see a finding that was never attempted.
 *
 * Lives in its own module rather than in scripts/test.mjs so the mutation
 * harness can import it without running the whole suite — test.mjs exits the
 * process when it finishes, which silently swallowed a first attempt at exactly
 * that.
 */

/**
 * Triggers short enough or phrasal enough not to be API claims.
 *
 * The router already drops triggers of 4 characters or fewer; 8 is where a
 * lowercase run stops being a word someone typed and starts being a collapsed
 * identifier. A space or a hyphen means the author wrote prose ("push
 * notification", "data-only"), and no API is named that.
 *
 * @param {unknown} trigger
 * @returns {boolean}
 */
export function isIdentifierShapedTrigger(trigger) {
  const s = String(trigger);
  return s.length >= 8 && !/[\s-]/.test(s);
}

/**
 * Resolve a surface's `exports_ref` dotted path against the versions file, so
 * a list stored once (Reanimated's 125 names) is not copied a second time.
 *
 * @param {object} surface
 * @param {object} root
 * @returns {string[] | null}
 */
export function resolveExports(surface, root) {
  if (Array.isArray(surface.exports)) return surface.exports;
  if (!surface.exports_ref) return null;
  let node = root;
  for (const key of surface.exports_ref.split('.')) {
    node = node?.[key];
    if (node === undefined) return null;
  }
  return Array.isArray(node) ? node : null;
}

/**
 * @param {object[]} agents      loaded agent definitions
 * @param {object} provenance    parsed scripts/data/trigger-provenance.json
 * @param {object} libVersions   parsed scripts/data/rn-lib-versions.json
 * @returns {{missing: string[], invented: string[], checked: number, live: Set<string>}}
 */
export function auditTriggers(agents, provenance, libVersions) {
  const claims = provenance.triggers ?? {};
  const surfaces = libVersions.export_surfaces ?? {};

  const lowered = {};
  for (const [pkg, surface] of Object.entries(surfaces)) {
    const names = resolveExports(surface, libVersions);
    if (!names) continue;
    lowered[pkg] = [...names, ...(surface.extra ?? [])].map((n) => String(n).toLowerCase());
  }

  const missing = [];
  const invented = [];
  const live = new Set();
  let checked = 0;

  for (const agent of agents) {
    for (const raw of agent.triggers ?? []) {
      if (!isIdentifierShapedTrigger(raw)) continue;
      const trigger = String(raw).toLowerCase();
      live.add(trigger);
      const claim = claims[trigger];

      if (claim === undefined) {
        missing.push(
          `${agent.id}: trigger "${raw}" is not in trigger-provenance.json — name the package it comes from, or give a "!reason" why it cannot be checked`,
        );
        continue;
      }
      if (typeof claim !== 'string' || claim === '') {
        missing.push(`${agent.id}: trigger "${raw}" has an empty provenance entry`);
        continue;
      }
      if (claim.startsWith('!')) continue;

      const names = lowered[claim];
      if (!names || names.length === 0) {
        // Attributed to a package with no usable surface. Not a pass — an
        // unusable claim, because nothing can check it. Saying so keeps the
        // file from filling with attributions that look verified and are not,
        // and makes an emptied surface a failure rather than a silent skip.
        missing.push(
          `${agent.id}: trigger "${raw}" claims ${claim}, which has no complete surface in rn-lib-versions.json's export_surfaces`,
        );
        continue;
      }

      checked += 1;
      // Substring, not equality: triggers are deliberately written as prefixes.
      // `getexpopushtoken` is meant to catch `getExpoPushTokenAsync`, and
      // `acknowledgepurchase` to catch `acknowledgePurchaseAndroid`.
      if (!names.some((n) => n.includes(trigger))) {
        invented.push(`${agent.id}: ${claim} exports nothing containing "${raw}"`);
      }
    }
  }

  return { missing, invented, checked, live };
}
