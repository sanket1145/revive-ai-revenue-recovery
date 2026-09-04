import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Check, Lock, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/revive/shell";
import {
  Panel,
  PolicyBadge,
  SeverityBadge,
  StatusBadge,
  Badge,
} from "@/components/revive/primitives";
import { SafetyPipeline } from "@/components/revive/pipeline";
import { PlaybookPanel } from "@/components/revive/playbook";
import {
  DataUnavailable,
  EmptyState,
  ErrorState,
  LoadingScreen,
} from "@/components/revive/states";
import { recoveryQuery } from "@/lib/revive/queries";
import { formatCount, formatINR, formatIST } from "@/lib/revive/format";
import { PIPELINE_STAGES } from "@/lib/revive/config";
import { detectionSignature } from "@/lib/revive/summary";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/recovery")({
  head: () => ({
    meta: [
      { title: "Recovery Actions — REVIVE AI" },
      {
        name: "description",
        content:
          "Recovery candidates ranked by revenue at risk, with the AI → policy engine → bounded execution safety rail and its current enablement state.",
      },
      { property: "og:title", content: "Recovery Actions — REVIVE AI" },
      {
        property: "og:description",
        content:
          "Every AI-proposed recovery action must clear a deterministic policy engine before any execution. Autonomous execution is disabled.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(recoveryQuery()),
  pendingComponent: () => (
    <AppShell title="Recovery Actions" subtitle="Loading candidates…">
      <LoadingScreen />
    </AppShell>
  ),
  errorComponent: ({ error }) => (
    <AppShell title="Recovery Actions">
      <ErrorState error={error} />
    </AppShell>
  ),
  component: RecoveryPage,
});

function RecoveryPage() {
  const router = useRouter();
  const { data: result } = useSuspenseQuery(recoveryQuery());

  if (!result.ok) {
    return (
      <AppShell title="Recovery Actions">
        <DataUnavailable reason={result.reason} onRetry={() => void router.invalidate()} />
      </AppShell>
    );
  }

  const { meta, incidents, actions, auditByIncident } = result.data;
  const open = incidents.filter((i) => i.status !== "recovered");
  const addressable = open.reduce((s, i) => s + i.revenueAtRiskPaise, 0);
  const recovered = incidents.reduce((s, i) => s + i.revenueRecoveredPaise, 0);
  const executedActions = actions.filter((a) => a.executionStatus === "executed");
  const anyBlocked = actions.some((a) => a.policyStatus === "blocked");
  const pipelineStage = executedActions.some((a) => a.verification)
    ? 5
    : executedActions.length > 0
      ? 4
      : actions.some((a) => a.policyStatus === "approved")
        ? 2
        : actions.length > 0
          ? 1
          : incidents.some((i) => i.diagnosis)
            ? 0
            : -1;
  const byIncident = new Map<string, typeof actions>();
  for (const a of actions) {
    byIncident.set(a.incidentCode, [...(byIncident.get(a.incidentCode) ?? []), a]);
  }

  return (
    <AppShell
      title="Recovery Actions"
      subtitle="AI proposes · policy engine decides · humans approve customer-facing changes"
      meta={meta}
    >
      <Panel title="Safety workflow">
        <SafetyPipeline activeIndex={pipelineStage} blocked={anyBlocked} />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          REVIVE AI never executes financial actions directly. Every recommendation is evaluated
          against deterministic policy rules; approved actions run first in bounded test mode, are
          verified against live metrics, and are written to an immutable audit log. Nothing in the
          rail is self-approving.
        </p>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE_STAGES.map((stage) => (
            <li
              key={stage.name}
              className={cn(
                "rounded-md border p-3",
                stage.enabled
                  ? "border-success/30 bg-success/8"
                  : "border-border bg-elevated/60",
              )}
            >
              <div className="flex items-center gap-2 text-xs font-medium">
                {stage.enabled ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Lock className="size-3.5 text-muted-foreground" />
                )}
                {stage.name}
                <span
                  className={cn(
                    "ml-auto text-[10px] uppercase tracking-wide",
                    stage.enabled ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {stage.enabled ? "live" : "not enabled"}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {stage.note}
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Actions proposed
          </p>
          <p className="num mt-1 text-2xl font-semibold">{actions.length}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            across {byIncident.size} investigated incident{byIncident.size === 1 ? "" : "s"}
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Policy verdicts
          </p>
          <p className="num mt-1 text-2xl font-semibold">
            {actions.filter((a) => a.policyStatus === "approved").length}
            <span className="text-sm font-normal text-muted-foreground"> approved</span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {actions.filter((a) => a.policyStatus === "requires_approval").length} need a human ·{" "}
            {actions.filter((a) => a.policyStatus === "blocked").length} blocked
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Addressable at risk
          </p>
          <p className="num mt-1 text-2xl font-semibold text-destructive">
            {formatINR(addressable)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            across {open.length} open incident{open.length === 1 ? "" : "s"}
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Recovered by REVIVE
          </p>
          <p
            className={cn(
              "num mt-1 text-2xl font-semibold",
              recovered > 0 ? "text-success" : "text-foreground",
            )}
          >
            {formatINR(recovered)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {executedActions.length === 0
              ? "no batch has been executed"
              : `${executedActions.length} verified canary batch${executedActions.length === 1 ? "" : "es"}`}
          </p>
        </Panel>
      </div>

      <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/8 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <ShieldAlert className="size-4" />
          Autonomous financial execution is disabled
        </div>
        <p className="mt-2 max-w-4xl text-xs leading-relaxed text-destructive/90">
          REVIVE holds no credentials to move money, alter pricing, issue refunds or change payment
          routing. Actions that create financial concessions, initiate refunds or debits, or change
          customer-facing checkout behaviour are permanently outside the AI&rsquo;s authority. The
          only executable actions are the two bounded ones below, capped at 50 transactions and run
          in test mode; anything above the exposure ceiling routes to a human approver.
        </p>
      </div>

      <Panel
        title="Recovery candidates"
        className="mt-4"
        action={
          <span className="num text-[11px] text-muted-foreground">
            ranked by revenue at risk
          </span>
        }
      >
        {incidents.length === 0 ? (
          <EmptyState
            title="No recovery candidates"
            description="Candidates appear as soon as the detection engine opens an incident."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Incident</th>
                  <th className="pb-2 pr-4 font-medium">Scope</th>
                  <th className="pb-2 pr-4 font-medium">Detected failure signature</th>
                  <th className="pb-2 pr-4 font-medium">Revenue at risk</th>
                  <th className="pb-2 pr-4 font-medium">Audit records</th>
                  <th className="pb-2 font-medium">Playbook</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.code} className="border-b border-border/60 align-top">
                    <td className="py-3 pr-4">
                      <Link
                        to="/incidents/$incidentId"
                        params={{ incidentId: incident.code }}
                        className="num text-xs font-semibold text-primary hover:underline"
                      >
                        {incident.code}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <SeverityBadge severity={incident.severity} />
                        <StatusBadge status={incident.status} />
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-medium">{incident.scopeLabel}</span>
                      <p className="num mt-1 text-[11px] text-muted-foreground">
                        {formatIST(incident.windowStart)} IST ·{" "}
                        {formatCount(incident.affectedTransactions)} failed
                      </p>
                    </td>
                    <td className="max-w-[320px] py-3 pr-4 text-xs text-muted-foreground">
                      {detectionSignature(incident)}
                    </td>
                    <td className="num py-3 pr-4 font-medium text-destructive">
                      {formatINR(incident.revenueAtRiskPaise)}
                    </td>
                    <td className="num py-3 pr-4 text-muted-foreground">
                      {auditByIncident[incident.code] ?? 0}
                    </td>
                    <td className="py-3">
                      {(() => {
                        const rows = byIncident.get(incident.code) ?? [];
                        if (rows.length === 0) return <Badge tone="warning">awaiting AI</Badge>;
                        return (
                          <div className="flex flex-wrap gap-1.5">
                            {rows.map((a) => (
                              <PolicyBadge key={a.actionKey} status={a.policyStatus} />
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {[...byIncident.entries()].map(([code, rows]) => (
        <div key={code} className="mt-4">
          <div className="flex items-center gap-2">
            <Link
              to="/incidents/$incidentId"
              params={{ incidentId: code }}
              className="num text-xs font-semibold text-primary hover:underline"
            >
              {code}
            </Link>
            <span className="text-xs text-muted-foreground">
              {incidents.find((i) => i.code === code)?.scopeLabel}
            </span>
          </div>
          <PlaybookPanel incidentCode={code} actions={rows} investigated />
        </div>
      ))}
    </AppShell>
  );
}
