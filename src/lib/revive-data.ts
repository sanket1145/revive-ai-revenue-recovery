export type Severity = "critical" | "high" | "medium" | "low";
export type IncidentStatus =
  | "detected"
  | "investigating"
  | "recovering"
  | "recovered"
  | "monitoring";
export type PolicyStatus = "approved" | "blocked" | "requires_approval";
export type ExecutionStatus =
  | "executed"
  | "test_mode"
  | "pending"
  | "blocked"
  | "verified";

export interface PlaybookAction {
  id: string;
  action: string;
  reason: string;
  expectedRecovery: number;
  policyStatus: PolicyStatus;
  policyNote: string;
  executionStatus: ExecutionStatus;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: "REVIVE AI" | "Policy Engine" | "Ops Engineer" | "System";
  event: string;
  detail: string;
  incidentId: string;
  outcome: "info" | "success" | "blocked" | "critical";
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  detectedAt: string;
  dropPct: number;
  revenueAtRisk: number;
  revenueRecovered: number;
  affectedTransactions: number;
  rootCause: string;
  confidence: number;
  diagnosis: string;
  evidence: { signal: string; observed: string; baseline: string }[];
  segments: { segment: string; impact: number; volume: number }[];
  playbook: PlaybookAction[];
  verification: { metric: string; before: string; after: string; delta: string }[];
  sparkline: { t: string; sr: number }[];
}

export const kpis = {
  revenueToday: 41_28_74_500,
  revenueTodayDelta: -6.4,
  revenueAtRisk: 1_84_20_000,
  revenueAtRiskDelta: 12.1,
  revenueRecovered: 1_21_60_000,
  revenueRecoveredDelta: 18.7,
  recoveryRate: 66.0,
  recoveryRateDelta: 4.2,
  activeIncidents: 3,
  activeIncidentsDelta: 1,
};

export const revenueTrend = [
  { time: "00:00", revenue: 128, baseline: 124 },
  { time: "02:00", revenue: 96, baseline: 98 },
  { time: "04:00", revenue: 71, baseline: 74 },
  { time: "06:00", revenue: 118, baseline: 116 },
  { time: "08:00", revenue: 204, baseline: 198 },
  { time: "10:00", revenue: 268, baseline: 261 },
  { time: "12:00", revenue: 295, baseline: 288 },
  { time: "14:00", revenue: 186, baseline: 292 },
  { time: "16:00", revenue: 149, baseline: 301 },
  { time: "18:00", revenue: 232, baseline: 318 },
  { time: "20:00", revenue: 289, baseline: 324 },
  { time: "22:00", revenue: 241, baseline: 268 },
];

export const successRateTrend = [
  { time: "00:00", sr: 96.4, threshold: 93 },
  { time: "02:00", sr: 96.1, threshold: 93 },
  { time: "04:00", sr: 95.8, threshold: 93 },
  { time: "06:00", sr: 96.2, threshold: 93 },
  { time: "08:00", sr: 95.9, threshold: 93 },
  { time: "10:00", sr: 94.7, threshold: 93 },
  { time: "12:00", sr: 92.1, threshold: 93 },
  { time: "14:00", sr: 78.4, threshold: 93 },
  { time: "16:00", sr: 71.2, threshold: 93 },
  { time: "18:00", sr: 88.6, threshold: 93 },
  { time: "20:00", sr: 94.1, threshold: 93 },
  { time: "22:00", sr: 95.6, threshold: 93 },
];

export const methodBreakdown = [
  { method: "UPI", share: 46, sr: 74.2, status: "degraded" },
  { method: "Cards", share: 27, sr: 95.1, status: "healthy" },
  { method: "Netbanking", share: 14, sr: 88.4, status: "watch" },
  { method: "Wallets", share: 9, sr: 96.3, status: "healthy" },
  { method: "EMI / BNPL", share: 4, sr: 91.8, status: "watch" },
];

export const riskByIncident = [
  { id: "INC-2417", risk: 92.4 },
  { id: "INC-2416", risk: 51.8 },
  { id: "INC-2415", risk: 24.6 },
  { id: "INC-2412", risk: 9.4 },
  { id: "INC-2409", risk: 6.0 },
];

