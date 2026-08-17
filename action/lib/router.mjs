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
 * Signal files — strong hints that a specific agent is required, regardless of
 * what the agent's own globs say.
 *
 * Agent globs are broad by design (an agent wants to be *available* for any
 * TS file). For routing we need the opposite: evidence that this agent is
 * actually warranted. These patterns encode that evidence.
 *
 * Config filenames are prefixed to match at any depth rather than written bare.
 * A bare `eas.json` only matches at the repository root, which silently skips
 * the app in every monorepo (`apps/mobile/eas.json`) and anywhere the React
 * Native project is not the top-level one. node_modules, build output, and
 * vendored copies are removed by IGNORED before matching, so the broader
 * pattern does not drag those back in.
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
    // A dependency change is the supply-chain signal worth reviewing. The
    // lockfiles themselves are thousands of lines of hashes — see IGNORED.
    '**/package.json',
    '**/*{auth,Auth,login,Login,token,Token,crypto,Crypto,secure,Secure,session,Session}*',
    '**/*{webview,WebView,deeplink,DeepLink,linking,Linking}*',
    '**/*{api,Api,API,fetch,client,Client,http,Http}*',
  ],
  'rn-performance': [
    '**/*{List,list,Feed,feed,Scroll,scroll,Grid,grid}*',
    '**/*{Animated,animation,Animation,gesture,Gesture,Reanimated}*',
    '**/*{Image,image,Video,video,Media,media}*',
    '**/metro.config.js',
    '**/babel.config.js',
    '**/*{Screen,screen,Page,page}*',
    '**/package.json',
  ],
  'rn-ui-accessibility': [
    '**/*.{tsx,jsx}',
    '**/theme/**',
    '**/styles/**',
    // Requires a component file extension. Without it, the bare word `input`
    // matched every file called `input.txt`, and the accessibility agent was
    // handed a CocoaPods error log and a Gradle config to review.
    '**/*{Button,button,Modal,modal,Form,form,Input,input,Field,field,Picker,Switch,Checkbox}*.{tsx,jsx}',
    '**/*{locale,Locale,i18n,translation}*',
  ],
  'rn-code-quality': ['**/*.{ts,tsx,js,jsx}'],
  'rn-testing': [
    '**/*.{test,spec}.{ts,tsx,js,jsx}',
    '**/__tests__/**',
    '**/e2e/**',
    '**/.maestro/**',
    '**/jest.config.*',
    '**/jest.setup.*',
  ],
  'rn-release': [
    '**/eas.json',
    '**/app.json',
    '**/app.config.*',
    '**/fastlane/**',
    '**/*.gradle',
    '**/Info.plist',
    '**/Podfile*',
    '**/package.json',
    '.github/workflows/**',
  ],
  'rn-observability': [
    '**/*{sentry,Sentry,crashlytics,Crashlytics,newrelic,NewRelic,bugsnag,Bugsnag}*',
    '**/*{telemetry,Telemetry,analytics,Analytics,tracking,Tracking,monitor,Monitor}*',
    // Directory layouts, not just filenames — `src/analytics/events.ts` is the
    // common shape and matches none of the patterns above.
    '**/analytics/**',
    '**/telemetry/**',
    '**/monitoring/**',
    '**/observability/**',
    '**/instrumentation/**',
    '**/proguard-rules.pro',
    '**/sentry.properties',
    '**/.sentryclirc',
    // Root entry files only. SDK init belongs here, and moving it after an
    // `await` silently loses startup crashes.
    //
    // `**\/App.tsx` was deliberately removed: almost every UI change touches
    // App.tsx, so it fired an observability call on unrelated work. Telemetry
    // added elsewhere is still caught by the diff keyword signals below.
    'index.js',
    'index.ts',
    'index.tsx',
  ],
  'rn-native-modules': [
    // Kotlin/Swift/ObjC++ are RN-specific enough to route on their own.
    '**/*.{kt,swift,mm}',
    // .java/.h/.cpp appear in plenty of unrelated contexts, so require a name
    // that indicates a React Native module or component rather than any file.
    '**/*{Module,Manager,Spec,Package,ComponentView,ViewManager,TurboModule}.{java,h,cpp,m}',
    '**/android/src/**/*.{java,h,cpp}',
    '**/ios/**/*.{h,cpp,m}',
    '**/*.podspec',
    '**/Native*.ts',
    '**/*NativeComponent.ts',
    '**/*Spec.ts',
    '**/build.gradle',
    '**/react-native.config.js',
  ],
};

/**
 * Agents that review a changeset, versus ones that need a human to bring a
 * question, an error log, or a request.
 *
 * `rn-doctor` needs a build failure; `rn-build` needs something to build. Firing
 * them at a diff spends tokens to produce a comment with nothing to say, and
 * noise is what gets review bots muted.
 */
export const REVIEW_MODES = new Set(['review', 'both', undefined]);

export function isReviewAgent(agent) {
  return REVIEW_MODES.has(agent.mode);
}

/**
 * Files that never warrant an audit — routing them wastes tokens and produces
 * findings nobody acts on.
 */
export const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  // Eval fixtures are deliberately broken by design — that is their purpose.
  // Routing them produces findings that are accurate about the file and
  // meaningless as review, and they drowned the real findings on PR #11.
  '**/evals/**/input.*',
  '**/__fixtures__/**',
  '**/fixtures/**',
  '**/build/**',
  '**/coverage/**',
  // Every lockfile, consistently. Previously only `*.lock` was excluded, so
  // yarn.lock was skipped while package-lock.json and pnpm-lock.yaml were sent
  // to the model — thousands of lines of hashes for no usable signal.
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/Podfile.lock',
  '**/Gemfile.lock',
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
      // Explicit selection bypasses matching, so every agent sees everything.
      matchedFiles: Object.fromEntries(opts.only.map((id) => [id, files])),
    };
  }

  // Interactive agents can't review a diff — exclude them before scoring so
  // they never consume budget on a pull request.
  const interactive = agents.filter((a) => !isReviewAgent(a));
  for (const a of interactive) reasons[a.id] = ['not a review agent — needs a direct request'];
  const reviewable = agents.filter(isReviewAgent);

  if (files.length === 0) {
    return { files, reasons, selected: [], skipped: [...agents], matchedFiles: {} };
  }

  // Which files matched which agent. Retaining this is what lets the audit send
  // each specialist only its own files instead of one shared diff — the
  // difference between the native agent reliably seeing native code and it
  // being truncated away on a large pull request.
  /** @type {Record<string, string[]>} */
  const matchedFiles = {};

  const scored = reviewable.map((agent) => {
    const why = [];
    const signals = SIGNALS[agent.id] ?? agent.globs ?? [];
    const hits = files.filter((f) => signals.some((g) => matchesGlob(f, g)));
    matchedFiles[agent.id] = hits;

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
    matchedFiles,
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
