import { queryOptions } from "@tanstack/react-query";
import {
  getAuditTrail,
  getDashboard,
  getIncidentDetail,
  getIncidents,
  getRecoveryQueue,
} from "./data.functions";

/**
 * The dataset is a fixed, deterministic snapshot, so a generous staleTime is
 * correct: nothing changes until the detector is re-run.
 */
const STALE_TIME = 5 * 60_000;

export const dashboardQuery = () =>
  queryOptions({
    queryKey: ["revive", "dashboard"] as const,
    queryFn: () => getDashboard(),
    staleTime: STALE_TIME,
  });

export const incidentsQuery = () =>
  queryOptions({
    queryKey: ["revive", "incidents"] as const,
    queryFn: () => getIncidents(),
    staleTime: STALE_TIME,
  });

export const incidentDetailQuery = (code: string) =>
  queryOptions({
    queryKey: ["revive", "incident", code] as const,
    queryFn: () => getIncidentDetail({ data: { code } }),
    staleTime: STALE_TIME,
  });

export const auditQuery = () =>
  queryOptions({
    queryKey: ["revive", "audit"] as const,
    queryFn: () => getAuditTrail(),
    staleTime: STALE_TIME,
  });

export const recoveryQuery = () =>
  queryOptions({
    queryKey: ["revive", "recovery"] as const,
    queryFn: () => getRecoveryQueue(),
    staleTime: STALE_TIME,
  });