export const incidents: Incident[] = [
  {
    id: "INC-2417",
    title: "UPI collect success rate collapse — HDFC PSP handle",
    severity: "critical",
    status: "recovering",
    detectedAt: "2026-09-03T14:06:00Z",
    dropPct: 38.4,
    revenueAtRisk: 92_40_000,
    revenueRecovered: 61_80_000,
    affectedTransactions: 18_942,
    rootCause: "PSP-side authorization timeouts on HDFC UPI collect requests",
    confidence: 94,
    diagnosis:
      "Authorization latency on the HDFC UPI collect route rose from 1.8s to 24.6s at 14:04 IST, causing a 62% timeout rate. Failure codes are concentrated in BANK_GATEWAY_TIMEOUT and cluster entirely on a single PSP handle, while card and wallet routes remain within baseline. This is an upstream bank-rail degradation, not a merchant checkout or pricing regression.",
    evidence: [
      { signal: "UPI success rate", observed: "71.2%", baseline: "96.1%" },
      { signal: "Auth latency p95", observed: "24.6s", baseline: "1.8s" },
      { signal: "BANK_GATEWAY_TIMEOUT share", observed: "62.4%", baseline: "1.2%" },
      { signal: "Card rail success rate", observed: "95.1%", baseline: "95.4%" },
      { signal: "Checkout load errors", observed: "0.03%", baseline: "0.04%" },
    ],
    segments: [
      { segment: "UPI collect · HDFC handle", impact: 74, volume: 12_408 },
      { segment: "UPI intent · Android", impact: 18, volume: 4_106 },
      { segment: "Recurring UPI mandates", impact: 6, volume: 1_982 },
      { segment: "Cards · all issuers", impact: 2, volume: 446 },
    ],
    playbook: [
      {
        id: "ACT-1",
        action: "Shift UPI collect traffic to secondary PSP route",
        reason:
          "Secondary PSP is holding 95.8% success on identical traffic mix over the last 30 minutes.",
        expectedRecovery: 58_00_000,
        policyStatus: "approved",
        policyNote: "Within routing-change policy (max 60% traffic shift, reversible).",
        executionStatus: "verified",
      },
      {
        id: "ACT-2",
        action: "Enable smart retry with 45s backoff for timed-out collects",
        reason:
          "72% of timed-out mandates historically succeed on a delayed second attempt.",
        expectedRecovery: 19_40_000,
        policyStatus: "approved",
        policyNote: "Retry cap 1 per txn — no double-debit exposure.",
        executionStatus: "executed",
      },
      {
        id: "ACT-3",
        action: "Auto-issue 5% goodwill discount to failed high-value carts",
        reason: "Recover abandoned checkouts above ₹15,000 order value.",
        expectedRecovery: 11_20_000,
        policyStatus: "blocked",
        policyNote:
          "BLOCKED — policy PE-014: AI may not create financial concessions or alter pricing. Requires finance owner approval.",
        executionStatus: "blocked",
      },
      {
        id: "ACT-4",
        action: "Surface fallback method nudge on checkout for UPI failures",
        reason: "Redirect intent traffic to cards while the UPI rail is degraded.",
        expectedRecovery: 8_60_000,
        policyStatus: "requires_approval",
        policyNote: "Customer-facing UI change — needs on-call merchant approval.",
        executionStatus: "test_mode",
      },
    ],
    verification: [
      { metric: "UPI success rate", before: "71.2%", after: "93.8%", delta: "+22.6 pp" },
      { metric: "Timeout share", before: "62.4%", after: "4.1%", delta: "-58.3 pp" },
      { metric: "Hourly revenue", before: "₹1.49 Cr", after: "₹2.89 Cr", delta: "+94%" },
      { metric: "Recovered value", before: "₹0", after: "₹61.8 L", delta: "+₹61.8 L" },
    ],
    sparkline: [
      { t: "13:30", sr: 96 },
      { t: "14:00", sr: 89 },
      { t: "14:30", sr: 74 },
      { t: "15:00", sr: 71 },
      { t: "15:30", sr: 82 },
      { t: "16:00", sr: 94 },
    ],
  },
  {
    id: "INC-2416",
    title: "Card authorization declines spike — SBI issuer 3DS step-up",
    severity: "high",
    status: "investigating",
    detectedAt: "2026-09-03T12:41:00Z",
    dropPct: 21.7,
    revenueAtRisk: 51_80_000,
    revenueRecovered: 22_40_000,
    affectedTransactions: 7_318,
    rootCause: "Issuer-side 3DS challenge failures on SBI debit BINs",
    confidence: 87,
    diagnosis:
      "SBI debit BINs began returning ACS_UNAVAILABLE on 3DS step-up at 12:38 IST. Drop-off happens after the OTP page render, indicating an issuer ACS availability issue rather than a checkout or tokenization fault.",
    evidence: [
      { signal: "SBI debit auth rate", observed: "63.4%", baseline: "89.9%" },
      { signal: "ACS_UNAVAILABLE codes", observed: "31.8%", baseline: "0.6%" },
      { signal: "OTP page render", observed: "99.2%", baseline: "99.4%" },
      { signal: "Other issuer auth rate", observed: "94.6%", baseline: "94.8%" },
    ],
    segments: [
      { segment: "SBI debit · 3DS step-up", impact: 81, volume: 5_921 },
      { segment: "SBI credit · 3DS step-up", impact: 13, volume: 951 },
      { segment: "Tokenized saved cards", impact: 6, volume: 446 },
    ],
    playbook: [
      {
        id: "ACT-1",
        action: "Route SBI debit through alternate acquirer with frictionless 3DS",
        reason: "Alternate acquirer supports exemption flow for sub-₹5,000 orders.",
        expectedRecovery: 24_00_000,
        policyStatus: "approved",
        policyNote: "Reversible routing change within approved acquirer set.",
        executionStatus: "executed",
      },
      {
        id: "ACT-2",
        action: "Promote UPI as primary method for SBI card failures",
        reason: "UPI rail is healthy at 95.6% for this cohort.",
        expectedRecovery: 14_20_000,
        policyStatus: "requires_approval",
        policyNote: "Checkout ordering change — merchant approval pending.",
        executionStatus: "pending",
      },
      {
        id: "ACT-3",
        action: "Auto-refund and re-charge stuck authorizations",
        reason: "Clear 412 hung auth holds on customer cards.",
        expectedRecovery: 6_10_000,
        policyStatus: "blocked",
        policyNote:
          "BLOCKED — policy PE-002: AI may not initiate refunds or debits. Manual finance action only.",
        executionStatus: "blocked",
      },
    ],
    verification: [
      { metric: "SBI debit auth rate", before: "63.4%", after: "81.2%", delta: "+17.8 pp" },
      { metric: "Recovered value", before: "₹0", after: "₹22.4 L", delta: "+₹22.4 L" },
    ],
    sparkline: [
      { t: "12:00", sr: 90 },
      { t: "12:30", sr: 78 },
      { t: "13:00", sr: 66 },
      { t: "13:30", sr: 69 },
      { t: "14:00", sr: 76 },
      { t: "14:30", sr: 81 },
    ],
  },
  {
    id: "INC-2415",
    title: "Subscription mandate debits failing — e-NACH batch rejects",
    severity: "medium",
    status: "monitoring",
    detectedAt: "2026-09-03T09:15:00Z",
    dropPct: 11.2,
    revenueAtRisk: 24_60_000,
    revenueRecovered: 18_90_000,
    affectedTransactions: 3_204,
    rootCause: "e-NACH presentment batch rejected by sponsor bank on file format",
    confidence: 91,
    diagnosis:
      "The 09:00 presentment batch was rejected wholesale with error 'INVALID_UMRN_SEQUENCE'. Failure is uniform across the batch, indicating a file-level rejection rather than customer-level insufficient funds.",
    evidence: [
      { signal: "Batch accept rate", observed: "0%", baseline: "99.1%" },
      { signal: "INVALID_UMRN_SEQUENCE", observed: "3,204", baseline: "0" },
      { signal: "Insufficient-funds rejects", observed: "0.4%", baseline: "3.9%" },
    ],
    segments: [
      { segment: "Monthly plan renewals", impact: 68, volume: 2_178 },
      { segment: "Annual plan renewals", impact: 24, volume: 769 },
      { segment: "Add-on mandates", impact: 8, volume: 257 },
    ],
    playbook: [
      {
        id: "ACT-1",
        action: "Re-present corrected e-NACH batch in next presentment window",
        reason: "Sequence field corrected; sponsor bank accepts re-presentment same day.",
        expectedRecovery: 19_00_000,
        policyStatus: "approved",
        policyNote: "Re-presentment within mandate rules (max 3 attempts/cycle).",
        executionStatus: "verified",
      },
      {
        id: "ACT-2",
        action: "Send card-fallback payment link to affected subscribers",
        reason: "Recover renewals that miss the presentment window.",
        expectedRecovery: 4_40_000,
        policyStatus: "requires_approval",
        policyNote: "Outbound customer comms — needs merchant approval.",
        executionStatus: "test_mode",
      },
    ],
    verification: [
      { metric: "Batch accept rate", before: "0%", after: "98.8%", delta: "+98.8 pp" },
      { metric: "Recovered value", before: "₹0", after: "₹18.9 L", delta: "+₹18.9 L" },
    ],
    sparkline: [
      { t: "09:00", sr: 0 },
      { t: "10:00", sr: 0 },
      { t: "11:00", sr: 64 },
      { t: "12:00", sr: 92 },
      { t: "13:00", sr: 98 },
      { t: "14:00", sr: 99 },
    ],
  },
  {
    id: "INC-2412",
    title: "International card conversion drop — currency routing misconfig",
    severity: "low",
    status: "recovered",
    detectedAt: "2026-09-02T18:22:00Z",
    dropPct: 5.8,
    revenueAtRisk: 9_40_000,
    revenueRecovered: 9_10_000,
    affectedTransactions: 812,
    rootCause: "USD orders routed to a domestic-only acquirer after config rollout",
    confidence: 96,
    diagnosis:
      "A routing config rollout at 18:20 sent USD-denominated orders to a domestic-only acquirer, which hard-declines non-INR currencies. Rollback restored conversion within 26 minutes.",
    evidence: [
      { signal: "USD auth rate", observed: "18.4%", baseline: "88.2%" },
      { signal: "CURRENCY_NOT_SUPPORTED", observed: "76.1%", baseline: "0%" },
      { signal: "INR auth rate", observed: "94.9%", baseline: "95.0%" },
    ],
    segments: [
      { segment: "USD checkout", impact: 88, volume: 714 },
      { segment: "AED / SGD checkout", impact: 12, volume: 98 },
    ],
    playbook: [
      {
        id: "ACT-1",
        action: "Roll back currency routing config to previous revision",
        reason: "Deterministic config regression with a known-good prior revision.",
        expectedRecovery: 9_10_000,
        policyStatus: "approved",
        policyNote: "Config rollback is an allow-listed reversible action.",
        executionStatus: "verified",
      },
    ],
    verification: [
      { metric: "USD auth rate", before: "18.4%", after: "88.6%", delta: "+70.2 pp" },
      { metric: "Recovered value", before: "₹0", after: "₹9.1 L", delta: "+₹9.1 L" },
    ],
    sparkline: [
      { t: "18:00", sr: 88 },
      { t: "18:30", sr: 21 },
      { t: "19:00", sr: 86 },
      { t: "19:30", sr: 89 },
      { t: "20:00", sr: 88 },
      { t: "20:30", sr: 89 },
    ],
  },
];

