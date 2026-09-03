# Detection rule `rolling-baseline-z-v1`

The detector is deterministic SQL (`public.revive_detect_incidents()`). It is
not a model. Given the same ledger it always produces the same incidents, and
every threshold it used is stored on the incident row in `detection_params` so
the UI can show its own provenance.

It never reads `transactions.scenario_tag`. The injected scenarios are
rediscovered from signal only.

---

## 1. Scopes

Two scope families are swept:

| `scope_type` | Grain | Example label |
| --- | --- | --- |
| `method` | payment method | `UPI · all issuers` |
| `method_issuer` | payment method × issuer | `Card · SBI` |

Method-level catches rail-wide degradation; method×issuer catches a single bank
failing while the rail is otherwise fine.

## 2. Windows and baseline

- **Window:** fixed 30-minute buckets (`window_seconds = 1800`).
- **Evaluation horizon:** trailing 48 hours from `dataset_meta.as_of`
  (`horizon_hours = 48`).
- **Baseline:** the same scope over the previous 7 days
  (`baseline_days = 7`), ending a **2-hour guard band** before the window under
  test (`baseline_guard_hours = 2`). The guard band stops an ongoing incident
  from contaminating the baseline it is being compared against.

## 3. Volume floors

A window is only evaluated when it carries enough traffic to be meaningful:

- `min_window_attempts = 20`
- `min_baseline_attempts = 300`

Below either floor the window is skipped, not flagged. This is what keeps a
quiet 04:00 bucket with three attempts from producing a phantom incident.

## 4. Flagging a window

Let `p_obs` be the window success rate and `p_base` the baseline success rate.
All three conditions must hold:

1. **Absolute drop** `p_base − p_obs ≥ 8 pp` (`min_drop_pp`)
2. **Relative drop** `(p_base − p_obs) / p_base ≥ 15%` (`min_relative_drop`)
3. **Statistical separation** two-proportion z-score `≥ 3.0` (`min_z_score`)

```
        p_base − p_obs
z = ───────────────────────────,   p̂ = pooled success rate
    √( p̂(1−p̂) · (1/n_obs + 1/n_base) )
```

The absolute test kills trivial deltas, the relative test keeps the rule fair
to scopes with a naturally lower baseline, and the z-test kills small-sample
noise. A window must fail all three tests to be considered normal.

## 5. From flagged windows to an incident

- **Persistence:** an incident opens only after **2 consecutive** flagged
  windows (`min_consecutive_windows = 2`) — a single bad bucket is noise.
- **Merging:** consecutive runs separated by at most one clean window
  (60 minutes) are merged into one incident rather than reported as two.
- **Idempotency:** the incident's `natural_key` is `scope + first anomalous
  window`, so re-running the sweep updates the existing row.

## 6. Revenue at risk

```
revenue_at_risk = max(0, (baseline_success_rate × value_attempted_in_window)
                          − value_actually_captured_in_window)
```

It is an **observed shortfall inside the detection window**, not a forecast and
not an extrapolation: the value customers tried to pay, multiplied by the rate
that scope normally authorises at, minus what was actually captured. It is
floored at zero. `revenue_recovered_paise` stays `0` because no recovery action
is executed in this build.

The overview KPI *Revenue at Risk* is the sum over incidents whose window
intersects the current day; *Recovery Rate* is
`revenue_recovered ÷ revenue_at_risk`, so it correctly reads `0.0%`.

## 7. Overlap suppression

A rail-wide UPI outage would otherwise appear once per issuer plus once at the
method level. Two rules deduplicate:

- If one issuer accounts for **≥ 60%** of the loss inside a method-level
  incident, the method-level incident is suppressed and the issuer-scoped one is
  kept (that is the true blast radius).
- Otherwise the method-level incident is kept and overlapping issuer-scoped
  echoes inside the same window are suppressed.

## 8. Severity

`revive_severity(revenue_at_risk_paise, drop_pp)`:

| Severity | Condition |
| --- | --- |
| `critical` | ≥ ₹7 L at risk **and** ≥ 20 pp drop |
| `high` | ≥ ₹1.5 L at risk **and** ≥ 15 pp drop |
| `medium` | ≥ ₹0.4 L at risk **or** ≥ 20 pp drop |
| `low` | otherwise |

Severity is a function of measured money and measured drop. There is no
subjective weighting and no model confidence.

## 9. Status

| Status | Meaning |
| --- | --- |
| `detected` | flagged, still below baseline at `as_of` |
| `monitoring` | success rate has returned to within tolerance, held for less than the confirmation period |
| `recovered` | scope sustained baseline-level success after the window closed; `resolved_at` set |

`recovered` describes what the metric did. It explicitly does **not** claim
REVIVE fixed anything — the audit ledger records "metric returned to baseline …
no recovery action was executed" for exactly this reason.

## 10. Current result on the seeded dataset

| Code | Scope | Severity | Status | Drop | z | At risk |
| --- | --- | --- | --- | --- | --- | --- |
| `INC-2401` | Netbanking · all issuers | medium | recovered | 28.76 pp | 5.67 | ₹42,962 |
| `INC-2402` | e-NACH mandate · all issuers | critical | recovered | 82.51 pp | 46.21 | ₹9.45 L |
| `INC-2403` | Card · SBI | high | monitoring | 44.51 pp | 10.35 | ₹1.58 L |
| `INC-2404` | UPI · all issuers | critical | detected | 28.46 pp | 19.56 | ₹7.65 L |

All four injected scenarios were recovered by the detector, at the correct
scope, with no false positives across the 96 windows × 4 scopes swept.

## 11. Known limits

- Success rate is the only monitored metric. Latency, refund rate, chargebacks
  and settlement lag are not yet swept.
- The baseline is a flat 7-day mean per scope; it does not model day-of-week or
  time-of-day seasonality, which is acceptable here because the guard band and
  volume floors absorb most of that variance, but it would need a seasonal
  baseline on real traffic.
- Multi-scope correlation (one PSP failing across several methods at once) is
  not yet reasoned about — that is part of the Step 2 investigation service.
- Detection runs on demand, not on a schedule. There is no streaming ingestion.
