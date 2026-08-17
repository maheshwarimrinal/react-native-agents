/**
 * Intent routing for `suggest_agent`.
 *
 * Substring matching against trigger keywords misses the way people actually
 * describe problems. "My large product catalogue is stuttering" is obviously a
 * list-performance question, but contains none of: FlatList, render, fps,
 * performance.
 *
 * So: weighted vocabulary, scored rather than binary, with confidence reported
 * so the caller can tell a strong match from a coin flip.
 */

/**
 * `strong` terms are close to diagnostic on their own.
 * `medium` terms are suggestive but appear across domains.
 * `weak` terms only break ties.
 */
export const SIGNALS = {
  'rn-performance': {
    strong: [
      'slow', 'laggy', 'lag', 'janky', 'jank', 'stutter', 'stuttering', 'freeze', 'freezing',
      'frozen', 'fps', 'frame drop', 'dropped frames', 'choppy', 'sluggish', 'hangs', 'hang',
      'memory leak', 'out of memory', 'oom', 're-render', 'rerender', 'slow startup',
      'takes ages', 'unresponsive', 'bundle size', 'app size', 'cold start', 'tti',
    ],
    medium: [
      'performance', 'optimis', 'optimiz', 'render', 'scroll', 'scrolling', 'list', 'flatlist',
      'flashlist', 'startup', 'launch', 'animation', 'animate', 'bundle', 'memory', 'profil',
      'speed', 'fast', 'heavy', 'expensive', 'infinite scroll', 'pagination', 'image loading',
    ],
    weak: ['catalogue', 'catalog', 'feed', 'grid', 'thousands', 'large dataset', 'many items'],
  },

  'rn-security': {
    strong: [
      'vulnerab', 'exploit', 'insecure', 'security', 'leak', 'leaked', 'hardcoded', 'api key',
      'secret', 'credential', 'penetration', 'pentest', 'owasp', 'masvs', 'certificate pinning',
      'ssl pinning', 'man in the middle', 'mitm', 'reverse engineer', 'decompile', 'jailbreak',
      'rooted', 'obfuscat', 'encrypt', 'cve', 'jwt', 'refresh token', 'store the token',
    ],
    medium: [
      'token', 'auth', 'login', 'password', 'keychain', 'keystore', 'asyncstorage',
      'securestore', 'deep link', 'deeplink', 'webview', 'https', 'tls', 'ssl', 'permission',
      'privacy', 'gdpr', 'pii', 'session', 'oauth', 'biometric', 'storage',
    ],
    weak: ['safe', 'protect', 'sensitive', 'compliance', 'audit'],
  },

  'rn-code-quality': {
    strong: [
      'code review', 'review my', 'refactor', 'clean up', 'cleanup', 'technical debt', 'tech debt',
      'code smell', 'maintainab', 'architecture', 'restructure', 'stale closure', 'antipattern',
      'anti-pattern', 'best practice',
    ],
    medium: [
      'typescript', 'types', 'any type', 'useeffect', 'hook', 'state management', 'redux',
      'zustand', 'context', 'error handling', 'folder structure', 'organis', 'organiz',
      'naming', 'duplicate', 'lint', 'eslint',
    ],
    weak: ['readable', 'messy', 'confusing', 'improve', 'better way', 'idiomatic'],
  },

  'rn-ui-accessibility': {
    strong: [
      'accessib', 'a11y', 'screen reader', 'voiceover', 'talkback', 'contrast', 'colour blind',
      'color blind', 'dark mode', 'wcag', 'dynamic type', 'font scaling', 'rtl', 'right to left',
      'safe area', 'notch', 'keyboard covers', 'keyboard hides', 'edge to edge',
    ],
    medium: [
      'layout', 'responsive', 'tablet', 'landscape', 'rotation', 'foldable', 'theme', 'theming',
      'styling', 'design system', 'spacing', 'typography', 'keyboard', 'modal', 'animation',
      'haptic', 'empty state', 'loading state', 'skeleton', 'i18n', 'translation', 'localis',
      'localiz',
    ],
    weak: ['ui', 'ux', 'looks', 'visual', 'design', 'button', 'screen size'],
  },

  'rn-testing': {
    strong: [
      'write tests', 'unit test', 'test coverage', 'flaky', 'flakey', 'testing library', 'rntl',
      'jest', 'detox', 'maestro', 'e2e', 'end to end', 'mock', 'mocking', 'snapshot test',
      'test fails', 'failing test', 'tests fail', 'tests keep failing', 'test flake', 'intermittent',
    ],
    medium: ['test', 'spec', 'coverage', 'assertion', 'fixture', 'stub', 'ci pipeline'],
    weak: ['verify', 'regression', 'confidence'],
  },

  'rn-doctor': {
    strong: [
      'build failed', 'build fails', 'build error', 'wont build', "won't build", 'does not build',
      'pod install', 'gradle', 'cocoapods', 'unable to resolve module', 'module not found',
      'could not find', 'duplicate class', 'command failed', 'command phasescriptexecution',
      'works on my machine', 'clean build', 'deriveddata', 'watchman', 'metro bundler',
      'compilation failed', 'execution failed for task', 'sdk location not found',
      'sandbox is not in sync', 'no such module', 'undefined symbols',
      'version conflict', 'version mismatch', 'incompatible version', 'kotlin version',
      'gradle version', 'agp version', 'jdk version', 'duplicate class', 'dependency conflict',
      'build fails', 'android build', 'ios build', 'fails to build', 'wont compile',
    ],
    medium: [
      'error', 'failing', 'broken', 'stuck', 'cache', 'xcode', 'android studio', 'jdk', 'java',
      'node_modules', 'reinstall', 'after upgrade', 'after pull', 'ci fails', 'compile',
    ],
    weak: ['setup', 'install', 'environment', 'toolchain'],
  },

  'rn-build': {
    strong: [
      'create a screen', 'build a screen', 'new screen', 'add a component', 'create a component',
      'build a component', 'implement', 'scaffold', 'write a form', 'add a form', 'build a list',
      'how do i build', 'how do i create', 'generate a',
      'create a', 'new checkout', 'implement a screen', 'implement a component',
      'build me', 'write a screen', 'write a component', 'add a screen',
    ],
    medium: ['screen', 'component', 'form', 'modal', 'card', 'bottom sheet', 'add a'],
    // Deliberately narrow. Bare verbs like "make" or "new" match almost any
    // sentence and drag unrelated questions into this agent.
    weak: ['need a component', 'need a screen'],
  },

  'rn-native-modules': {
    strong: [
      'native module', 'turbomodule', 'turbo module', 'fabric', 'jsi', 'codegen',
      'native component', 'bridge module', 'podspec', 'autolinking', 'objective-c', 'objc',
      'swift module', 'kotlin module', 'viewmanager', 'new architecture migration',
      'rctbridgemodule', 'requirenativecomponent', 'host object',
    ],
    medium: [
      'native', 'swift', 'kotlin', 'java', 'c++', 'cpp', 'spec', 'thread', 'main queue',
      'native code', 'platform code', 'bridging header',
    ],
    weak: ['ios side', 'android side', 'wrap'],
  },

  'rn-observability': {
    strong: [
      'crash reporting', 'crashlytics', 'sentry', 'new relic', 'newrelic', 'bugsnag',
      'symbolicat', 'dsym', 'source map', 'sourcemap', 'stack trace', 'unreadable stack',
      'no crashes', 'not reporting', 'not showing up', 'crash-free', 'crash free',
      'breadcrumb', 'distributed tracing', 'session replay', 'observability', 'telemetry',
      'instrumentation', 'proguard rules', 'minified stack',
    ],
    medium: [
      'monitoring', 'analytics', 'metrics', 'logging', 'alerting', 'dashboard', 'tracing',
      'custom event', 'error tracking', 'apm', 'proguard', 'release health', 'anr',
    ],
    weak: ['visibility', 'insight', 'report', 'track'],
  },

  'rn-upgrade': {
    strong: [
      'upgrade', 'upgrading', 'migrate to', 'migration', 'new architecture', 'newarch',
      'fabric', 'turbomodule', 'turbo module', 'bridgeless', 'interop layer', 'codegen',
      'upgrade helper', 'version bump', 'bump react native', 'expo sdk', 'sdk upgrade',
      'breaking change', 'view flattening', 'react native version',
    ],
    medium: [
      'deprecated', 'no longer works', 'after upgrading', 'since upgrading', 'older version',
      'latest version', 'compatib', 'peer dependency', 'scope move', 'renamed package',
      'gradle version', 'kotlin version', 'ref is null',
    ],
    weak: ['0.7', '0.8', 'behind', 'outdated', 'legacy', 'modernis', 'moderniz'],
  },

  'rn-dependencies': {
    strong: [
      'should i use', 'should i add', 'which library', 'which package', 'alternative to',
      'instead of', 'replace this library', 'unmaintained', 'abandoned', 'is it maintained',
      'do we need a library', 'worth adding', 'library health', 'add a dependency',
      'remove a dependency', 'drop the dependency',
    ],
    medium: [
      'dependency', 'dependencies', 'package', 'npm', 'yarn', 'library', 'third party',
      'bundle cost', 'weekly downloads', 'last published', 'fork', 'patch-package',
      'transitive', 'native dependency',
    ],
    weak: ['compare', 'versus', ' vs ', 'options', 'recommend', 'popular'],
  },

  'rn-debug': {
    strong: [
      'infinite loop', 'infinite render', 'render loop', 'not updating', 'state not updating',
      'cannot reproduce', "can't reproduce", 'only in release', 'only in production',
      'works in debug', 'silently fails', 'nothing happens', 'no error', 'blank screen',
      'white screen', 'debugger', 'devtools', 'flipper', 'breakpoint', 'stale closure',
    ],
    medium: [
      'debug', 'debugging', 'why does', 'why is', 'not working', 'unexpected', 'weird',
      'strange', 'inconsistent', 'intermittent', 'sometimes', 'console.log', 'logging',
      'stuck', 'behaves differently',
    ],
    weak: ['investigate', 'track down', 'figure out', 'diagnose', 'root cause'],
  },

  'rn-navigation': {
    strong: [
      'deep link', 'deeplink', 'universal link', 'app link', 'navigation', 'navigator',
      'react navigation', 'expo router', 'wrong screen', 'nested screen', 'nested navigator',
      'back button goes', 'auth guard', 'protected route', 'redirect after login',
      'opens the home screen', 'route params', 'linking config',
    ],
    medium: [
      'screen', 'route', 'routing', 'stack', 'tab', 'modal', 'navigate', 'goback',
      'go back', 'cold start', 'assetlinks', 'apple-app-site-association', 'push a screen',
    ],
    weak: ['flow', 'journey', 'transition', 'header', 'params'],
  },

  'rn-push': {
    strong: [
      'push notification', 'notifications not', 'notification not', 'apns', 'fcm',
      'firebase messaging', 'device token', 'silent push', 'data-only', 'background handler',
      'notification channel', 'badge count', 'notifee', 'onmessage', 'getinitialnotification',
      'setbackgroundmessagehandler', 'not receiving notifications',
    ],
    medium: [
      'notification', 'notify', 'alert the user', 'token refresh', 'registration',
      'app is closed', 'app is killed', 'foreground', 'background', 'tapped',
      'post_notifications', 'provisional',
    ],
    weak: ['badge', 'sound', 'banner', 'remind'],
  },

  'rn-platform-parity': {
    strong: [
      'only on android', 'only on ios', 'works on ios but', 'works on android but',
      'different on android', 'different on ios', 'platform.select', 'platform.os',
      'keyboardavoidingview', 'keyboard covers', 'safe area', 'notch', 'hardware back',
      'back button exits', 'elevation', 'shadow not showing', 'status bar',
    ],
    medium: [
      'android', 'ios', 'platform', 'both platforms', 'cross platform', 'divergence',
      'inconsistent between', 'keyboard', 'insets', 'scroll physics', 'date picker',
    ],
    weak: ['device', 'simulator', 'emulator', 'looks wrong', 'layout'],
  },

  'rn-permissions': {
    strong: [
      'permission denied', 'permission blocked', 'never ask again', 'requestpermission',
      'usage description', 'nsusagedescription', 'purpose string', 'opensettings',
      'permission rationale', 'camera access', 'location access', 'photo library access',
      'microphone access', 'permission prompt', 'allow button does nothing',
    ],
    medium: [
      'permission', 'permissions', 'grant', 'granted', 'denied', 'blocked', 'limited',
      'settings', 'prompt', 'ask the user', 'camera', 'location', 'microphone', 'contacts',
    ],
    weak: ['access', 'allow', 'privacy', 'request'],
  },

  'rn-offline': {
    strong: [
      'offline', 'offline-first', 'no connection', 'bad connection', 'poor network',
      'netinfo', 'mutation queue', 'sync queue', 'background sync', 'optimistic update',
      'conflict resolution', 'idempotency', 'data disappears', 'changes are lost',
      'did not save', "didn't save", 'retry storm', 'stale cache',
    ],
    medium: [
      'sync', 'syncing', 'queue', 'retry', 'backoff', 'cache', 'cached', 'persist',
      'network error', 'timeout', 'reconnect', 'flaky network', 'airplane mode',
    ],
    weak: ['train', 'tunnel', 'signal', 'connectivity', 'unreliable'],
  },

  'rn-state': {
    strong: [
      'state management', 'zustand', 'redux', 'redux toolkit', 'jotai', 'recoil', 'mobx',
      'global state', 'server state', 'react query', 'tanstack query', 'selector',
      'store re-render', 'hydration', 'persist the store', 'context re-render',
      'which state library', 'normalise state', 'normalize state',
    ],
    medium: [
      'store', 'state', 'context', 'provider', 'usecontext', 'slice', 'reducer', 'atom',
      'derived state', 'single source of truth', 'persisted', 'rehydrate', 'boilerplate',
    ],
    weak: ['shape', 'structure', 'architecture', 'organise', 'organize'],
  },

  'rn-store-submission': {
    strong: [
      'rejected', 'rejection', 'app review', 'app store review', 'guideline', 'resubmit',
      'privacy manifest', 'nutrition label', 'data safety', 'app tracking transparency',
      'att prompt', 'target api level', 'account deletion', 'metadata rejected',
      'privacyinfo', 'review team', 'appeal', 'binary rejected',
    ],
    medium: [
      'app store', 'play store', 'google play', 'submission', 'submit', 'reviewer',
      'store listing', 'screenshots', 'age rating', 'demo account', 'testflight',
      'compliance', 'policy',
    ],
    weak: ['approval', 'publish', 'launch', 'live'],
  },

  'rn-onboard': {
    strong: [
      'new codebase', 'unfamiliar codebase', 'inherited', 'taking over', 'took over',
      'just joined', 'onboarding', 'no documentation', 'no handover', 'where do i start',
      'explain this project', 'explain this codebase', 'architecture overview',
      'code walkthrough', 'quote', 'scoping', 'audit before',
    ],
    medium: [
      'where is', 'how does this app', 'what does this do', 'understand the', 'get up to speed',
      'previous developer', 'previous agency', 'legacy project', 'client app', 'map the',
    ],
    weak: ['overview', 'tour', 'orient', 'first day', 'unfamiliar'],
  },

  'rn-release': {
    strong: [
      // 'app store', 'play store', 'rejected' and 'rejection' moved to
      // rn-store-submission, which owns review triage. rn-release ends at a
      // signed artefact; what a reviewer then says about it is a different job,
      // and leaving them here produced an exact score tie on
      // "App Store rejected the privacy manifest".
      'code signing', 'provisioning',
      'keystore', 'certificate expired', 'eas build', 'eas submit', 'fastlane', 'ota',
      'over the air', 'expo-updates', 'codepush', 'rollout', 'rollback', 'crash on launch',
      'testflight', 'versioning', 'build number', 'runtime version',
    ],
    medium: [
      // 'store' and 'submission' are too generic now that rn-store-submission
      // and rn-state exist — 'store' fired on both "App Store" and "the store".
      'release', 'deploy', 'publish', 'build', 'ship', 'signing',
      'staged',
      // 'sentry', 'crash', 'monitoring', and 'source map' moved to
      // rn-observability, which owns diagnosis. Release keeps the rollout-specific
      // terms ('crash on launch', 'rollback') in its strong list.
    ],
    weak: ['production', 'launch', 'version'],
  },
};

