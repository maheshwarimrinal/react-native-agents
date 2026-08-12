# Monetization Strategy

Internal working document. Last updated 2026-08-12.

---

## The constraint everything else follows from

**Prompts cannot be DRM'd.**

The six agents are markdown that the customer's AI must read in full, in their context window.
Once one paying customer has them, they have them permanently and can paste them into a gist. No
license key, obfuscation, or expiry survives that.

This rules out the obvious model — "premium agent packs for $49" — as a *primary* business. It
leaks on day one, and pay-as-you-go is impossible because there is nothing to meter.

So the question is not "what else can we write?" It is:

> **What can we sell that a copied file cannot give away?**

Three answers, in increasing order of defensibility:

| What you're selling | Pirateable? | Why |
|---|---|---|
| More markdown | Completely | It's a file |
| Markdown + a maintenance promise | Content leaks; updates don't | RN moves fast enough that *staying current* has standing value |
| **Compute and a service** | **No** | The analysis runs on infrastructure we control |

The strategy is the third. The free agents *describe* how to audit a React Native codebase. The
paid product **actually does it**.

---

## Open-core boundary

```
FREE (MIT, github.com/maheshwarimrinal/react-native-agents)
├── 6 agent playbooks + 38 reference documents
├── Multi-tool distribution (Claude Code, Cursor, Windsurf, Copilot, AGENTS.md)
├── MCP server
└── GitHub Action — runs in the customer's CI, with the customer's API key
                                    │
                                    │  the funnel
                                    ▼
PAID (hosted GitHub App)
├── No API key required — we run inference
├── History, trends, and posture over time
├── Cross-repo and org-wide policy
├── Dashboard and reporting
└── Team features: ownership, suppressions, custom rules
```

**The free tier must stand alone and be genuinely excellent.** Open core fails when the free
version feels crippled — you lose the adoption that makes the paid tier viable in the first
place. Nothing already MIT gets relicensed or moved behind the paywall. Ever.

The Action is the pivotal piece. It is free, it is real, and it costs us nothing to operate
because the customer brings their own key. It proves the product works on their code, on their
PRs, before any sales conversation. Then the upgrade pitch writes itself.

---

## Why the Action ships first

| | Free Action (shipped) | Hosted App (next) |
|---|---|---|
| Time to ship | Days | Weeks to months |
| Hosting cost | **$0** | Real |
| Inference COGS | **$0** — customer's key | Ours |
| Billing infra | None | Required |
| Validates demand | **Yes** | Yes, expensively |
| Revenue | $0 | The point |

Building the hosted App first means paying for infrastructure and inference to find out whether
anyone wants automated React Native review. Building the Action first answers that question for
free, and the Action's install count becomes the metric that justifies the App.

---

## Unit economics

These numbers drive the pricing floor. They are estimates and should be replaced with measured
data once the Action has real usage.

### Cost per audit

A full six-agent audit sends each agent its playbook plus its reference library plus the diff:

| Item | Tokens |
|---|---|
| Agent playbook | ~2,000 |
| Reference library (4–8 docs) | ~12,000–25,000 |
| Shared context | ~1,500 |
| Diff | ~2,000–20,000 |
| **Input per agent** | **~18,000–48,000** |
| Output per agent | ~1,000–3,000 |

At Sonnet-class pricing ($3/M in, $15/M out):

- **Per agent:** ~$0.07–0.19
- **All six:** ~$0.42–1.14
- **Routed (2–3 agents, typical):** **~$0.15–0.40**

### Routing is the margin

This is why the router exists. A PR touching only `eas.json` runs one agent, not six.

| Change | Agents routed | Approx. cost |
|---|---|---|
| `eas.json` only | 1 | ~$0.10 |
| One component | 3 | ~$0.30 |
| Auth + manifest | 3 | ~$0.35 |
| Broad refactor | 5–6 | ~$0.80 |

Measured on a representative changeset, routing cuts spend roughly **60–70%** versus running
everything. Further levers available later: prompt caching on the reference libraries (they're
identical across runs — this is the single biggest remaining win), cheaper models for low-risk
file types, and skipping unchanged files on re-runs.

