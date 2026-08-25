#!/usr/bin/env node
/**
 * Knowledge freshness check.
 *
 * The agents assert things about specific React Native and Expo versions. That
 * assertion decays every time upstream ships, and nothing in the repository
 * notices — which is exactly how a "current expertise" project quietly becomes
 * wrong. This compares knowledge.json against the npm registry and reports
 * which reference documents mention version-specific behaviour.
 *
 *   node scripts/freshness.mjs              human-readable
 *   node scripts/freshness.mjs --json
 *   node scripts/freshness.mjs --github-output    for CI
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS_DIR, KNOWLEDGE, ROOT, knowledgeAgeDays, loadAgents } from './lib/source.mjs';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Compare dotted versions numerically: 0.87 > 0.9 is false, 0.87 > 0.86 is true. */
export function isNewer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Strip the patch component: 0.87.3 → 0.87. Minor releases are what matter here. */
export function minorOf(v) {
  const p = String(v).split('.');
  return p.length >= 2 ? `${p[0]}.${p[1]}` : String(v);
}

async function latestOnNpm(pkg) {
  try {
    const r = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.version ?? null;
  } catch {
    return null;
  }
}

/** Reference documents that name a specific version — these need review on a bump. */
export function referencesMentioningVersions() {
  const hits = [];
  const agents = loadAgents();
  for (const agent of agents) {
    for (const ref of agent.references) {
      const matches = ref.content.match(/\b0\.\d{2}\b|\bSDK\s*\d{2}\b|\bReact\s*19(\.\d+)?\b/g);
      if (matches?.length) {
        hits.push({
          agent: agent.id,
          file: `agents/${agent.dir}/references/${ref.slug}.md`,
          mentions: [...new Set(matches)].slice(0, 6),
        });
      }
    }
  }
  return hits;
}

async function main() {
  const args = new Set(process.argv.slice(2));

  const [rnLatest, expoLatest] = await Promise.all([
    latestOnNpm('react-native'),
    latestOnNpm('expo'),
  ]);

  const rnKnown = KNOWLEDGE.reactNative.verified_through;
  const expoKnown = String(KNOWLEDGE.expo.verified_through);
  const age = knowledgeAgeDays();
  const window = KNOWLEDGE.policy?.review_window_days ?? 90;

  const rnBehind = rnLatest ? isNewer(minorOf(rnLatest), rnKnown) : false;
  const expoBehind = expoLatest ? isNewer(minorOf(expoLatest).split('.')[0], expoKnown) : false;

  /**
   * Third-party libraries the agents quote concretely.
   *
   * The platform versions above were current the whole time the payments agent
   * was documenting a react-native-iap API that had been *removed* — the
   * library moves on its own schedule, so checking only React Native and Expo
   * left the most version-brittle guidance in the collection unwatched.
   */
  const libs = Object.entries(KNOWLEDGE.libraries ?? {}).filter(([k]) => !k.startsWith('$'));
  const libResults = await Promise.all(
    libs.map(async ([key, meta]) => {
      const latest = await latestOnNpm(meta.package ?? key);
      const known = String(meta.verified_through);
      return {
        key,
        package: meta.package ?? key,
        latest,
        known,
        usedBy: meta.used_by ?? [],
        behind: latest ? isNewer(minorOf(latest), known) : false,
      };
    }),
  );
  const libsBehind = libResults.filter((l) => l.behind);

  const tooOld = age > window;
  const stale = rnBehind || expoBehind || libsBehind.length > 0 || tooOld;

  const affected = stale ? referencesMentioningVersions() : [];

  if (args.has('--json')) {
    console.log(
      JSON.stringify(
        {
          rnLatest,
          rnKnown,
          rnBehind,
          expoLatest,
          expoKnown,
          expoBehind,
          libraries: libResults,
          age,
          tooOld,
          stale,
          affected,
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines = [];
  if (rnBehind) lines.push(`- **React Native ${minorOf(rnLatest)}** is out; knowledge is verified through **${rnKnown}**.`);
  if (expoBehind) lines.push(`- **Expo SDK ${minorOf(expoLatest).split('.')[0]}** is out; knowledge is verified through **${expoKnown}**.`);
  for (const l of libsBehind) {
    lines.push(
      `- **${l.package} ${minorOf(l.latest)}** is out; knowledge is verified through **${l.known}**` +
        (l.usedBy.length ? ` (quoted by ${l.usedBy.join(', ')}).` : '.'),
    );
  }
  if (tooOld) lines.push(`- Knowledge was last verified **${age} days** ago (review window is ${window} days).`);

  const body = [
    'Automated freshness check — the agents claim current React Native expertise, and that claim needs periodic re-verification.',
    '',
    ...lines,
    '',
    `${affected.length} reference document(s) mention version-specific behaviour and should be reviewed:`,
    '',
    ...affected.slice(0, 25).map((h) => `- \`${h.file}\` — mentions ${h.mentions.join(', ')}`),
    affected.length > 25 ? `- …and ${affected.length - 25} more` : '',
    '',
    '### What to do',
    '',
    '1. Read the upstream changelogs for the new release(s).',
    '2. Update any reference that is now wrong — and only those.',
    '3. Update `shared/rn-context.md` if the baseline table changed.',
    '4. Bump `verified_through` and `last_verified` in `knowledge.json`.',
    '5. Run `npm run build && npm test`.',
    '',
    '> Only bump `last_verified` after actually reviewing. Bumping it without reading is worse',
    '> than leaving it stale, because it launders an unchecked claim as a verified one.',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const title = rnBehind
    ? `Knowledge review: React Native ${minorOf(rnLatest)} released`
    : expoBehind
      ? `Knowledge review: Expo SDK ${minorOf(expoLatest).split('.')[0]} released`
      : libsBehind.length
        ? `Knowledge review: ${libsBehind[0].package} ${minorOf(libsBehind[0].latest)} released`
        : `Knowledge review: last verified ${age} days ago`;

  if (args.has('--github-output') && process.env.GITHUB_OUTPUT) {
    const out = process.env.GITHUB_OUTPUT;
    fs.appendFileSync(out, `stale=${stale}\n`);
    fs.appendFileSync(out, `title=${title}\n`);
    fs.appendFileSync(out, `body<<__EOF__\n${body}\n__EOF__\n`);
  }

  console.log(c.bold('\n  Knowledge freshness\n'));
  console.log(`  React Native   verified ${rnKnown}   npm ${rnLatest ?? '?'}   ${rnBehind ? c.yellow('BEHIND') : c.green('ok')}`);
  console.log(`  Expo SDK       verified ${expoKnown}      npm ${expoLatest ?? '?'}   ${expoBehind ? c.yellow('BEHIND') : c.green('ok')}`);
  for (const l of libResults) {
    console.log(
      `  ${l.package.padEnd(14)} verified ${String(l.known).padEnd(6)} npm ${String(l.latest ?? '?').padEnd(6)} ` +
        (l.behind ? c.yellow('BEHIND') : c.green('ok')),
    );
  }
  console.log(`  Last verified  ${KNOWLEDGE.last_verified} (${age} days ago)   ${tooOld ? c.yellow('STALE') : c.green('ok')}`);

  if (stale) {
    console.log(c.yellow(`\n  ${affected.length} reference(s) mention version-specific behaviour.\n`));
    for (const h of affected.slice(0, 10)) console.log(c.dim(`    ${h.file} — ${h.mentions.join(', ')}`));
    console.log();
  } else {
    console.log(c.green('\n  Up to date.\n'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`freshness check failed: ${err.message}`);
    process.exit(1);
  });
}
