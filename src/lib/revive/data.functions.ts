/**
 * REVIVE read API — TanStack server functions.
 *
 * These are public (no bearer required) because everything they expose is
 * already covered by a public SELECT policy: derived projections, incident
 * records, and the append-only audit ledger. The raw `transactions` table is
 * never read from here — it has a deny-all RLS policy and is only reachable by
 * the service role inside SQL.
 *
 * Every function returns a `DataResult` envelope so the UI can distinguish
 * "backend down / dataset missing" from "no incidents right now".
 */
import { createServerFn } from "@tanstack/react-start";
import {
  mapAuditEvent,
  mapIncident,
  mapIncidentReport,
  mapOverview,
  mapRecoveryAction,
  mapSystemMeta,
} from "./mappers";
import type {
  AuditEventRecord,
  DataResult,
  IncidentRecord,
  IncidentReport,
  OverviewSnapshot,
  RecoveryAction,
  SystemMeta,
} from "./types";

type Row = Record<string, unknown>;

function failure(reason: unknown): { ok: false; reason: string } {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Unexpected backend error.";
  console.error("[revive] read failed:", message);
  return { ok: false, reason: message };
}

async function loadMeta(): Promise<{ meta: SystemMeta | null; refreshedAt: string | null }> {
  const { getPublicSupabase } = await import("./supabase.server");
  const supabase = getPublicSupabase();

  const [metaRes, snapshotRes] = await Promise.all([
    supabase.from("dataset_meta").select("*").eq("id", 1).maybeSingle(),
    supabase.from("dashboard_snapshot").select("refreshed_at").eq("id", 1).maybeSingle(),
  ]);

  if (metaRes.error) throw new Error(metaRes.error.message);
  const refreshedAt =
    snapshotRes.error || !snapshotRes.data
      ? null
      : ((snapshotRes.data as Row)["refreshed_at"] as string | null);

  if (!metaRes.data) return { meta: null, refreshedAt };
  return { meta: mapSystemMeta(metaRes.data as Row, refreshedAt), refreshedAt };
}

export interface DashboardPayload {
  meta: SystemMeta;
  snapshot: OverviewSnapshot;
  incidents: IncidentRecord[];
}

