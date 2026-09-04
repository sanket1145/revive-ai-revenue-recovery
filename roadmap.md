# REVIVE AI — Build Roadmap

Track 03 (AI Revenue Recovery). Merchant-level revenue incident commander.

## Step 1 — Data foundation + deterministic detection (COMPLETE)

- [x] Enable Lovable Cloud backend (Postgres)
- [x] Schema: `transactions`, `incidents`, `audit_events`, `dataset_meta`, plus
      `dashboard_snapshot` / `incident_reports` read projections
- [x] Deterministic seeded synthetic dataset (96,622 attempts, 25 Aug → 3 Sep 2026,
      4 injected incidents, md5-keyed PRNG, no `random()`/`now()`)
- [x] Deterministic incident-detection service (`rolling-baseline-z-v1`:
      30-min windows, 7-day guarded baseline, ≥8 pp + ≥15% relative + z ≥ 3,
      2 consecutive windows, overlap suppression)
- [x] Aggregation/service layer (SQL projections + TanStack server functions +
      TanStack Query options, `DataResult` envelopes)
- [x] Wire Overview dashboard KPIs + charts to real data
- [x] Wire Incidents / Investigation / Recovery / Audit pages to real data
- [x] Loading / error / empty / not-found states everywhere
- [x] Developer docs — `docs/data-model.md`, `docs/detection-rule.md`
- [x] Deterministic SSR-safe formatting (no `Intl` hydration drift)
- [x] Browser verification of all five routes, zero console errors

Limitations carried into Step 2: `incidents.root_cause` / `diagnosis` /
`confidence` are `NULL` by design; the investigation page renders a computed
narrative from measured values only. No playbook, policy verdict, execution or
verification record exists yet, so those surfaces render honest "not enabled"
states rather than mock rows.

## Step 2 — AI investigation (COMPLETE)

- [x] Root-cause hypothesis over measured ledger aggregates (Lovable AI gateway,
      `google/gemini-3.7-flash`, strict JSON schema, no free-form numbers)
- [x] Confidence score + 3-5 cited evidence lines, persisted on `incidents`
      (`root_cause`, `diagnosis`, `confidence`, `evidence`, `investigated_at`)
- [x] Explainable recovery-opportunity score (`revive_recovery_score`, 0-100 over
      five deterministic factors) persisted as `incidents.recovery_score`
- [x] Rendered inside the existing investigation page — no new pages

## Step 3 — Recovery playbook, policy engine, canary execution (COMPLETE)

- [x] Two bounded actions per incident (`revive_propose_recovery`):
      retry eligible failed payments · recover abandoned/interrupted checkouts
- [x] Deterministic policy engine: confidence threshold, failure-reason
      eligibility, per-transaction ceiling, retry limit + cooldown,
      idempotency guard, exposure ceiling → approved / requires_approval / blocked
- [x] Human approve/reject gate for customer-facing or high-exposure actions
- [x] Canary execution capped at 50 transactions, test mode only, outcome
      derived per transaction from its failure reason (`revive_execute_recovery`)
- [x] Verification loop: attempted / recovered / failed / recovery rate /
      remaining revenue at risk, recomputed from the ledger
- [x] Counterfactual panel: measured shortfall vs measured recovery
- [x] Every stage written to the append-only audit ledger

Limitations: execution is a Razorpay test-mode simulation against the merchant
ledger — REVIVE holds no live payment credentials, and per-transaction outcomes
come from a deterministic recovery-propensity map, not a live PSP response.

## Optional (only if credits remain)

- Mini recovery memory ("a similar UPI incident previously recovered ₹X")
- Mini chat interface answering "why did revenue drop?" from existing data

## Backlog / ideas

- Incident replay slider (scrub the dataset clock)
- Per-segment drill-down filters on the incidents page
- Export incident report (PDF/CSV) for compliance review
- Seasonal (day-of-week / time-of-day) baseline instead of flat 7-day mean
- Additional monitored metrics: latency, refund rate, settlement lag
