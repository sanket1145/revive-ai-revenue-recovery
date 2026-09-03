# REVIVE AI — data model

Everything the UI shows is computed from one immutable ledger of payment
attempts. No KPI, chart point, incident, or narrative string is hard-coded in
the frontend. This document describes the schema, the generator, and the read
path.

All money is stored and transported in **paise** (integer). Rupee conversion
happens only at the last formatting step (`src/lib/revive/format.ts`).

---

## 1. Tables

### `public.transactions` — the payment-attempt ledger

One row per payment attempt (not per order). Immutable; the generator writes it
once and nothing else ever mutates it.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint` identity | surrogate key |
| `transaction_id` | `text` unique | `TXN-<seq>` business identifier |
| `occurred_at` | `timestamptz` | attempt time (UTC; rendered in IST) |
| `amount_paise` | `bigint` | attempted value in paise |
| `currency` | `text` | `INR` |
| `payment_method` | `text` | `upi` \| `card` \| `netbanking` \| `wallet` \| `emandate` |
| `method_detail` | `text` | `upi_collect`, `upi_intent`, `card_credit`, `card_debit`, … |
| `issuer` | `text` | bank / network (`HDFC`, `SBI`, `ICICI`, `PAYTM`, …) |
| `psp` | `text` | `PSP-PRIMARY` \| `PSP-SECONDARY` — routing leg |
| `payment_status` | `text` | `captured` \| `failed` |
| `failure_reason` | `text` null | raw gateway code, e.g. `BANK_GATEWAY_TIMEOUT` |
| `failure_category` | `text` null | `customer` \| `issuer` \| `psp` \| `risk` \| `mandate` |
| `gateway_response_code` | `text` null | numeric-style rail code |
| `auth_latency_ms` | `integer` | authorisation round-trip |
| `device_type` | `text` | `android`, `ios`, `desktop`, `mweb` |
| `city`, `region` | `text` | geography segmentation |
| `customer_type` | `text` | `new` \| `returning` \| `subscriber` |
| `customer_ref` | `text` | pseudonymous customer key |
| `is_retry`, `retry_count`, `parent_transaction_id` | | retry chain |
| `scenario_tag` | `text` | ground-truth label — see below |

**`scenario_tag` is never read by detection.** It exists purely so a reviewer
can confirm that the detector rediscovered the injected incidents from signal
alone. Values: `baseline`, `S1_UPI_PSP_COLLECT_TIMEOUT`,
`S2_CARD_ISSUER_3DS_ACS`, `S3_ENACH_BATCH_REJECT`,
`S4_NETBANKING_PSP_GATEWAY`.

Indexes support the detection sweep directly:
`(occurred_at)`, `(payment_method, occurred_at)`,
`(payment_method, issuer, occurred_at)`, `(payment_status, occurred_at)`.

### `public.incidents` — detected revenue incidents

Written only by the detector. `natural_key` (scope + first anomalous window)
makes the sweep idempotent: re-running detection updates rows instead of
duplicating them. `incident_code` (`INC-24xx`) is assigned in chronological
detection order so demo URLs are stable.

Key columns: `scope_type` (`method` | `method_issuer`), `scope_label`,
`window_start` / `window_end`, `observed_success_rate`,
`baseline_success_rate`, `drop_pp`, `drop_pct`, `z_score`,
`attempted_transactions`, `affected_transactions`, `dominant_failure_reason`,
`dominant_failure_share`, `revenue_at_risk_paise`, `revenue_recovered_paise`,
`detection_rule`, `detection_params` (the exact thresholds used),
`severity`, `status`, `resolved_at`.

`root_cause`, `diagnosis`, and `confidence` are nullable and remain `NULL` in
this step. They are reserved for the Step 2 LLM investigation service; the UI
must never invent values for them.

Status lifecycle in this step is limited to what detection can prove:
`detected` → `monitoring` → `recovered`. `investigating` and `recovering` are
declared in the type union but are only reachable once the recovery engine
exists.

### `public.audit_events` — append-only decision ledger

Every dataset build, detection decision, recovery-to-baseline observation, and
policy posture statement is written here before it is surfaced. `event_code`
(`AUD-xxxxx`) is unique, so re-running detection is idempotent here too.
Columns: `occurred_at`, `actor`, `stage` (`dataset` | `detection` | `policy` |
`execution` | `verification`), `event`, `detail`, `outcome`, `incident_code`,
`metadata` jsonb.

### `public.dataset_meta` — singleton provenance record

`seed`, `generator_version`, `merchant_name`, `merchant_id`, `window_start`,
`as_of`, `transaction_count`, `generated_at`. The UI reads `as_of` as "now" so
the demo is time-stable and never drifts against the wall clock.

### `public.dashboard_snapshot` / `public.incident_reports` — read projections

Computed jsonb payloads (`revive_refresh_projections()`), the **only** tables
the browser reads for aggregates. The overview snapshot holds KPIs, the hourly
revenue trend, the success-rate trend, the method breakdown, and risk-by-
incident. `incident_reports` holds one payload per incident: evidence rows,
failure mix, affected segments, sparkline buckets, revenue impact, and
verification rows.

---

## 2. Security posture

- RLS is enabled on every table.
- `transactions` has an explicit **deny-all** SELECT policy — the raw ledger is
  never exposed to a browser, only the derived projections are.
- `incidents`, `audit_events`, `dataset_meta`, `dashboard_snapshot`, and
  `incident_reports` are public-read (`anon`, `authenticated`) with writes
  reserved for `service_role`.
- `revive_generate_dataset()`, `revive_detect_incidents()`,
  `revive_build_incident_report()` and `revive_refresh_projections()` have
  `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated`. A visitor cannot
  regenerate data or force a detection sweep.

---

## 3. The synthetic dataset

Generated by `revive_generate_dataset()`, **96,622 attempts** across
25 Aug 2026 00:00 IST → 3 Sep 2026 16:20 IST for merchant *Zolvex Retail*.

Determinism comes from `revive_rand(key)`, an md5-derived PRNG keyed on a
seed string plus the row's own identity. The same seed always produces a
byte-identical dataset — no `random()`, no `now()`, no ordering dependence.
Helpers `revive_pick()` (weighted categorical draw) and `revive_between()`
(uniform range) are built on the same primitive.

Baseline realism modelled: intraday traffic curve (early-morning trough,
lunch and evening peaks), weekday/weekend volume shift, method mix
(UPI 42.7%, card 30.3%, netbanking 11.4%, wallet 10.4%, e-NACH 5.2%),
issuer mix, PSP split, device and geography skew per method, amount
distributions that differ by method and customer type, per-segment baseline
success rates, latency distributions with a realistic p95 tail, a weighted
failure-reason taxonomy (19 reason codes across 5 categories), and a retry
chain where a share of failures produce a linked follow-up attempt.

### Injected incidents (ground truth)

| Tag | Scope | Window (IST) | Mechanism |
| --- | --- | --- | --- |
| `S1_UPI_PSP_COLLECT_TIMEOUT` | UPI collect on `PSP-PRIMARY` | 3 Sep 14:05 → open | authorisation timeouts, latency p95 3.1s → 26.9s, `BANK_GATEWAY_TIMEOUT` |
| `S2_CARD_ISSUER_3DS_ACS` | SBI cards, 3-D Secure step-up | 3 Sep 12:35 → 15:13 | issuer ACS unavailable, `ACS_UNAVAILABLE` |
| `S3_ENACH_BATCH_REJECT` | e-NACH mandate presentment | 3 Sep 09:00 → 09:45 | whole-batch file reject, `INVALID_UMRN_SEQUENCE` |
| `S4_NETBANKING_PSP_GATEWAY` | Netbanking on `PSP-PRIMARY` | 2 Sep 18:10 → 19:18 | PSP gateway degradation, resolved same evening |

S2, S3 and S4 recover inside the dataset window, which is what lets the
detector demonstrate a `recovered` state without any recovery action being
executed. S1 is still degraded at `as_of`, so it stays open.

---

## 4. Read path

```
transactions ──(revive_detect_incidents)──▶ incidents + audit_events
       │                                          │
       └────(revive_refresh_projections)──────────┴──▶ dashboard_snapshot
                                                       incident_reports
                                                              │
                          src/lib/revive/data.functions.ts ◀───┘  (server fns,
                                                                   publishable key)
                                       │
                          src/lib/revive/queries.ts (TanStack Query options)
                                       │
                                    routes/*
```

- `src/lib/revive/supabase.server.ts` builds a publishable-key client inside the
  handler — no service role in the request path, no session persistence.
- `src/lib/revive/mappers.ts` coerces jsonb/numeric/bigint into strict DTOs and
  guards every enum against unknown values.
- Every server function returns a `DataResult<T>` envelope
  (`{ ok: true, data }` or `{ ok: false, reason }`), so an empty or missing
  dataset renders an explicit "data unavailable" state instead of zeros that
  look like real numbers.

## 5. Regenerating

```sql
select public.revive_generate_dataset();   -- deterministic, truncates + rebuilds
select public.revive_detect_incidents();   -- idempotent sweep
select public.revive_refresh_projections();-- rebuild read projections
```

Run them in that order. Both later steps are safe to re-run on their own.