### What that means for pricing

A team merging 100 PRs/month costs **~$15–40/month in raw inference**. Pricing must clear that
plus infrastructure plus margin:

| Tier | Price | Target | Notes |
|---|---|---|---|
| **Free (Action)** | $0 | Individuals, OSS | BYO key. Unlimited. The funnel. |
| **Team** | $49/repo/mo | Small teams | ~$20 COGS at 100 PRs → ~60% margin |
| **Business** | $199/org/mo | 5–20 repos | Volume discount, policy gates, dashboard |
| **Enterprise** | Custom | Regulated / large | SSO, audit logs, self-host, SLA, custom agents |

Seat-based pricing is the wrong shape here — value tracks PR volume and repo count, not
headcount. Watch for the failure mode where a high-volume repo is unprofitable at a flat price;
a fair-use cap with overage is the usual fix.

---

## What the paid tier sells that the Action structurally cannot

This list is the whole argument. Each item is impossible to replicate by copying files:

1. **No API key required.** We run inference. For many teams, getting an LLM key approved through
   procurement is a harder problem than the $49.
2. **History and trend.** "Security findings are up 40% this quarter." A CI job has no memory;
   a database does.
3. **Cross-repo policy.** One org-wide standard enforced across 15 React Native repos, with a
   single place to change it.
4. **Suppression with an audit trail.** "We accept this finding, here's why, signed off by X."
   Teams need this or they abandon any tool that nags.
5. **Dashboard.** Posture by repo, by team, by severity, over time. Engineering managers buy this;
   individual developers do not.
6. **Custom agents.** A company's own conventions and internal libraries encoded as a private
   agent, hosted and versioned.
7. **Baseline mode.** Audit the whole repository, not just the diff — expensive, and only viable
   when someone else manages the compute.
8. **SSO, audit logs, data residency.** The enterprise checklist.

---

## Distribution and billing

**GitHub Marketplace**, chosen for two reasons: discovery is where the buyers already are, and
billing runs through the customer's existing GitHub account, so there is no new payment
relationship to establish. GitHub takes a cut and listing requires review — accepted trade.

Requirements to get listed: a published GitHub App, a verified publisher, a privacy policy, terms
of service, and a support contact. All of that is on the path anyway.

Stripe stays as the fallback for enterprise contracts that Marketplace can't express.

---

## Sequencing

**Now — Free Action.** ✅ Shipped. Routing, budget caps, inline PR comments, sticky summary,
severity gating.

**Next — Adoption.** Get the Action into real React Native repos. The metrics that matter:
installs, PRs audited, and whether anyone re-runs it after the first week. If teams disable it,
the findings aren't good enough and no amount of packaging fixes that.

**Then — Hosted App.** Webhook receiver, inference proxy, findings database, minimal dashboard,
Marketplace listing and billing. Only worth building once the Action shows retention.

**Later — Depth.** Trends, cross-repo policy, custom agents, baseline audits, enterprise controls.

---

## Honest risks

**The findings might not be good enough.** Everything depends on the audit being genuinely
useful. A noisy or wrong reviewer gets muted in a week, and no pricing page saves it. Signal
quality is the product; treat false positives as P0 bugs.

**Model providers could ship this.** GitHub Copilot code review already exists and is improving.
The defensible position is *depth in React Native specifically* — mobile-only failure modes like
OTA runtime mismatches, store rejection patterns, and native-config security that a generalist
reviewer will never cover well. Stay narrow.

**The free tier may be good enough for most people.** Genuinely possible. That's acceptable if
the Action drives enough awareness that the teams who need history, policy, and no-API-key
conversion do so. It is not acceptable to fix by crippling the Action.

**Inference costs move.** They have trended down consistently, which favours us, but a price rise
would compress margins. Prompt caching and model-tier routing are the mitigations to build before
they're needed.

**Solo maintainer risk.** An org buying a CI gate needs confidence it will still exist in a year.
Being open source, with the free tier fully self-hostable, materially de-risks the purchase — and
is worth saying explicitly in sales material.
