/**
 * Row → DTO mappers. PostgREST returns `numeric` and `bigint` columns as JSON
 * numbers, but they can arrive as strings depending on driver settings, so
 * everything numeric is coerced defensively here — once, at the boundary.
 */
import type {
  AuditEventRecord,
  IncidentRecord,
  IncidentReport,
  IncidentStatus,
  OverviewSnapshot,
  ScopeType,
  Severity,
  SystemMeta,
} from "./types";

type Row = Record<string, unknown>;

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const STATUSES: IncidentStatus[] = [
  "detected",
  "investigating",
  "recovering",
  "monitoring",
  "recovered",
];
const SCOPES: ScopeType[] = ["global", "payment_method", "payment_method_issuer"];

function severity(value: unknown): Severity {
  const v = str(value) as Severity;
  return SEVERITIES.includes(v) ? v : "low";
}

function status(value: unknown): IncidentStatus {
  const v = str(value) as IncidentStatus;
  return STATUSES.includes(v) ? v : "detected";
}

function scopeType(value: unknown): ScopeType {
  const v = str(value) as ScopeType;
  return SCOPES.includes(v) ? v : "global";
}

export function mapIncident(row: Row): IncidentRecord {
  return {
    code: str(row["incident_code"]),
    naturalKey: str(row["natural_key"]),
    title: str(row["title"]),
    severity: severity(row["severity"]),
    status: status(row["status"]),
    metric: str(row["metric"], "payment_success_rate"),

    scopeType: scopeType(row["scope_type"]),
    scopeLabel: str(row["scope_label"]),
    scopeMethod: strOrNull(row["scope_method"]),
    scopeIssuer: strOrNull(row["scope_issuer"]),

    detectedAt: str(row["detected_at"]),
    windowStart: str(row["window_start"]),
    windowEnd: str(row["window_end"]),
    resolvedAt: strOrNull(row["resolved_at"]),

    observedSuccessRate: num(row["observed_success_rate"]),
    baselineSuccessRate: num(row["baseline_success_rate"]),
    dropPp: num(row["drop_pp"]),
    dropPct: num(row["drop_pct"]),
    zScore: num(row["z_score"]),

    attemptedTransactions: num(row["attempted_transactions"]),
    affectedTransactions: num(row["affected_transactions"]),
    revenueAtRiskPaise: num(row["revenue_at_risk_paise"]),
    revenueRecoveredPaise: num(row["revenue_recovered_paise"]),

    dominantFailureReason: strOrNull(row["dominant_failure_reason"]),
    dominantFailureSharePct: numOrNull(row["dominant_failure_share"]),

    detectionRule: str(row["detection_rule"]),

    rootCause: strOrNull(row["root_cause"]),
    diagnosis: strOrNull(row["diagnosis"]),
    confidence: numOrNull(row["confidence"]),
  };
}

export function mapAuditEvent(row: Row): AuditEventRecord {
  return {
    id: str(row["id"]),
    code: str(row["event_code"]),
    occurredAt: str(row["occurred_at"]),
    actor: str(row["actor"]),
    stage: str(row["stage"], "detection") as AuditEventRecord["stage"],
    event: str(row["event"]),
    detail: str(row["detail"]),
    outcome: str(row["outcome"], "info") as AuditEventRecord["outcome"],
    incidentCode: strOrNull(row["incident_code"]),
  };
}

export function mapSystemMeta(row: Row, refreshedAt: string | null): SystemMeta {
  return {
    merchantName: str(row["merchant_name"], "—"),
    merchantId: str(row["merchant_id"], "—"),
    seed: str(row["seed"], "—"),
    generatorVersion: str(row["generator_version"], "—"),
    windowStart: str(row["window_start"]),
    asOf: str(row["as_of"]),
    transactionCount: num(row["transaction_count"]),
    detectionRule: str(row["detection_rule"], "rolling-baseline-z-v1"),
    autonomousExecution: false,
    refreshedAt,
  };
}

/**
 * The overview payload is produced by `revive_refresh_projections()` and is
 * already shaped for the UI; this narrows it to the typed DTO.
 */
