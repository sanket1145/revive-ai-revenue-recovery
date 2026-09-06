# REVIVE — AI Revenue Incident Commander

**Live demo:** https://revive-ai-revenue-incident-commander.lovable.app

Merchant-level revenue incident command centre for Indian payments (Razorpay
AI Revenue Recovery track). REVIVE detects sudden payment success-rate
degradation, investigates the root cause with AI over measured ledger data,
quantifies the revenue at risk, and recommends bounded recovery actions that
must pass a deterministic policy engine before any test-mode execution.
AI Revenue Recovery track). REVIVE detects sudden payment success-rate
degradation, investigates the root cause with AI over measured ledger data,
quantifies the revenue at risk, and recommends bounded recovery actions that
must pass a deterministic policy engine before any test-mode execution.

## The problem

A merchant's payment rails degrade silently: a UPI PSP starts timing out, one
issuer's 3DS ACS goes down, a mandate batch gets rejected. The merchant finds
out hours later from a revenue report, with no idea which rail, which issuer,
or how much money was lost. REVIVE closes that gap: detect within the next
30-minute window, explain it with evidence, and recover what is safely
recoverable — under human control.

## Pages

- **Overview** — Revenue Today, Revenue at Risk, Revenue Recovered, Recovery
  Rate, Active Incidents, revenue trend, success-rate trace with baseline,
  payment-method mix, risk by incident.
- **Revenue Incidents** — detected incidents with severity, drop, z-score,
  revenue at risk and lifecycle status.
- **Incident Investigation** — measured metrics, evidence signals, segment
  attribution, failure mix, AI root-cause diagnosis with confidence, and the
  recovery pipeline.
- **Recovery Actions** — proposed actions with policy verdicts, human
  approve/reject gate, canary execution results, counterfactual panel.
- **Audit Trail** — append-only ledger of every detection, diagnosis, policy
  verdict, approval, execution and verification event.

## Architecture

- **Frontend:** TanStack Start (React 19, Vite 7), Tailwind CSS v4, TanStack
  Query. All pages render from typed DTOs with deterministic IST/paise
  formatting (SSR-safe, no hydration drift).
- **Backend:** Lovable Cloud (Postgres). App-internal logic runs as TanStack
  server functions; the browser reads only public projection tables with RLS
  (`dashboard_snapshot`, `incident_reports`, `incidents`, `audit_events`,
  `dataset_meta`). The raw `transactions` ledger is deny-all to clients.

### Data model

- `transactions` — immutable attempt ledger (96,622 seeded attempts,
  25 Aug → 3 Sep 2026 IST): amount in paise, method, issuer, PSP, status,
  failure reason, latency, device/city/customer segment, retry chain.
- `incidents` — idempotent natural key, scope, detection window, baseline vs
  observed rates, drop, z-score, revenue at risk, AI fields
  (`root_cause`, `diagnosis`, `confidence`, `evidence`), `recovery_score`.
- `audit_events` — append-only audit ledger.
- `dataset_meta`, `dashboard_snapshot`, `incident_reports` — provenance and
  read projections.

### Deterministic detection (`rolling-baseline-z-v1`)

Pure SQL (`public.revive_detect_incidents()`), fully reproducible:
30-minute windows across method and method×issuer scopes, trailing 7-day
baseline with a 2-hour guard band, volume floors (≥20 window / ≥300 baseline
attempts), a window is flagged only when all three hold — ≥8 pp absolute
drop, ≥15% relative drop, two-proportion z ≥ 3.0 — and an incident opens
after 2 consecutive flagged windows. Overlap suppression keeps either the
rail-wide or the issuer-scoped incident, never both. Every threshold is
stored on the incident row. See `docs/detection-rule.md`.

### AI investigation

Each incident can be investigated on demand: the model (Gemini via the
Lovable AI gateway, strict JSON schema) receives **only measured ledger
aggregates** — rates, drops, z-score, failure mix, segments — and returns a
root-cause hypothesis, a confidence score, and cited evidence. It never sees
raw transactions and is instructed never to invent a number. A separate
deterministic recovery-opportunity score (0–100 over five factors) ranks
which incidents are worth acting on.

### Safety pipeline

The AI never executes anything. Every action flows:

```text
AI Recommendation → Policy Engine → Approved / Blocked → Test Action → Verification → Audit Log
```

- **Policy engine (deterministic):** confidence threshold, failure-reason
  eligibility, per-transaction ceiling, retry-count limit + cooldown,
  idempotency guard, exposure ceiling → `approved` / `requires_approval` /
  `blocked`. High-exposure or customer-facing actions always route to a
  human approver.
- **Canary execution:** capped at 50 transactions, Razorpay-compatible test
  mode only. Outcomes derive from a deterministic recovery-propensity map
  per failure reason.
- **Verification:** attempted / recovered / failed / recovery rate and
  remaining revenue at risk are recomputed from the ledger, not from what
  the executor claims.
- **Counterfactual:** measured shortfall vs measured recovery, side by side.
- **Audit:** every stage is written to the append-only ledger.

## Dataset

Deterministic, md5-keyed seeded synthetic data (no `random()`/`now()`), with
four injected incidents the detector must rediscover from signal alone — it
never reads the scenario tags: a UPI collect PSP timeout, an SBI card 3DS
outage, an e-NACH batch rejection, and a resolved netbanking PSP outage.
The detector recovers all four at the correct scope with zero false
positives across 96 windows × 4 scopes.

## Setup

Prerequisites: Node.js 20+ (or Bun).

```sh
git clone <repo-url>
cd revive-ai-revenue-recovery
bun install        # or: npm install
bun run dev        # or: npm run dev
```

Environment variables (Supabase URL + publishable key) are supplied by the
hosting environment; on Lovable they are injected automatically. See
`.env.example`-style placeholders — no secrets are committed to this
repository.

## Limitation

Recovery execution is a **test-mode simulation**: REVIVE holds no live
payment credentials and never touches real money. Per-transaction canary
outcomes come from a deterministic recovery-propensity model, not a live
PSP response. Production wiring would replace the executor with the PSP's
live API behind the same policy engine.

## Built with

TanStack Start · TypeScript · React · Tailwind CSS · Lovable Cloud (Postgres)
· Lovable AI gateway
