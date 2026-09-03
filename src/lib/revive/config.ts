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

/** Stage map for the AI → Policy → Execution safety pipeline. */
export const PIPELINE_STAGES = [
  {
    name: "AI Recommendation",
    enabled: false,
    note: "Root-cause analysis and bounded playbook proposals arrive in Step 2.",
  },
  {
    name: "Policy Engine",
    enabled: false,
    note: "Deterministic allow/block rules arrive in Step 3.",
  },
  {
    name: "Approved / Blocked",
    enabled: false,
    note: "Verdict routing arrives in Step 3.",
  },
  {
    name: "Test Action",
    enabled: false,
    note: "Canary execution arrives in Step 3.",
  },
  {
    name: "Verification",
    enabled: false,
    note: "Post-action verification arrives in Step 3. Metric recovery is observed today.",
  },
  {
    name: "Audit Log",
    enabled: true,
    note: "Live — every detection decision is already written to the append-only ledger.",
  },
] as const;
