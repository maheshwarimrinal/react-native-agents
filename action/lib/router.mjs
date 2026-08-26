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

import { REVIEW_MODES, isReviewAgent } from '../../scripts/lib/source.mjs';

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

/**
 * Filename-keyword globs MUST carry a code-extension filter.
 *
 * `**\/*{StatusBar,SafeArea}*` with no extension matched
 * `res/drawable/safearea_bg.xml`; `**\/*{Linking,DeepLink}*` matched
 * `docs/DeepLinking.md` and routed two agents at a markdown file. Images are
 * already in IGNORED, but XML, Markdown and JSON are not — and Android
 * resource directories are full of the former.
 *
 * Non-code files that genuinely matter (AndroidManifest.xml, Info.plist,
 * google-services.json) are declared explicitly as their own entries, which is
 * the right place for them. `no-extension-less keyword globs` is enforced by a
 * test in action/test.mjs.
 */
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
    '**/*{auth,Auth,login,Login,token,Token,crypto,Crypto,secure,Secure,session,Session}*.{ts,tsx,js,jsx}',
    '**/*{webview,WebView,deeplink,DeepLink,linking,Linking}*.{ts,tsx,js,jsx}',
    '**/*{api,Api,API,fetch,client,Client,http,Http}*.{ts,tsx,js,jsx}',
  ],
  'rn-performance': [
    '**/*{List,list,Feed,feed,Scroll,scroll,Grid,grid}*.{ts,tsx,js,jsx}',
    '**/*{Animated,animation,Animation,gesture,Gesture,Reanimated}*.{ts,tsx,js,jsx}',
    '**/*{Image,image,Video,video,Media,media}*.{ts,tsx,js,jsx}',
    '**/metro.config.js',
    '**/babel.config.js',
    '**/*{Screen,screen,Page,page}*.{ts,tsx,js,jsx}',
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
    '**/*{sentry,Sentry,crashlytics,Crashlytics,newrelic,NewRelic,bugsnag,Bugsnag}*.{ts,tsx,js,jsx}',
    '**/*{telemetry,Telemetry,analytics,Analytics,tracking,Tracking,monitor,Monitor}*.{ts,tsx,js,jsx}',
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
  'rn-payments': [
    '**/*{purchase,Purchase,billing,Billing,subscription,Subscription,paywall,Paywall,iap,IAP}*.{ts,tsx,js,jsx}',
    '**/*{entitlement,Entitlement,receipt,Receipt,storekit,StoreKit,revenuecat,RevenueCat}*.{ts,tsx,js,jsx}',
    '**/{payments,billing,purchases,subscriptions}/**',
  ],
  'rn-background': [
    '**/*{background,Background,headless,Headless,workmanager,WorkManager,bgtask,BGTask}*.{ts,tsx,js,jsx}',
    '**/*{geofenc,Geofenc}*.{ts,tsx,js,jsx}',
    // 'tracking' removed: src/analytics/tracking.ts is analytics, not background
    // location, and rn-observability already owns it.
    // Native declarations are the whole point of this agent — adding
    // UIBackgroundModes or a foregroundServiceType is exactly the change it
    // should review, and it was reaching none of them.
    '**/Info.plist',
    '**/AndroidManifest.xml',
    '**/*.entitlements',
    // Expo declares background capability through config plugins, so these are
    // native declarations too — the agent's own globs already listed them.
    '**/app.json',
    '**/app.config.*',
    // NOT '**/{tasks,jobs,workers}/**'. Those directories hold ordinary code —
    // validateForm.ts, formatInvoice.ts, imageResize.ts all matched and each
    // wasted a model call. A directory name is not evidence of background
    // execution; the diff keywords below carry that.
  ],
  'rn-state': [
    // Anchored to the END of the name. The previous infix pattern matched
    // StorefrontScreen.tsx, Storybook files, and anything else beginning
    // "Store". A state module is conventionally named `<thing>Store.ts`,
    // `<thing>Slice.ts`, `<thing>Atom.ts` — the word is a suffix, not a prefix.
    '**/*{Store,store,Slice,slice,Atom,atom,Reducer,reducer}.{ts,tsx}',
    '**/use*{Store,State}.{ts,tsx}',
    '**/*{Context,context,Provider,provider}.{ts,tsx}',
    '**/{stores,store,state,slices,reducers,atoms}/**',
  ],
  'rn-offline': [
    '**/*{offline,Offline,sync,Sync,queue,Queue,cache,Cache,netinfo,NetInfo}*.{ts,tsx,js,jsx}',
    '**/*{mutation,Mutation,optimistic,Optimistic,retry,Retry}*.{ts,tsx,js,jsx}',
    // `src/offline/storage.ts` matched none of the above: `*offline*` cannot
    // cross a path separator, so a directory named offline/ was invisible.
    '**/offline/**',
    '**/sync/**',
    '**/queue/**',
  ],
  'rn-permissions': [
    // Bare capability nouns matched ordinary UI: PhotoCard.tsx, CameraIcon.tsx,
    // LocationPin.tsx. A component that *displays* a photo does not handle a
    // permission. Match permission vocabulary, or the hook/service/directory
    // shapes where capability access actually lives.
    '**/*{permission,Permission}*.{ts,tsx,js,jsx}',
    '**/use{Camera,Location,Microphone,Contacts,Photos,MediaLibrary}*.{ts,tsx}',
    '**/{permissions,camera,location}/**',
    '**/*{Camera,Location,Microphone,Contacts}{Service,Manager,Provider,Handler}.{ts,tsx}',
    '**/Info.plist',
    '**/AndroidManifest.xml',
  ],
  'rn-navigation': [
    '**/navigation/**',
    '**/*{Navigator,navigator,Router,router,Routes,routes}*.{ts,tsx,js,jsx}',
    '**/*{Linking,linking,DeepLink,deeplink}*.{ts,tsx,js,jsx}',
    // Expo Router derives routes from the filesystem, so a layout file IS
    // routing configuration even though nothing in it says so.
    '**/_layout.{tsx,jsx}',
    '**/apple-app-site-association',
    '**/assetlinks.json',
  ],
  'rn-push': [
    '**/*{notification,Notification,push,Push,messaging,Messaging,fcm,FCM,apns,APNs}*.{ts,tsx,js,jsx}',
    '**/google-services.json',
    '**/GoogleService-Info.plist',
    '**/*.entitlements',
    // Root entry files: the background handler must be registered at module
    // scope here, and registering it anywhere else is the most common
    // structural bug in React Native push.
    'index.js',
    'index.ts',
    'index.tsx',
  ],
  'rn-platform-parity': [
    // Deliberately NOT '**/*.{tsx,jsx}'. That is rn-ui-accessibility's signal,
    // and duplicating it would double-fire two agents on every UI file.
    // Instead: files that are already platform-split, the components where
    // divergence actually breaks flows, and the Android manifest. The `Platform.OS`
    // / `Platform.select` triggers catch the rest from the diff body, where they
    // score higher than a filename match anyway.
    '**/*.{ios,android}.{ts,tsx,js,jsx}',
    '**/*{Keyboard,keyboard,Modal,modal,Sheet,sheet,Picker,picker,DatePicker}*.{tsx,jsx}',
    '**/*{StatusBar,SafeArea,safearea,BackHandler}*.{ts,tsx,js,jsx}',
    '**/AndroidManifest.xml',
  ],
  'rn-upgrade': [
    // Native template + toolchain files. These change during an upgrade and
    // almost never otherwise, which makes them a high-precision signal.
    '**/gradle-wrapper.properties',
    '**/gradle.properties',
    '**/build.gradle',
    '**/Podfile',
    // NOT Podfile.lock — IGNORED drops every *.lock, so declaring it here was a
    // signal that could never fire. The Podfile itself carries the platform
    // version and the pod list, which is the part worth reviewing anyway.
    '**/react-native.config.js',
    '**/metro.config.js',
    '**/babel.config.js',
    // A react-native or expo version change lives here. The diff keyword
    // signals below carry the rest.
    '**/package.json',
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
 * Re-exported, not redefined. The MCP server needs the same answer, and while
 * this module owned the only copy the MCP audit plan listed all twenty-four
 * agents including the seven that cannot act on a diff. One definition, in
 * `scripts/lib/source.mjs`, is what stops that recurring.
 */
export { REVIEW_MODES, isReviewAgent };

/**
 * Files that never warrant an audit — routing them wastes tokens and produces
 * findings nobody acts on.
 */
export const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  // Everything inside an eval case directory (evals/<agent>/<case>/) is fixture
  // data: deliberately broken inputs and their expectation files. Routing them
  // produces findings that are accurate about the file and meaningless as
  // review, which is what drowned the real findings on PR #11.
  //
  // Scoped to the case directory rather than all of evals/ so the harness
  // itself (evals/run.mjs) is still reviewed like any other source file.
  '**/evals/*/*/**',
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
/**
 * Per-agent refinements applied after glob matching.
 *
 * Some files are a strong signal for an agent only under a condition a glob
 * cannot express. `package.json` changes on every dependency addition, but it
 * only indicates an *upgrade* when a version that constrains the toolchain
 * actually moved — so matching it unconditionally put rn-upgrade on every PR
 * that added a library.
 *
 * A refinement returns false to drop a file from that agent's matches. It fails
 * OPEN: with no diff body available it returns true, because silently skipping
 * a specialist is a worse failure than running it unnecessarily.
 */
// Deliberately narrow. '@expo/*' as a wildcard matched @expo/vector-icons and
// every other routine Expo module, which is a dependency add and not an upgrade.
// Only packages that actually constrain the toolchain belong here.
const CORE_VERSION_KEYS =
  /["'](react-native|react|react-dom|expo|@react-native\/[\w.-]+|@react-native-community\/cli[\w.-]*|metro|metro-config|metro-react-native-babel-preset|@expo\/cli|@expo\/config|@expo\/metro-config|expo-modules-(core|autolinking))["']\s*:/;

/**
 * Background-specific keys. A native config file is only evidence for
 * rn-background when one of these appears in the added lines — otherwise every
 * camera-permission string and every unrelated manifest edit pulled the agent
 * in and spent a model call.
 */
const BACKGROUND_KEYS = new RegExp(
  [
    // ---- iOS -------------------------------------------------------------
    'UIBackgroundModes',
    'BGTaskSchedulerPermittedIdentifiers',
    // The *values* under UIBackgroundModes. A diff that adds a mode to an
    // existing array shows only the <string> line, never the key.
    '<string>\\s*(location|audio|fetch|processing|remote-notification|voip|bluetooth-central|bluetooth-peripheral|external-accessory|location-push)\\s*</string>',

    // ---- Android ---------------------------------------------------------
    'ACCESS_BACKGROUND_LOCATION',
    'RECEIVE_BOOT_COMPLETED',
    'SCHEDULE_EXACT_ALARM',
    'USE_EXACT_ALARM',
    'WAKE_LOCK',
    'FOREGROUND_SERVICE',
    'foregroundServiceType',
    // A <service> only matters when it is a background worker. Matching every
    // <service> pulled the agent onto payment and auth services with nothing
    // to say about them.
    'android:name="[^"]*(BackgroundService|SyncService|LocationService|HeadlessJsTaskService|JobService|BootReceiver|Worker)"',

    // ---- Expo config plugins --------------------------------------------
    // Plugins that ARE background execution by definition.
    'expo-background-fetch',
    'expo-background-task',
    'expo-task-manager',
    // expo-location alone is a foreground permission. It only becomes a
    // background concern via these documented properties, so gate on them
    // rather than on the plugin name.
    'isIosBackgroundLocationEnabled',
    'isAndroidBackgroundLocationEnabled',
    'isAndroidForegroundServiceEnabled',
    'UIBackgroundModes.*location',

    // ---- Library / API surface ------------------------------------------
    'react-native-background',
    'BGTaskScheduler',
    'headlessTask',
    'registerHeadlessTask',
    'startLocationUpdatesAsync',
    'defineTask',
  ].join('|'),
  'i',
);

export const REFINEMENTS = {
  'rn-background': (file, diffText) => {
    // Only native config files are gated; source-file signals are specific
    // enough already.
    if (!/(Info\.plist|AndroidManifest\.xml|\.entitlements|app\.json|app\.config\.[jt]s)$/.test(file))
      return true;
    if (!diffText) return true; // fail open
    const added = addedLinesForFile(diffText, file);
    if (added.length === 0) return true;
    return BACKGROUND_KEYS.test(added.join('\n'));
  },

  'rn-upgrade': (file, diffText) => {
    if (!/(^|\/)package\.json$/.test(file)) return true;
    if (!diffText) return true; // fail open
    // Scoped to this file's hunk. Reading the whole diff meant a version string
    // in a README or a JSON snippet counted as a dependency change.
    const added = addedLinesForFile(diffText, file);
    if (added.length === 0) return true; // hunk not found — fail open
    return CORE_VERSION_KEYS.test(added.join('\n'));
  },
};

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
    const refine = REFINEMENTS[agent.id];
    const hits = files
      .filter((f) => signals.some((g) => matchesGlob(f, g)))
      .filter((f) => (refine ? refine(f, opts.diffText) : true));
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
      const lowerTriggers = agent.triggers
        .map((t) => String(t).toLowerCase())
        .filter((t) => t.length > 4);

      // Per file, not across the whole diff. Scoring only needed "did any
      // trigger appear?", but the audit sends each agent ONLY its matchedFiles
      // — so a file that matched on a keyword and not on a filename was
      // scored, routed, and then silently excluded from the prompt. The agent
      // ran on the wrong evidence and reported clean.
      const seen = new Set(hits);
      for (const file of files) {
        const added = addedLinesForFile(opts.diffText, file).join('\n').toLowerCase();
        if (!added) continue;
        const matched = lowerTriggers.filter((t) => added.includes(t));
        if (!matched.length) continue;
        keywordHits.push(...matched);
        if (!seen.has(file)) {
          seen.add(file);
          hits.push(file);
        }
      }
      keywordHits = [...new Set(keywordHits)];
      if (keywordHits.length) why.push(`diff mentions: ${keywordHits.slice(0, 4).join(', ')}`);
      matchedFiles[agent.id] = hits;
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
/**
 * The added lines belonging to a single file's hunk.
 *
 * `addedLines` flattens the entire diff, so a refinement asking "did react-native
 * change?" was answered by any added line anywhere — a README documenting a
 * version string was enough to route rn-upgrade on a pull request whose
 * package.json only added lodash.
 */
export function addedLinesForFile(diffText, filePath) {
  // A diff without any `diff --git` framing cannot be attributed per file —
  // a raw --diff-file, or a hunk pasted by hand. Falling back to every added
  // line is the fail-open choice: mis-attributing a keyword is recoverable,
  // losing every keyword signal is not.
  if (!/^diff --git /m.test(diffText)) return addedLines(diffText);

  const out = [];
  let inFile = false;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git')) {
      // `diff --git a/<path> b/<path>` — match the b-side, which is the
      // post-change path and the one the router is reasoning about.
      inFile = new RegExp(`\\sb/${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(line);
      continue;
    }
    if (!inFile) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) out.push(line.slice(1));
  }
  return out;
}

export function addedLines(diffText) {
  return diffText
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
}
