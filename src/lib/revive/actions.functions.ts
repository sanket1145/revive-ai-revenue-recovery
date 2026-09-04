/**
 * REVIVE write API — investigation, playbook proposal, human approval and
 * bounded canary execution.
 *
 * Every mutation runs through a SECURITY DEFINER SQL routine so the rules
 * (eligibility, policy checks, idempotency, audit writes) live in one
 * deterministic place and cannot be bypassed from the browser. These server
 * functions only orchestrate; they never compute money themselves.
 */
import { createServerFn } from "@tanstack/react-start";
import { mapIncident, mapIncidentReport } from "./mappers";
import type { DataResult } from "./types";

type Row = Record<string, unknown>;

function failure(reason: unknown): { ok: false; reason: string } {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Unexpected backend error.";
  console.error("[revive] action failed:", message);
  return { ok: false, reason: message };
}

const codeInput = (input: { code: string }) => ({ code: String(input.code ?? "").trim() });

/**
 * Step 2 — run the AI investigation for one incident, persist the diagnosis
 * with its cited evidence and the deterministic recovery-opportunity score,
 * then let the policy engine evaluate the bounded playbook.
 */
export const investigateIncident = createServerFn({ method: "POST" })
  .inputValidator(codeInput)
  .handler(async ({ data }): Promise<DataResult<{ confidence: number; rootCause: string }>> => {
    try {
      if (!data.code) return { ok: false, reason: "No incident code supplied." };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { runInvestigation } = await import("./ai.server");

      const [incidentRes, reportRes] = await Promise.all([
        supabaseAdmin.from("incidents").select("*").eq("incident_code", data.code).maybeSingle(),
        supabaseAdmin
          .from("incident_reports")
          .select("payload")
          .eq("incident_code", data.code)
          .maybeSingle(),
      ]);
      if (incidentRes.error) throw new Error(incidentRes.error.message);
      if (!incidentRes.data) return { ok: false, reason: `${data.code} is not in the register.` };

      const incident = mapIncident(incidentRes.data as Row);
      const report =
        !reportRes.error && reportRes.data
          ? mapIncidentReport(data.code, (reportRes.data as Row)["payload"] as Row)
          : null;

      const diagnosis = await runInvestigation(incident, report);

      const scoreRes = await supabaseAdmin.rpc("revive_recovery_score", { p_code: data.code });
      if (scoreRes.error) throw new Error(scoreRes.error.message);
      const score = (scoreRes.data ?? null) as Row | null;

      const update = await supabaseAdmin
        .from("incidents")
        .update({
          root_cause: diagnosis.rootCause,
          diagnosis: diagnosis.diagnosis,
          confidence: diagnosis.confidence,
          evidence: { points: diagnosis.evidence, score },
          recovery_score: score ? Number(score["score"] ?? 0) : null,
          investigated_at: new Date().toISOString(),
          status: incident.status === "detected" ? "investigating" : incident.status,
        })
        .eq("incident_code", data.code);
      if (update.error) throw new Error(update.error.message);

      await supabaseAdmin.rpc("revive_audit", {
        p_stage: "investigation",
        p_actor: "REVIVE Investigation Model",
        p_event: "AI diagnosis generated",
        p_detail: `Root cause: ${diagnosis.rootCause} · confidence ${diagnosis.confidence}% · ${diagnosis.evidence.length} evidence lines cited from the ledger.`,
        p_outcome: "info",
        p_incident: data.code,
        p_metadata: { confidence: diagnosis.confidence, model: "gemini-3.7-flash" },
      });

      const propose = await supabaseAdmin.rpc("revive_propose_recovery", { p_code: data.code });
      if (propose.error) throw new Error(propose.error.message);

      return {
        ok: true,
        data: { confidence: diagnosis.confidence, rootCause: diagnosis.rootCause },
      };
    } catch (error) {
      return failure(error);
    }
  });

/** Re-evaluate the playbook against the policy engine without re-running the model. */
export const refreshPolicy = createServerFn({ method: "POST" })
  .inputValidator(codeInput)
  .handler(async ({ data }): Promise<DataResult<null>> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const res = await supabaseAdmin.rpc("revive_propose_recovery", { p_code: data.code });
      if (res.error) throw new Error(res.error.message);
      return { ok: true, data: null };
    } catch (error) {
      return failure(error);
    }
  });

/** Step 3 — human approve / reject for actions the policy engine escalated. */
export const decideRecoveryAction = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string; actionKey: string; decision: "approve" | "reject" }) => ({
    code: String(input.code ?? "").trim(),
    actionKey: String(input.actionKey ?? "").trim(),
    decision: input.decision === "approve" ? ("approve" as const) : ("reject" as const),
  }))
  .handler(async ({ data }): Promise<DataResult<null>> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const res = await supabaseAdmin.rpc("revive_decide_recovery", {
        p_code: data.code,
        p_action: data.actionKey,
        p_decision: data.decision,
      });
      if (res.error) throw new Error(res.error.message);
      const out = (res.data ?? {}) as Row;
      if (out["ok"] === false) return { ok: false, reason: String(out["reason"] ?? "Rejected.") };
      return { ok: true, data: null };
    } catch (error) {
      return failure(error);
    }
  });

export interface ExecutionResult {
  attempted: number;
  recovered: number;
  recoveredPaise: number;
  recoveryRatePct: number;
}

/** Step 3 — bounded canary batch (max 50 transactions), test mode only. */
export const executeRecoveryAction = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string; actionKey: string }) => ({
    code: String(input.code ?? "").trim(),
    actionKey: String(input.actionKey ?? "").trim(),
  }))
  .handler(async ({ data }): Promise<DataResult<ExecutionResult>> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const res = await supabaseAdmin.rpc("revive_execute_recovery", {
        p_code: data.code,
        p_action: data.actionKey,
      });
      if (res.error) throw new Error(res.error.message);
      const out = (res.data ?? {}) as Row;
      if (out["ok"] === false) {
        return { ok: false, reason: String(out["reason"] ?? "Execution refused.") };
      }
      return {
        ok: true,
        data: {
          attempted: Number(out["attempted"] ?? 0),
          recovered: Number(out["recovered"] ?? 0),
          recoveredPaise: Number(out["recoveredPaise"] ?? 0),
          recoveryRatePct: Number(out["recoveryRatePct"] ?? 0),
        },
      };
    } catch (error) {
      return failure(error);
    }
  });
