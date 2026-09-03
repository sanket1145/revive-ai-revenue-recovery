/**
 * Deterministic incident narrative.
 *
 * Step 1 has no LLM in the loop. Everything below is assembled from measured
 * values in the incident record and its computed report, so the investigation
 * page can show a defensible written summary without fabricating a root cause.
 * The AI investigation service (Step 2) will add a real `diagnosis` field on
 * the incident row; when that exists the UI prefers it over this text.
 */
import {
  durationLabel,
  formatCount,
  formatINR,
  formatISTTime,
  formatMs,
  humaniseReason,
} from "./format";
import type { IncidentRecord, IncidentReport } from "./types";

function findEvidence(report: IncidentReport | null, needle: string) {
  return report?.evidence.find((e) => e.signal.toLowerCase().includes(needle)) ?? null;
}

/** Qualitative label for a two-proportion z-score. */
export function signalStrength(z: number): { label: string; tone: "critical" | "warning" | "info" } {
  if (z >= 10) return { label: "overwhelming", tone: "critical" };
  if (z >= 6) return { label: "very strong", tone: "critical" };
  if (z >= 4) return { label: "strong", tone: "warning" };
  return { label: "clear", tone: "info" };
}

/**
 * Returns 2–4 paragraphs of measured, non-speculative narrative.
 */
export function buildDetectionNarrative(
  incident: IncidentRecord,
  report: IncidentReport | null,
): string[] {
  const paragraphs: string[] = [];
  const strength = signalStrength(incident.zScore);

  const observedAttempts = report?.observed.attempts ?? incident.attemptedTransactions;
  const observedSuccesses =
    report?.observed.successes ??
    Math.round((incident.observedSuccessRate / 100) * incident.attemptedTransactions);

  paragraphs.push(
    `Between ${formatISTTime(incident.windowStart)} and ${formatISTTime(incident.windowEnd)} IST ` +
      `(${durationLabel(incident.windowStart, incident.windowEnd)}), the ${incident.scopeLabel} scope ` +
      `authorised ${formatCount(observedSuccesses)} of ${formatCount(observedAttempts)} attempts ` +
      `— ${incident.observedSuccessRate.toFixed(2)}% against a trailing 7-day baseline of ` +
      `${incident.baselineSuccessRate.toFixed(2)}%. That is a ${incident.dropPp.toFixed(2)} pp absolute drop ` +
      `(${incident.dropPct.toFixed(1)}% relative) at a two-proportion z-score of ${incident.zScore.toFixed(2)}, ` +
      `which is ${strength.label} statistical separation from normal variance.`,
  );

  const failure = findEvidence(report, "share of attempts");
  const latency = findEvidence(report, "latency");
  const failureBits: string[] = [];

  if (failure && failure.observed != null && failure.baseline != null) {
    failureBits.push(
      `${failure.signal.replace(" — share of attempts", "")} accounted for ` +
        `${failure.observed.toFixed(2)}% of in-scope attempts versus ${failure.baseline.toFixed(2)}% at baseline`,
    );
  } else if (incident.dominantFailureReason) {
    failureBits.push(
      `the dominant failure signature is ${humaniseReason(incident.dominantFailureReason)}` +
        (incident.dominantFailureSharePct != null
          ? ` at ${incident.dominantFailureSharePct.toFixed(2)}% of in-scope attempts`
          : ""),
    );
  }

  if (latency && latency.observed != null && latency.baseline != null) {
    failureBits.push(
      `authorisation latency p95 moved from ${formatMs(latency.baseline)} to ${formatMs(latency.observed)}`,
    );
  }

  if (failureBits.length > 0) {
    paragraphs.push(
      `Failure composition: ${failureBits.join(", and ")}. This is a gateway-response pattern, not a ` +
        `checkout or pricing regression — attempt volume in scope held at ` +
        `${formatCount(observedAttempts)} attempts, so customers were still reaching the payment step.`,
    );
  }

  const control = findEvidence(report, "control");
  if (control && control.observed != null && control.baseline != null) {
    const delta = control.observed - control.baseline;
    paragraphs.push(
      `Containment check: all traffic outside this scope ran at ${control.observed.toFixed(2)}% against a ` +
        `${control.baseline.toFixed(2)}% baseline (${delta >= 0 ? "+" : ""}${delta.toFixed(2)} pp), so the ` +
        `degradation is isolated to ${incident.scopeLabel} rather than platform-wide.`,
    );
  }

  const topSegment = report?.segments.find((s) => (s.impactPct ?? 0) > 0);
  if (topSegment) {
    paragraphs.push(
      `Concentration: ${topSegment.segment} carries ${(topSegment.impactPct ?? 0).toFixed(1)}% of lost ` +
        `authorisations (${formatCount(topSegment.lostTransactions)} transactions, ` +
        `${formatINR(topSegment.lostPaise)}). Revenue at risk of ${formatINR(incident.revenueAtRiskPaise)} is the ` +
        `shortfall between value captured in-window and value that the baseline authorisation rate would have captured ` +
        `on the same attempted amount.`,
    );
  } else {
    paragraphs.push(
      `Revenue at risk of ${formatINR(incident.revenueAtRiskPaise)} is the shortfall between value captured ` +
        `in-window and value the baseline authorisation rate would have captured on the same attempted amount.`,
    );
  }

  return paragraphs;
}

/** One-line factual replacement for the (Step 2) AI root-cause field. */
export function detectionSignature(incident: IncidentRecord): string {
  if (incident.rootCause) return incident.rootCause;
  if (!incident.dominantFailureReason) {
    return `Success-rate collapse in ${incident.scopeLabel} with no single dominant failure code — awaiting AI root-cause analysis.`;
  }
  const share =
    incident.dominantFailureSharePct != null
      ? ` (${incident.dominantFailureSharePct.toFixed(1)}% of in-scope attempts)`
      : "";
  return `Dominant failure signature: ${humaniseReason(incident.dominantFailureReason)}${share} concentrated in ${incident.scopeLabel}.`;
}
