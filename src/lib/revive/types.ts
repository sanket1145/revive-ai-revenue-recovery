/**
 * REVIVE AI — shared data-transfer types.
 *
 * Everything here mirrors what the backend projections emit. Money is always
 * carried in **paise** (integer minor units) and formatted at the edge; never
 * store or pass rupees as floats.
 */

export type Severity = "critical" | "high" | "medium" | "low";

/**
 * Lifecycle of an incident.
 * Step 1 (detection only) produces `detected`, `monitoring` and `recovered`.
 * `investigating` arrives with the AI investigation service (Step 2) and
 * `recovering` with the recovery executor (Step 3).
 */
export type IncidentStatus =
  | "detected"
  | "investigating"
  | "recovering"
  | "monitoring"
  | "recovered";

/** Policy-engine verdict. Reserved for Step 3. */
export type PolicyStatus = "approved" | "blocked" | "requires_approval";

/** Execution state of a recovery action. */
export type ExecutionStatus =
  | "executed"
  | "test_mode"
  | "pending"
  | "rejected"
  | "blocked"
  | "verified";

export type ScopeType = "global" | "payment_method" | "payment_method_issuer";

export interface IncidentRecord {
  code: string;
  naturalKey: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  metric: string;

  scopeType: ScopeType;
  scopeLabel: string;
  scopeMethod: string | null;
  scopeIssuer: string | null;

  detectedAt: string;
  windowStart: string;
  windowEnd: string;
  resolvedAt: string | null;

  observedSuccessRate: number;
  baselineSuccessRate: number;
  dropPp: number;
  dropPct: number;
  zScore: number;

  attemptedTransactions: number;
  affectedTransactions: number;
  revenueAtRiskPaise: number;
  revenueRecoveredPaise: number;

  dominantFailureReason: string | null;
  dominantFailureSharePct: number | null;

  detectionRule: string;

  /** Populated by the AI investigation service (Step 2). */
  rootCause: string | null;
  diagnosis: string | null;
  confidence: number | null;
  evidence: EvidencePoint[];
  recoveryScore: number | null;
  scoreDetail: RecoveryScore | null;
  investigatedAt: string | null;
}

/** One cited, data-backed evidence line produced by the investigation model. */
export interface EvidencePoint {
  signal: string;
  detail: string;
}

export interface ScoreFactor {
  label: string;
  points: number;
  max: number;
}

/** Explainable recovery-opportunity score (0–100), computed deterministically. */
export interface RecoveryScore {
  score: number;
  eligibleTransactions: number;
  eligiblePaise: number;
  expectedRecoveryPaise: number;
  factors: ScoreFactor[];
}

export interface PolicyCheck {
  check: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface RecoveryVerification {
  attempted: number;
  succeeded: number;
  failed: number;
  batchValuePaise: number;
  recoveredPaise: number;
  recoveryRatePct: number;
  mode: string;
}

/** A bounded recovery action proposed for one incident. */
export interface RecoveryAction {
  incidentCode: string;
  actionKey: string;
  title: string;
  reason: string;
  eligibleTransactions: number;
  eligiblePaise: number;
  expectedRecoveryPaise: number;
  policyStatus: PolicyStatus;
  policyChecks: PolicyCheck[];
  executionStatus: ExecutionStatus;
  canaryLimit: number;
  attempted: number;
  recovered: number;
  recoveredPaise: number;
  executedAt: string | null;
  verification: RecoveryVerification | null;
}

export interface AuditEventRecord {
  id: string;
  code: string;
  occurredAt: string;
  actor: string;
  stage: "dataset" | "detection" | "investigation" | "policy" | "execution" | "verification";
  event: string;
  detail: string;
  outcome: "info" | "success" | "blocked" | "critical";
  incidentCode: string | null;
}

export interface SystemMeta {
  merchantName: string;
  merchantId: string;
  seed: string;
  generatorVersion: string;
  windowStart: string;
  asOf: string;
  transactionCount: number;
  detectionRule: string;
  autonomousExecution: boolean;
  refreshedAt: string | null;
}

export interface OverviewKpis {
  revenueTodayPaise: number;
  revenueTodayDeltaPct: number | null;
  revenueAtRiskPaise: number;
  revenueAtRiskDeltaPct: number | null;
  revenueRecoveredPaise: number;
  recoveryRatePct: number;
  activeIncidents: number;
  activeIncidentsDelta: number;
  attemptsToday: number;
  successRatePct: number | null;
  successRateBaselinePct: number | null;
}

export interface RevenueTrendPoint {
  ts: string;
  time: string;
  revenuePaise: number;
  baselinePaise: number;
}

export interface SuccessRateTrendPoint {
  ts: string;
  time: string;
  sr: number | null;
  baseline: number | null;
  attempts: number;
}

export interface MethodBreakdownRow {
  method: string;
  label: string;
  sharePct: number;
  attempts: number;
  revenuePaise: number;
  srPct: number | null;
  baselineSrPct: number | null;
  status: "healthy" | "watch" | "degraded";
}

export interface RiskByIncidentRow {
  code: string;
  severity: Severity;
  status: IncidentStatus;
  scopeLabel: string;
  atRiskPaise: number;
}

export interface OverviewSnapshot {
  asOf: string;
  dayStart: string;
  kpis: OverviewKpis;
  revenueTrend: RevenueTrendPoint[];
  successRateTrend: SuccessRateTrendPoint[];
  methodBreakdown: MethodBreakdownRow[];
  riskByIncident: RiskByIncidentRow[];
}

export type EvidenceUnit = "pct" | "ms" | "count";

export interface EvidenceRow {
  signal: string;
  unit: EvidenceUnit;
  observed: number | null;
  baseline: number | null;
  worseWhen: "higher" | "lower";
}

export interface SegmentRow {
  segment: string;
  attempts: number;
  lostTransactions: number;
  lostPaise: number;
  impactPct?: number;
}

export interface SparkPoint {
  ts: string;
  sr: number;
  attempts: number;
  inIncident: boolean;
}

export interface FailureMixRow {
  reason: string;
  label: string;
  category: string;
  count: number;
  sharePct: number | null;
  baselineSharePct: number | null;
}

export interface VerificationRow {
  metric: string;
  unit: "pct" | "ms";
  before: number | null;
  after: number | null;
}

export interface IncidentReport {
  incidentCode: string;
  scopeLabel: string;
  baselineWindow: { start: string; end: string };
  evidence: EvidenceRow[];
  segments: SegmentRow[];
  sparkline: SparkPoint[];
  failureMix: FailureMixRow[];
  verification: VerificationRow[];
  observed: {
    attempts: number;
    successes: number;
    attemptedPaise: number;
    capturedPaise: number;
  };
}

/**
 * Every backend read returns this envelope so the UI can render an honest
 * "data unavailable" state instead of a blank screen when the dataset or
 * the database is not reachable.
 */
export type DataResult<T> = { ok: true; data: T } | { ok: false; reason: string };
