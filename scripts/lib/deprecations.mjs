/**
 * Every API this corpus calls dying must be an API the router can see.
 *
 * The agents exist partly to say "this was removed, here is the replacement".
 * That advice can only reach anyone if a diff containing the old name routes the
 * agent that carries the advice — and a trigger is the only thing that matches a
 * diff body. So an identifier documented as removed or deprecated, with no
 * trigger, is a finding we have written down and made unreachable.
 *
 * This was found the slow way. Review handed it over one instance per round:
 * `useScrollViewOffset` in one review, `combineTransition` in the next. Both
 * were real, and both were a sample of the same list — running the list showed
 * ten more, including six worklets names and Apple's `verifyReceipt`. One guard
 * closes all of them and every future one, instead of waiting for a reviewer to
 * notice the eleventh.
 *
 * Two sources, deliberately:
 *
 *  - The vendored lists in `rn-lib-versions.json` (`deprecated_*` keys). These
 *    are machine-readable and authoritative — they came from published type
 *    definitions.
 *  - Agent prose that says an identifier was removed or deprecated. Less tidy,
 *    but it is where `combineTransition` and `verifyReceipt` live, and prose is
 *    how most of this knowledge is actually written.
 */

/** Matches "`someApi` was removed", "`someApi` is deprecated", and near variants. */
const PROSE_DECLARES_DYING =
  /`([A-Za-z_$][\w$]*)`[^.\n]{0,60}?\b(?:was|is|are|were)\s+(?:also\s+)?(?:removed|deprecated)\b/g;

/**
 * Triggers of 4 characters or fewer are dropped by the router before matching,
 * so counting them here would report coverage the router does not have. This
 * mirrors `action/lib/router.mjs`; the two must move together.
 */
const ROUTER_MIN_TRIGGER_LENGTH = 4;

/**
 * @param {object[]} agents
 * @param {object} libVersions parsed scripts/data/rn-lib-versions.json
 * @returns {Map<string, string>} identifier -> where it was declared dying
 */
export function collectDyingApis(agents, libVersions) {
  const found = new Map();

  for (const [lib, meta] of Object.entries(libVersions.libraries ?? {})) {
    for (const key of Object.keys(meta)) {
      if (!/^deprecated/.test(key) || !Array.isArray(meta[key])) continue;
      for (const name of meta[key]) found.set(name, `libraries.${lib}.${key}`);
    }
  }

  for (const [lib, surface] of Object.entries(libVersions.export_surfaces ?? {})) {
    if (!Array.isArray(surface.deprecated_exports)) continue;
    for (const name of surface.deprecated_exports) {
      found.set(name, `export_surfaces["${lib}"].deprecated_exports`);
    }
  }

  for (const agent of agents) {
    const docs = [...agent.references, { slug: 'agent.md', content: agent.body }];
    for (const doc of docs) {
      for (const m of String(doc.content ?? '').matchAll(PROSE_DECLARES_DYING)) {
        // Vendored sources win: they name the version that deprecated the API.
        if (!found.has(m[1])) found.set(m[1], `${agent.id}/${doc.slug}`);
      }
    }
  }

  return found;
}

/**
 * Dying APIs that no trigger would match in a diff.
 *
 * Substring, like the router: a trigger is matched against the lowercased added
 * line, so `makeshareable` covers `makeShareableCloneRecursive` too. That is why
 * six worklets names need four triggers rather than six.
 *
 * @param {object[]} agents
 * @param {object} libVersions
 * @param {Set<string>|string[]} [excused] identifiers deliberately not routed
 * @returns {{name: string, source: string}[]}
 */
export function unroutedDyingApis(agents, libVersions, excused = []) {
  const skip = new Set([...excused].map((s) => String(s).toLowerCase()));
  const triggers = agents
    .flatMap((a) => (a.triggers ?? []).map((t) => String(t).toLowerCase()))
    .filter((t) => t.length > ROUTER_MIN_TRIGGER_LENGTH);

  const out = [];
  for (const [name, source] of collectDyingApis(agents, libVersions)) {
    if (skip.has(name.toLowerCase())) continue;
    if (triggers.some((t) => name.toLowerCase().includes(t))) continue;
    out.push({ name, source });
  }
  return out;
}