/** Overview page: KPI snapshot, trends, method mix and the live incident list. */
export const getDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataResult<DashboardPayload>> => {
    try {
      const { getPublicSupabase } = await import("./supabase.server");
      const supabase = getPublicSupabase();

      const [{ meta }, snapshotRes, incidentsRes] = await Promise.all([
        loadMeta(),
        supabase.from("dashboard_snapshot").select("payload").eq("id", 1).maybeSingle(),
        supabase.from("incidents").select("*").order("detected_at", { ascending: false }),
      ]);

      if (snapshotRes.error) throw new Error(snapshotRes.error.message);
      if (incidentsRes.error) throw new Error(incidentsRes.error.message);
      if (!meta) return { ok: false, reason: "No dataset has been generated yet." };
      if (!snapshotRes.data) {
        return { ok: false, reason: "Dashboard projection has not been built yet." };
      }

      const payload = (snapshotRes.data as Row)["payload"] as Row;

      return {
        ok: true,
        data: {
          meta,
          snapshot: mapOverview(payload),
          incidents: ((incidentsRes.data ?? []) as Row[]).map(mapIncident),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
);

export interface IncidentsPayload {
  meta: SystemMeta;
  incidents: IncidentRecord[];
}

/** Incidents register. */
export const getIncidents = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataResult<IncidentsPayload>> => {
    try {
      const { getPublicSupabase } = await import("./supabase.server");
      const supabase = getPublicSupabase();

      const [{ meta }, incidentsRes] = await Promise.all([
        loadMeta(),
        supabase.from("incidents").select("*").order("detected_at", { ascending: false }),
      ]);

      if (incidentsRes.error) throw new Error(incidentsRes.error.message);
      if (!meta) return { ok: false, reason: "No dataset has been generated yet." };

      return {
        ok: true,
        data: { meta, incidents: ((incidentsRes.data ?? []) as Row[]).map(mapIncident) },
      };
    } catch (error) {
      return failure(error);
    }
  },
);

export interface IncidentDetailPayload {
  meta: SystemMeta;
  incident: IncidentRecord;
  report: IncidentReport | null;
  audit: AuditEventRecord[];
  actions: RecoveryAction[];
  siblings: { code: string; title: string }[];
}

/** Investigation page for a single incident. */
export const getIncidentDetail = createServerFn({ method: "GET" })
  .inputValidator((input: { code: string }) => ({ code: String(input.code ?? "").trim() }))
  .handler(async ({ data }): Promise<DataResult<IncidentDetailPayload | null>> => {
    try {
      if (!data.code) return { ok: true, data: null };

      const { getPublicSupabase } = await import("./supabase.server");
      const supabase = getPublicSupabase();

      const [{ meta }, incidentRes, reportRes, auditRes, actionsRes, siblingsRes] =
        await Promise.all([
          loadMeta(),
          supabase.from("incidents").select("*").eq("incident_code", data.code).maybeSingle(),
          supabase
            .from("incident_reports")
            .select("payload")
            .eq("incident_code", data.code)
            .maybeSingle(),
          supabase
            .from("audit_events")
            .select("*")
            .eq("incident_code", data.code)
            .order("occurred_at", { ascending: true }),
          supabase
            .from("recovery_actions")
            .select("*")
            .eq("incident_code", data.code)
            .order("action_key", { ascending: true }),
          supabase
            .from("incidents")
            .select("incident_code,title")
            .order("detected_at", { ascending: false }),
        ]);

      if (incidentRes.error) throw new Error(incidentRes.error.message);
      if (!meta) return { ok: false, reason: "No dataset has been generated yet." };
      if (!incidentRes.data) return { ok: true, data: null };

      const reportPayload =
        !reportRes.error && reportRes.data
          ? ((reportRes.data as Row)["payload"] as Row)
          : null;

      return {
        ok: true,
        data: {
          meta,
          incident: mapIncident(incidentRes.data as Row),
          report: reportPayload ? mapIncidentReport(data.code, reportPayload) : null,
          audit: auditRes.error ? [] : ((auditRes.data ?? []) as Row[]).map(mapAuditEvent),
          actions: actionsRes.error
            ? []
            : ((actionsRes.data ?? []) as Row[]).map(mapRecoveryAction),
          siblings: siblingsRes.error
            ? []
            : ((siblingsRes.data ?? []) as Row[]).map((r) => ({
                code: String(r["incident_code"] ?? ""),
                title: String(r["title"] ?? ""),
              })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  });

export interface AuditPayload {
  meta: SystemMeta;
  events: AuditEventRecord[];
  incidents: { code: string; title: string; severity: string }[];
}

/** Full append-only audit ledger. */
export const getAuditTrail = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataResult<AuditPayload>> => {
    try {
      const { getPublicSupabase } = await import("./supabase.server");
      const supabase = getPublicSupabase();

      const [{ meta }, eventsRes, incidentsRes] = await Promise.all([
        loadMeta(),
        supabase
          .from("audit_events")
          .select("*")
          .order("occurred_at", { ascending: false })
          .limit(500),
        supabase
          .from("incidents")
          .select("incident_code,title,severity")
          .order("detected_at", { ascending: false }),
      ]);

      if (eventsRes.error) throw new Error(eventsRes.error.message);
      if (!meta) return { ok: false, reason: "No dataset has been generated yet." };

      return {
        ok: true,
        data: {
          meta,
          events: ((eventsRes.data ?? []) as Row[]).map(mapAuditEvent),
          incidents: incidentsRes.error
            ? []
            : ((incidentsRes.data ?? []) as Row[]).map((r) => ({
                code: String(r["incident_code"] ?? ""),
                title: String(r["title"] ?? ""),
                severity: String(r["severity"] ?? "low"),
              })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
);

export interface RecoveryPayload {
  meta: SystemMeta;
  incidents: IncidentRecord[];
  actions: RecoveryAction[];
  auditByIncident: Record<string, number>;
}

/** Recovery console: every proposed action with its policy verdict and result. */
export const getRecoveryQueue = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataResult<RecoveryPayload>> => {
    try {
      const { getPublicSupabase } = await import("./supabase.server");
      const supabase = getPublicSupabase();

      const [{ meta }, incidentsRes, auditRes, actionsRes] = await Promise.all([
        loadMeta(),
        supabase.from("incidents").select("*").order("revenue_at_risk_paise", { ascending: false }),
        supabase.from("audit_events").select("incident_code"),
        supabase.from("recovery_actions").select("*").order("expected_recovery_paise", {
          ascending: false,
        }),
      ]);

      if (incidentsRes.error) throw new Error(incidentsRes.error.message);
      if (!meta) return { ok: false, reason: "No dataset has been generated yet." };

      const auditByIncident: Record<string, number> = {};
      if (!auditRes.error) {
        for (const row of (auditRes.data ?? []) as Row[]) {
          const code = row["incident_code"];
          if (typeof code === "string" && code.length > 0) {
            auditByIncident[code] = (auditByIncident[code] ?? 0) + 1;
          }
        }
      }

      return {
        ok: true,
        data: {
          meta,
          incidents: ((incidentsRes.data ?? []) as Row[]).map(mapIncident),
          actions: actionsRes.error
            ? []
            : ((actionsRes.data ?? []) as Row[]).map(mapRecoveryAction),
          auditByIncident,
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
);