export const auditTrail: AuditEvent[] = [
  {
    id: "AUD-9041",
    at: "2026-09-03T14:06:12Z",
    actor: "System",
    event: "Anomaly detected",
    detail: "UPI success rate breached 93% floor (observed 78.4%) for 3 consecutive windows.",
    incidentId: "INC-2417",
    outcome: "critical",
  },
  {
    id: "AUD-9042",
    at: "2026-09-03T14:06:48Z",
    actor: "REVIVE AI",
    event: "Root cause hypothesis generated",
    detail: "PSP-side authorization timeouts on HDFC UPI collect — confidence 94%.",
    incidentId: "INC-2417",
    outcome: "info",
  },
  {
    id: "AUD-9043",
    at: "2026-09-03T14:07:30Z",
    actor: "REVIVE AI",
    event: "Recovery playbook proposed",
    detail: "4 actions proposed, ₹97.2 L expected recovery. No action executed pre-validation.",
    incidentId: "INC-2417",
    outcome: "info",
  },
  {
    id: "AUD-9044",
    at: "2026-09-03T14:07:41Z",
    actor: "Policy Engine",
    event: "Action approved",
    detail: "ACT-1 route shift approved under PE-007 (reversible routing, ≤60% traffic).",
    incidentId: "INC-2417",
    outcome: "success",
  },
  {
    id: "AUD-9045",
    at: "2026-09-03T14:07:41Z",
    actor: "Policy Engine",
    event: "Action blocked",
    detail: "ACT-3 goodwill discount blocked by PE-014 — AI cannot alter pricing or issue credits.",
    incidentId: "INC-2417",
    outcome: "blocked",
  },
  {
    id: "AUD-9046",
    at: "2026-09-03T14:09:02Z",
    actor: "System",
    event: "Test action executed",
    detail: "ACT-1 applied to 5% canary traffic — success rate 95.4% on canary cohort.",
    incidentId: "INC-2417",
    outcome: "info",
  },
  {
    id: "AUD-9047",
    at: "2026-09-03T14:14:20Z",
    actor: "Ops Engineer",
    event: "Human approval granted",
    detail: "priya.n@merchant.io approved full rollout of ACT-1 after canary verification.",
    incidentId: "INC-2417",
    outcome: "success",
  },
  {
    id: "AUD-9048",
    at: "2026-09-03T14:31:55Z",
    actor: "System",
    event: "Verification passed",
    detail: "UPI success rate recovered to 93.8%; ₹61.8 L revenue recovered.",
    incidentId: "INC-2417",
    outcome: "success",
  },
  {
    id: "AUD-9031",
    at: "2026-09-03T12:41:09Z",
    actor: "System",
    event: "Anomaly detected",
    detail: "SBI debit auth rate dropped 26.5 pp below baseline.",
    incidentId: "INC-2416",
    outcome: "critical",
  },
  {
    id: "AUD-9033",
    at: "2026-09-03T12:43:11Z",
    actor: "Policy Engine",
    event: "Action blocked",
    detail: "ACT-3 auto-refund blocked by PE-002 — AI may not initiate refunds or debits.",
    incidentId: "INC-2416",
    outcome: "blocked",
  },
  {
    id: "AUD-9034",
    at: "2026-09-03T12:52:40Z",
    actor: "System",
    event: "Action executed",
    detail: "ACT-1 alternate acquirer routing live for SBI debit BINs.",
    incidentId: "INC-2416",
    outcome: "success",
  },
  {
    id: "AUD-8990",
    at: "2026-09-03T09:15:33Z",
    actor: "System",
    event: "Anomaly detected",
    detail: "e-NACH presentment batch rejected in full (3,204 mandates).",
    incidentId: "INC-2415",
    outcome: "critical",
  },
  {
    id: "AUD-8994",
    at: "2026-09-03T11:02:10Z",
    actor: "System",
    event: "Verification passed",
    detail: "Corrected batch accepted at 98.8%; ₹18.9 L recovered.",
    incidentId: "INC-2415",
    outcome: "success",
  },
  {
    id: "AUD-8801",
    at: "2026-09-02T18:48:04Z",
    actor: "System",
    event: "Verification passed",
    detail: "Currency routing rollback restored USD auth rate to 88.6%.",
    incidentId: "INC-2412",
    outcome: "success",
  },
];

export function getIncident(id: string) {
  return incidents.find((i) => i.id.toLowerCase() === id.toLowerCase());
}

export function formatINR(value: number) {
  if (value >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)} Cr`;
  if (value >= 1_00_000) return `₹${(value / 1_00_000).toFixed(1)} L`;
  return `₹${value.toLocaleString("en-IN")}`;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}
