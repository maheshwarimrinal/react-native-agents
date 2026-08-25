/**
 * Minimal multi-provider LLM client — Anthropic and OpenAI, over plain fetch.
 *
 * No SDK dependency, consistent with the rest of the project. Also includes a
 * `mock` provider so the whole pipeline is testable in CI without an API key
 * or a network call.
 */

/** Approximate USD per million tokens. Used for budgeting, not billing. */
/**
 * Approximate USD per million tokens, for **estimating** spend.
 *
 * This is not a cap and must not be described as one. Prices change, token
 * counts are estimated before the call, and a model absent from this table is
 * priced by the fallback below. The gpt-5-mini output price was previously
 * listed at 1.6 against an actual 2.0, so a budget presented as a guarantee
 * could be exceeded by a quarter without anything noticing.
 *
 * Verified against provider pricing pages on 2026-08-24; re-check when adding a
 * model. Over-stating a price is not the safe direction it looks like: it ends
 * runs early and reports spend that never happened.
 */
export const PRICING = {
  // Anthropic. Sonnet 5's $2/$10 was introductory pricing through 2026-08-31;
  // Anthropic has since made it the standard price, and the scheduled rise to
  // $3/$15 was cancelled. Opus 5 is $5/$25 — the $15/$75 previously here is
  // Opus 4.1/4 pricing, which is three times too high and exhausted budgets
  // that had plenty left.
  'claude-fable-5': { in: 10, out: 50 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  // OpenAI.
  'gpt-5': { in: 1.25, out: 10 },
  'gpt-5-mini': { in: 0.25, out: 2 },
};

/**
 * Price for a model this table has never heard of.
 *
 * Deliberately the *dearest* known rate, not the average. Under-estimating an
 * unknown model overspends silently; over-estimating stops the run early and
 * says why, which is the failure you can see.
 *
 * Derived from the table rather than written down, so correcting a price above
 * cannot leave a stale literal here — which is exactly how `default` ended up
 * at retired Opus 4.1 pricing while every real model had moved.
 */
PRICING.default = {
  in: Math.max(...Object.values(PRICING).map((p) => p.in)),
  out: Math.max(...Object.values(PRICING).map((p) => p.out)),
};

/** Models whose price is known rather than assumed. */
export const PRICED_MODELS = new Set(
  Object.keys(PRICING).filter((k) => k !== 'default'),
);

/**
 * Rough token estimate. Deliberately conservative — it exists to stop a
 * runaway spend before the call, not to be exact. Code tokenizes denser than
 * prose, so ~3.5 chars/token is closer than the usual 4.
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 3.5);
}

export function estimateCost(model, inTokens, outTokens) {
  const p = PRICING[model] ?? PRICING.default;
  return (inTokens / 1e6) * p.in + (outTokens / 1e6) * p.out;
}

export class BudgetExceededError extends Error {
  constructor(spent, cap) {
    super(`Budget cap reached: estimated $${spent.toFixed(3)} exceeds cap $${cap.toFixed(2)}`);
    this.name = 'BudgetExceededError';
    this.spent = spent;
    this.cap = cap;
  }
}

export class LLM {
  /**
   * @param {object} opts
   * @param {'anthropic'|'openai'|'mock'} opts.provider
   * @param {string} opts.apiKey
   * @param {string} opts.model
   * @param {number} [opts.budgetUsd]  estimated preflight budget across all
   *   calls in this run; checked before each call, not enforced during one
   * @param {number} [opts.maxOutputTokens]
   * @param {(msg:string)=>void} [opts.log]
   */
  constructor({
    provider,
    apiKey,
    model,
    budgetUsd = 2,
    maxOutputTokens = 8000,
    baseUrl,
    log = () => {},
  }) {
    // A typo like 'opneai' previously selected the Anthropic key and the Claude
    // default model, then went down the OpenAI request path — surfacing as an
    // auth or model error that hides the actual mistake.
    const KNOWN_PROVIDERS = ['anthropic', 'openai', 'mock'];
    if (!KNOWN_PROVIDERS.includes(provider)) {
      throw new Error(
        `Unknown provider "${provider}". Expected one of: ${KNOWN_PROVIDERS.join(', ')}.`,
      );
    }
    this.provider = provider;
    /**
     * Override the API host. The `openai` provider speaks the standard
     * /v1/chat/completions shape, which nearly every other provider and every
     * local runtime also implements — so this one option covers Ollama, Groq,
     * OpenRouter, GitHub Models, Gemini's compatibility endpoint, and any
     * self-hosted gateway, without a provider implementation for each.
     */
    this.baseUrl = (baseUrl ?? process.env.OPENAI_BASE_URL ?? '').replace(/\/+$/, '');

    /**
     * A locally-hosted model costs nothing, so budgeting it is meaningless —
     * and actively harmful. An unknown model name falls back to the default
     * price, which meant a free Ollama run was billed at the dearest rate in
     * the table and aborted on any small budget.
     *
     * Scoped to the provider that actually uses `baseUrl`. `OPENAI_BASE_URL` is
     * read from the environment, so a developer who had once pointed it at
     * Ollama left it set, ran an **Anthropic** audit, and got no budgeting at
     * all: every call priced at zero, the cap never reached, real money spent
     * against api.anthropic.com. The Anthropic path never consults `baseUrl`,
     * so it can never be local, and treating it as free was purely a bug.
     */
    this.isLocal =
      provider === 'openai' &&
      /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(this.baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.budgetUsd = budgetUsd;
    this.pricingKnown = this.isLocal || provider === 'mock' || PRICED_MODELS.has(model);
    this.maxOutputTokens = maxOutputTokens;
    this.log = log;
    // Surfaced rather than silent: a budget computed from a guessed price is an
    // estimate with a wide error bar, and the caller should know which it has.
    if (!this.pricingKnown) {
      this.log(
        `  ⚠ No published price for "${model}" — budgeting at the most expensive ` +
          `known rate. The budget is an estimate, not a hard cap.`,
      );
    }
    this.spentUsd = 0;
    this.calls = 0;
    this.inTokens = 0;
    this.outTokens = 0;
  }

  /** Local models are free; never let a phantom price stop the run. */
  #cost(inTokens, outTokens) {
    return this.isLocal ? 0 : estimateCost(this.model, inTokens, outTokens);
  }

  /** Would this call push us over budget? Checked *before* spending. */
  wouldExceed(promptText) {
    const projected =
      this.spentUsd +
      this.#cost(estimateTokens(promptText), this.maxOutputTokens);
    return projected > this.budgetUsd;
  }

  async complete({ system, user }) {
    const promptText = `${system}\n${user}`;

    if (this.wouldExceed(promptText)) {
      const projected =
        this.spentUsd + this.#cost(estimateTokens(promptText), this.maxOutputTokens);
      throw new BudgetExceededError(projected, this.budgetUsd);
    }

    if (this.provider === 'mock') return this.#mock({ system, user });

    const started = Date.now();
    const res =
      this.provider === 'anthropic'
        ? await this.#anthropic({ system, user })
        : await this.#openai({ system, user });

    this.calls += 1;
    this.inTokens += res.usage.input;
    this.outTokens += res.usage.output;
    this.spentUsd += this.#cost(res.usage.input, res.usage.output);
    this.log(
      `  ${this.model}: ${res.usage.input} in / ${res.usage.output} out · ` +
        `$${this.spentUsd.toFixed(3)} cumulative · ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return res.text;
  }

  async #anthropic({ system, user }) {
    const r = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`Anthropic API: ${j.error.message}`);
    return {
      text: (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
      usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 },
    };
  }

  async #openai({ system, user }) {
    const endpoint = `${this.baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
    const r = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: this.maxOutputTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`OpenAI API: ${j.error.message}`);
    return {
      text: j.choices?.[0]?.message?.content ?? '',
      usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 },
    };
  }

  /** Deterministic stand-in so the pipeline can be exercised offline. */
  #mock({ user }) {
    this.calls += 1;
    const m = user.match(/^\s*(\d+)\s\+.*$/m);
    const line = m ? Number(m[1]) : 1;
    const fileMatch = user.match(/^### (\S+)/m);
    const file = fileMatch ? fileMatch[1] : 'src/unknown.tsx';
    return JSON.stringify({
      findings: [
        {
          severity: 'P2',
          title: 'Mock finding for pipeline testing',
          file,
          line,
          why: 'Emitted by the mock provider so the engine can be tested without an API key.',
          fix: 'No action needed — this is a test fixture.',
          verify: 'n/a',
        },
      ],
      summary: 'Mock provider run.',
    });
  }
}

async function fetchWithRetry(url, init, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, init);
      // Retry transient failures; fail fast on client errors like a bad key.
      if (r.status === 429 || r.status >= 500) {
        const retryAfter = Number(r.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** i * 1000 + Math.random() * 400, 20000);
        if (i < attempts - 1) {
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
      }
      if (!r.ok && r.status < 500 && r.status !== 429) {
        throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      }
      return r;
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) throw err;
      await new Promise((res) => setTimeout(res, 2 ** i * 1000));
    }
  }
  throw lastErr;
}
