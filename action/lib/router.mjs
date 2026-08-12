/**
 * Agent router — decides which specialists should review a given changeset.
 *
 * This is the single biggest cost lever in the product. Running all six agents
 * on every pull request is both expensive and noisy: a PR that only touches
 * `eas.json` does not need an accessibility review, and a CSS-only change does
 * not need a release review.
 *
 * Routing reuses the `globs` and `triggers` metadata already declared in each
 * agent's frontmatter, so there is no second source of truth to maintain.
 */

// Minimal glob matching (no dependencies). Supports the subset used in agent
// frontmatter: `**` for any depth, `*` within a segment, `?`, and `{a,b}`
// alternation. Examples: `**/*.tsx`, `**/*.{ts,tsx}`, `**/AndroidManifest.xml`,
// `metro.config.js`, `**/.env*`.
// (Written as line comments deliberately — `**/` would terminate a block comment.)

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];

    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches any number of leading path segments, including none.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
      continue;
    }

    if (ch === '{') {
      const close = glob.indexOf('}', i);
      if (close !== -1) {
        const alts = glob
          .slice(i + 1, close)
          .split(',')
          .map((s) => s.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&'));
        re += `(?:${alts.join('|')})`;
        i = close;
        continue;
      }
    }

    if (ch === '?') {
      re += '[^/]';
      continue;
    }

    re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesGlob(file, glob) {
  return globToRegExp(glob).test(file);
}

/* ------------------------------------------------------------------ *
 * Signal files — strong hints that a specific agent is required,
 * regardless of what the agent's own globs say.
 *
 * Agent globs are broad by design (an agent wants to be *available* for any
 * TS file). For routing we need the opposite: evidence that this agent is
 * actually warranted. These patterns encode that evidence.
 * ------------------------------------------------------------------ */

export const SIGNALS = {
  'rn-security': [
    '**/*.{env,pem,key}',
    '**/.env*',
    '**/AndroidManifest.xml',
    '**/Info.plist',
    '**/*.entitlements',
    '**/network_security_config.xml',
    '**/PrivacyInfo.xcprivacy',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '**/*{auth,Auth,login,Login,token,Token,crypto,Crypto,secure,Secure,session,Session}*',
    '**/*{webview,WebView,deeplink,DeepLink,linking,Linking}*',
    '**/*{api,Api,API,fetch,client,Client,http,Http}*',
  ],
  'rn-performance': [
    '**/*{List,list,Feed,feed,Scroll,scroll,Grid,grid}*',
    '**/*{Animated,animation,Animation,gesture,Gesture,Reanimated}*',
    '**/*{Image,image,Video,video,Media,media}*',
    'metro.config.js',
    'babel.config.js',
    '**/*{Screen,screen,Page,page}*',
    'package.json',
  ],
  'rn-ui-accessibility': [
    '**/*.{tsx,jsx}',
    '**/theme/**',
    '**/styles/**',
    '**/*{Button,button,Modal,modal,Form,form,Input,input}*',
    '**/*{locale,Locale,i18n,translation}*',
  ],
  'rn-code-quality': ['**/*.{ts,tsx,js,jsx}'],
  'rn-testing': [
    '**/*.{test,spec}.{ts,tsx,js,jsx}',
    '**/__tests__/**',
    '**/e2e/**',
    '**/.maestro/**',
    'jest.config.*',
    'jest.setup.*',
  ],
  'rn-release': [
    'eas.json',
    'app.json',
    'app.config.*',
    '**/fastlane/**',
    '**/*.gradle',
    '**/Info.plist',
    '**/Podfile*',
    'package.json',
    '.github/workflows/**',
  ],
};

/**
 * Files that never warrant an audit — routing them wastes tokens and produces
 * findings nobody acts on.
 */
export const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/*.lock',
  '**/*.snap',
  '**/*.{png,jpg,jpeg,gif,webp,svg,ico,mp4,mov,ttf,otf,woff,woff2}',
  '**/*.min.js',
  '**/vendor/**',
  '**/Pods/**',
  '**/.yarn/**',
];

export function isIgnored(file) {
  return IGNORED.some((g) => matchesGlob(file, g));
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

/**
 * @param {string[]} changedFiles  paths relative to the repo root
 * @param {object[]} agents        loaded agent definitions (id, globs, triggers)
 * @param {object}   opts
 * @param {string[]} [opts.only]   force a specific agent set, skipping routing
 * @param {number}   [opts.maxAgents] cap the number of agents (cost control)
 * @param {string}   [opts.diffText]  full diff, used for keyword signals
 * @returns {{ selected: object[], skipped: object[], files: string[], reasons: Record<string,string[]> }}
 */
export function route(changedFiles, agents, opts = {}) {
  const files = changedFiles.filter((f) => !isIgnored(f));
  const reasons = {};

  if (opts.only?.length) {
    const wanted = new Set(opts.only);
    return {
      files,
      reasons: Object.fromEntries(opts.only.map((id) => [id, ['explicitly requested']])),
      selected: agents.filter((a) => wanted.has(a.id)),
      skipped: agents.filter((a) => !wanted.has(a.id)),
    };
  }

  if (files.length === 0) {
    return { files, reasons, selected: [], skipped: [...agents] };
  }

  const scored = agents.map((agent) => {
    const why = [];
    const signals = SIGNALS[agent.id] ?? agent.globs ?? [];
    const hits = files.filter((f) => signals.some((g) => matchesGlob(f, g)));

    if (hits.length) {
      why.push(
        `${hits.length} matching file${hits.length === 1 ? '' : 's'}: ` +
          hits.slice(0, 3).join(', ') +
          (hits.length > 3 ? `, +${hits.length - 3} more` : ''),
      );
    }

    // Keyword signals from the diff body catch cases the filename misses —
    // e.g. AsyncStorage token writes inside a generically-named file.
    let keywordHits = [];
    if (opts.diffText && agent.triggers?.length) {
      const added = addedLines(opts.diffText).join('\n').toLowerCase();
      keywordHits = agent.triggers.filter(
        (t) => String(t).length > 4 && added.includes(String(t).toLowerCase()),
      );
      if (keywordHits.length) why.push(`diff mentions: ${keywordHits.slice(0, 4).join(', ')}`);
    }

    const score = hits.length + keywordHits.length * 2;
    if (why.length) reasons[agent.id] = why;
    return { agent, score, fileCount: hits.length };
  });

  let selected = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const cut = opts.maxAgents && selected.length > opts.maxAgents ? selected.slice(opts.maxAgents) : [];
  if (cut.length) selected = selected.slice(0, opts.maxAgents);

  const selectedIds = new Set(selected.map((s) => s.agent.id));
  for (const c of cut) reasons[c.agent.id] = ['skipped: over maxAgents budget'];

  return {
    files,
    reasons,
    selected: selected.map((s) => s.agent),
    skipped: agents.filter((a) => !selectedIds.has(a.id)),
  };
}

/** Added lines from a unified diff, without the leading `+`. */
export function addedLines(diffText) {
  return diffText
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
}
