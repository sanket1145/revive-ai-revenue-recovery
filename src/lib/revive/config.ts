/**
 * Merchant-level configuration for the REVIVE command centre.
 * These are operator-set thresholds, not data — they are displayed as such.
 */

/** Contractual payment success-rate floor the merchant monitors against (%). */
export const SLA_SUCCESS_RATE_FLOOR = 93;

/** Detection rule identifier currently in force. */
export const DETECTION_RULE = "rolling-baseline-z-v1";

/**
 * Human-readable description of the deterministic detection rule.
 * Kept next to the constants so the UI and the docs cannot drift.
 */
export const DETECTION_RULE_SUMMARY =
  "30-minute windows · trailing 7-day rolling baseline with a 2-hour guard band · " +
  "flagged at ≥8 pp absolute drop, ≥15% relative drop and z ≥ 3.0 on ≥20 attempts · " +
  "incident opens after 2 consecutive flagged windows.";

/** Hard bounds the deterministic policy engine enforces on every action. */
export const POLICY_LIMITS = {
  /** Maximum transactions in one canary batch. */
  canaryLimit: 50,
  /** Maximum value of a single retried transaction (paise). */
  maxTransactionPaise: 20_000_000,
  /** Total batch exposure above which a human must approve (paise). */
  humanApprovalPaise: 500_000_00,
  /** Minimum AI confidence before any action may be proposed. */
  minConfidencePct: 60,
  /** Maximum prior retries on a transaction. */
  maxRetryCount: 2,
  /** Minimum age of a failed attempt before a retry is allowed (minutes). */
  cooldownMinutes: 15,
} as const;

/** Stage map for the AI → Policy → Execution safety pipeline. */
export const PIPELINE_STAGES = [
  {
    name: "AI Recommendation",
    enabled: true,
    note: "Live — the investigation model diagnoses each incident from measured ledger aggregates and proposes only bounded, pre-defined actions.",
  },
  {
    name: "Policy Engine",
    enabled: true,
    note: "Live — deterministic checks on confidence, failure eligibility, per-transaction ceiling, retry limits, cooldown, idempotency and total exposure.",
  },
  {
    name: "Approved / Blocked",
    enabled: true,
    note: "Live — every action carries an approved, blocked or requires-approval verdict. High-exposure actions route to a human approver.",
  },
  {
    name: "Test Action",
    enabled: true,
    note: "Live — execution is capped at 50 transactions and runs in Razorpay-compatible test mode. REVIVE holds no live payment credentials.",
  },
  {
    name: "Verification",
    enabled: true,
    note: "Live — each batch result is recomputed from the ledger: attempted, recovered, recovery rate and remaining revenue at risk.",
  },
  {
    name: "Audit Log",
    enabled: true,
    note: "Live — detection, diagnosis, policy verdict, approval, execution and verification are all written to the append-only ledger.",
  },
] as const;