const WEIGHT = { strong: 5, medium: 2, weak: 1 };

/**
 * Score a free-text task description against every agent.
 *
 * @param {string} task
 * @param {object[]} agents
 * @returns {{ id:string, agent:object, score:number, confidence:'high'|'medium'|'low', matched:string[] }[]}
 */
export function scoreAgents(task, agents) {
  const text = ` ${String(task ?? '').toLowerCase()} `;

  const results = agents.map((agent) => {
    const sig = SIGNALS[agent.id];
    const matched = [];
    let score = 0;

    if (sig) {
      for (const tier of ['strong', 'medium', 'weak']) {
        for (const term of sig[tier] ?? []) {
          if (text.includes(term)) {
            score += WEIGHT[tier];
            matched.push(term);
          }
        }
      }
    }

    // The agent's own declared triggers still count — they're authored metadata
    // and stay in sync with the playbook automatically.
    for (const t of agent.triggers ?? []) {
      const term = String(t).toLowerCase();
      if (term.length > 3 && text.includes(term) && !matched.includes(term)) {
        score += WEIGHT.medium;
        matched.push(term);
      }
    }

    return { id: agent.id, agent, score, matched };
  });

  const ranked = results.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;
  const second = ranked[1]?.score ?? 0;

  return ranked.map((r, i) => ({
    ...r,
    confidence:
      i === 0 && top >= 5 && top >= second * 2
        ? 'high'
        : r.score >= 5
          ? 'medium'
          : 'low',
  }));
}

