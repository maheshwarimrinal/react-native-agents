/**
 * Minimal multi-provider LLM client — Anthropic and OpenAI, over plain fetch.
 *
 * No SDK dependency, consistent with the rest of the project. Also includes a
 * `mock` provider so the whole pipeline is testable in CI without an API key
 * or a network call.
 */

/** Approximate USD per million tokens. Used for budgeting, not billing. */
export const PRICING = {
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 15, out: 75 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'gpt-5': { in: 2.5, out: 10 },
  'gpt-5-mini': { in: 0.4, out: 1.6 },
  default: { in: 3, out: 15 },
};

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
   * @param {number} [opts.budgetUsd]  hard cap across all calls in this run
   * @param {number} [opts.maxOutputTokens]
   * @param {(msg:string)=>void} [opts.log]
   */
  constructor({ provider, apiKey, model, budgetUsd = 2, maxOutputTokens = 8000, log = () => {} }) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
    this.budgetUsd = budgetUsd;
    this.maxOutputTokens = maxOutputTokens;
    this.log = log;
    this.spentUsd = 0;
    this.calls = 0;
    this.inTokens = 0;
    this.outTokens = 0;
  }

  /** Would this call push us over budget? Checked *before* spending. */
  wouldExceed(promptText) {
    const projected =
      this.spentUsd +
      estimateCost(this.model, estimateTokens(promptText), this.maxOutputTokens);
    return projected > this.budgetUsd;
  }

  async complete({ system, user }) {
    const promptText = `${system}\n${user}`;

    if (this.wouldExceed(promptText)) {
      const projected =
        this.spentUsd + estimateCost(this.model, estimateTokens(promptText), this.maxOutputTokens);
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
    this.spentUsd += estimateCost(this.model, res.usage.input, res.usage.output);
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
    const r = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
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
