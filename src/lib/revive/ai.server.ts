/**
 * REVIVE AI investigation model call.
 *
 * The model is given ONLY measured values pulled from the transaction ledger
 * (incident aggregates, evidence signals, segment attribution and failure mix)
 * and is instructed to explain them. It never sees, and never invents, numbers
 * that are not in the payload: the UI renders the measured figures itself and
 * uses the model purely for the causal explanation and its confidence.
 *
 * Server-only: reads LOVABLE_API_KEY inside the call.
 */
import type { IncidentRecord, IncidentReport } from "./types";

const MODEL = "google/gemini-3.7-flash";
const ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface DiagnosisResult {
  rootCause: string;
  diagnosis: string;
  confidence: number;
  evidence: { signal: string; detail: string }[];
}

function buildFacts(incident: IncidentRecord, report: IncidentReport | null) {
  return {
    incident: {
      code: incident.code,
      title: incident.title,
      scope: incident.scopeLabel,
      paymentMethod: incident.scopeMethod,
      issuer: incident.scopeIssuer,
      window: { start: incident.windowStart, end: incident.windowEnd },
      observedSuccessRatePct: incident.observedSuccessRate,
      baselineSuccessRatePct: incident.baselineSuccessRate,
      dropPp: incident.dropPp,
      dropPct: incident.dropPct,
      zScore: incident.zScore,
      attempts: incident.attemptedTransactions,
      failures: incident.affectedTransactions,
      revenueAtRiskRupees: Math.round(incident.revenueAtRiskPaise / 100),
      dominantFailureReason: incident.dominantFailureReason,
      dominantFailureSharePct: incident.dominantFailureSharePct,
      detectionRule: incident.detectionRule,
    },
    evidenceSignals: report?.evidence ?? [],
    affectedSegments: report?.segments ?? [],
    failureMix: report?.failureMix ?? [],
  };
}

const SYSTEM = `You are REVIVE, a payments revenue-incident analyst for an Indian merchant on Razorpay.
You receive ONLY measured aggregates computed from the merchant's own transaction ledger.

Rules:
- Explain the most likely root cause of the payment success-rate degradation using the supplied numbers.
- Cite numbers exactly as given. NEVER invent a metric, a percentage, an issuer, a device or a segment that is not in the payload.
- Root cause must be a short noun phrase (max 8 words), e.g. "UPI collect degradation at PSP-PRIMARY".
- The diagnosis is 2-3 sentences of plain professional payments language: what broke, which segments carry the loss, and why the failure signature supports that conclusion.
- Confidence is an integer 0-100 reflecting how unambiguously the evidence points to one cause. Concentrated failure signatures with a high z-score justify high confidence; diffuse or mixed signatures do not.
- Provide 3 to 5 evidence lines. Each has a short signal name and a one-sentence detail quoting the measured value.
- If the evidence is weak or contradictory, say so and lower the confidence. Never overstate.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["root_cause", "diagnosis", "confidence", "evidence"],
  properties: {
    root_cause: { type: "string" },
    diagnosis: { type: "string" },
    confidence: { type: "integer" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["signal", "detail"],
        properties: { signal: { type: "string" }, detail: { type: "string" } },
      },
    },
  },
} as const;

export async function runInvestigation(
  incident: IncidentRecord,
  report: IncidentReport | null,
): Promise<DiagnosisResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project (missing gateway key).");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content:
            "Diagnose this detected revenue incident from the measured facts below (JSON).\n\n" +
            JSON.stringify(buildFacts(incident, report)),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "incident_diagnosis", strict: true, schema: SCHEMA },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      throw new Error("The AI service is rate limited right now. Try again in a moment.");
    }
    if (response.status === 402) {
      throw new Error("AI credits are exhausted for this workspace. Add credits and retry.");
    }
    throw new Error(`AI investigation failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("The AI service returned an empty diagnosis.");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("The AI service returned an unparseable diagnosis.");
  }

  const rawEvidence = Array.isArray(parsed["evidence"]) ? parsed["evidence"] : [];
  const confidence = Number(parsed["confidence"]);

  return {
    rootCause: String(parsed["root_cause"] ?? "").trim() || "Undetermined",
    diagnosis: String(parsed["diagnosis"] ?? "").trim(),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : 0,
    evidence: rawEvidence.slice(0, 6).map((e) => {
      const row = (e ?? {}) as Record<string, unknown>;
      return {
        signal: String(row["signal"] ?? "").trim(),
        detail: String(row["detail"] ?? "").trim(),
      };
    }),
  };
}