/**
 * Human-readable routing recommendation.
 * Deliberately admits uncertainty instead of always naming a winner — a
 * confidently wrong route wastes more of the user's time than "I'm not sure".
 */
export function explainRouting(task, agents) {
  const ranked = scoreAgents(task, agents);

  if (ranked.length === 0) {
    return {
      ranked,
      text: [
        'No specialist clearly matches that description.',
        '',
        'Either call `list_react_native_agents` and choose directly, or use `get_audit_plan`',
        'if you want a broad review across every review specialist.',
      ].join('\n'),
    };
  }

  const lines = ['# Suggested specialists', ''];

  for (const [i, r] of ranked.slice(0, 3).entries()) {
    const badge = r.confidence === 'high' ? '**best match**' : r.confidence === 'medium' ? 'likely' : 'possible';
    lines.push(
      `${i + 1}. **${r.agent.title ?? r.agent.name}** (\`${r.id}\`) — ${badge}, score ${r.score}`,
      `   ${r.agent.description}`,
      `   <sub>matched: ${r.matched.slice(0, 6).join(', ')}</sub>`,
      '',
    );
  }

  if (ranked[0].confidence === 'low') {
    lines.push(
      '_No strong signal here — the top match is a guess. Consider `get_audit_plan` for a',
      'broader review, or ask the user which area they mean._',
      '',
    );
  }

  lines.push(`Load with: \`get_react_native_agent({ agent_id: "${ranked[0].id}" })\``);
  return { ranked, text: lines.join('\n') };
}
