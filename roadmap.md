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

## Step 2 — AI investigation (NOT STARTED)

- Root-cause hypothesis generation over detected incident evidence (Lovable AI gateway)
- Confidence scoring, evidence citation, affected-segment narrative
- Persist diagnosis on `incidents` (`root_cause`, `diagnosis`, `confidence`)
- Multi-scope correlation (one PSP degrading across several methods at once)

## Step 3 — Revenue-at-risk engine, policy engine, recovery execution (NOT STARTED)

- Playbook proposal engine (bounded action catalogue)
- Deterministic policy engine: approved / blocked / requires_approval verdicts
- Test-mode (canary) execution + verification loop
- Human approval flow for customer-facing actions
- Full audit trail wiring for every stage

## Backlog / ideas

- Incident replay slider (scrub the dataset clock)
- Per-segment drill-down filters on the incidents page
- Export incident report (PDF/CSV) for compliance review
- Seasonal (day-of-week / time-of-day) baseline instead of flat 7-day mean
- Additional monitored metrics: latency, refund rate, settlement lag
