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

  'rn-release': {
    strong: [
      'app store', 'play store', 'rejected', 'rejection', 'code signing', 'provisioning',
      'keystore', 'certificate expired', 'eas build', 'eas submit', 'fastlane', 'ota',
      'over the air', 'expo-updates', 'codepush', 'rollout', 'rollback', 'crash on launch',
      'testflight', 'versioning', 'build number', 'runtime version',
    ],
    medium: [
      'release', 'deploy', 'publish', 'build', 'ship', 'submission', 'store', 'signing',
      'sourcemap', 'source map', 'sentry', 'crash', 'monitoring', 'staged',
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
        'if you want a broad review across all six.',
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