export function mapOverview(payload: Row): OverviewSnapshot {
  const kpis = (payload["kpis"] ?? {}) as Row;
  const revenueTrend = (payload["revenueTrend"] ?? []) as Row[];
  const successRateTrend = (payload["successRateTrend"] ?? []) as Row[];
  const methodBreakdown = (payload["methodBreakdown"] ?? []) as Row[];
  const riskByIncident = (payload["riskByIncident"] ?? []) as Row[];

  return {
    asOf: str(payload["asOf"]),
    dayStart: str(payload["dayStart"]),
    kpis: {
      revenueTodayPaise: num(kpis["revenueTodayPaise"]),
      revenueTodayDeltaPct: numOrNull(kpis["revenueTodayDeltaPct"]),
      revenueAtRiskPaise: num(kpis["revenueAtRiskPaise"]),
      revenueAtRiskDeltaPct: numOrNull(kpis["revenueAtRiskDeltaPct"]),
      revenueRecoveredPaise: num(kpis["revenueRecoveredPaise"]),
      recoveryRatePct: num(kpis["recoveryRatePct"]),
      activeIncidents: num(kpis["activeIncidents"]),
      activeIncidentsDelta: num(kpis["activeIncidentsDelta"]),
      attemptsToday: num(kpis["attemptsToday"]),
      successRatePct: numOrNull(kpis["successRatePct"]),
      successRateBaselinePct: numOrNull(kpis["successRateBaselinePct"]),
    },
    revenueTrend: revenueTrend.map((p) => ({
      ts: str(p["ts"]),
      time: str(p["time"]),
      revenuePaise: num(p["revenuePaise"]),
      baselinePaise: num(p["baselinePaise"]),
    })),
    successRateTrend: successRateTrend.map((p) => ({
      ts: str(p["ts"]),
      time: str(p["time"]),
      sr: numOrNull(p["sr"]),
      baseline: numOrNull(p["baseline"]),
      attempts: num(p["attempts"]),
    })),
    methodBreakdown: methodBreakdown.map((m) => ({
      method: str(m["method"]),
      label: str(m["label"]),
      sharePct: num(m["sharePct"]),
      attempts: num(m["attempts"]),
      revenuePaise: num(m["revenuePaise"]),
      srPct: numOrNull(m["srPct"]),
      baselineSrPct: numOrNull(m["baselineSrPct"]),
      status: str(m["status"], "healthy") as "healthy" | "watch" | "degraded",
    })),
    riskByIncident: riskByIncident.map((r) => ({
      code: str(r["code"]),
      severity: severity(r["severity"]),
      status: status(r["status"]),
      scopeLabel: str(r["scopeLabel"]),
      atRiskPaise: num(r["atRiskPaise"]),
    })),
  };
}

export function mapIncidentReport(code: string, payload: Row): IncidentReport {
  const evidence = (payload["evidence"] ?? []) as Row[];
  const segments = (payload["segments"] ?? []) as Row[];
  const sparkline = (payload["sparkline"] ?? []) as Row[];
  const failureMix = (payload["failureMix"] ?? []) as Row[];
  const verification = (payload["verification"] ?? []) as Row[];
  const observed = (payload["observed"] ?? {}) as Row;
  const baselineWindow = (payload["baselineWindow"] ?? {}) as Row;

  return {
    incidentCode: code,
    scopeLabel: str(payload["scopeLabel"]),
    baselineWindow: {
      start: str(baselineWindow["start"]),
      end: str(baselineWindow["end"]),
    },
    evidence: evidence.map((e) => ({
      signal: str(e["signal"]),
      unit: str(e["unit"], "pct") as "pct" | "ms" | "count",
      observed: numOrNull(e["observed"]),
      baseline: numOrNull(e["baseline"]),
      worseWhen: str(e["worseWhen"], "lower") as "higher" | "lower",
    })),
    segments: segments.map((s) => ({
      segment: str(s["segment"]),
      attempts: num(s["attempts"]),
      lostTransactions: num(s["lostTransactions"]),
      lostPaise: num(s["lostPaise"]),
      impactPct: num(s["impactPct"]),
    })),
    sparkline: sparkline.map((p) => ({
      ts: str(p["ts"]),
      sr: num(p["sr"]),
      attempts: num(p["attempts"]),
      inIncident: p["inIncident"] === true,
    })),
    failureMix: failureMix.map((f) => ({
      reason: str(f["reason"]),
      label: str(f["label"]),
      category: str(f["category"], "other"),
      count: num(f["count"]),
      sharePct: numOrNull(f["sharePct"]),
      baselineSharePct: numOrNull(f["baselineSharePct"]),
    })),
    verification: verification.map((v) => ({
      metric: str(v["metric"]),
      unit: str(v["unit"], "pct") as "pct" | "ms",
      before: numOrNull(v["before"]),
      after: numOrNull(v["after"]),
    })),
    observed: {
      attempts: num(observed["attempts"]),
      successes: num(observed["successes"]),
      attemptedPaise: num(observed["attemptedPaise"]),
      capturedPaise: num(observed["capturedPaise"]),
    },
  };
}
