import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/revive/shell";
import {
  ExecutionBadge,
  Panel,
  PolicyBadge,
  SeverityBadge,
} from "@/components/revive/primitives";
import { SafetyPipeline } from "@/components/revive/pipeline";
import { formatINR, incidents } from "@/lib/revive-data";

export const Route = createFileRoute("/recovery")({
  head: () => ({
    meta: [
      { title: "Recovery Actions — REVIVE AI" },
      {
        name: "description",
        content:
          "Bounded recovery playbook actions with policy-engine verdicts, expected recovery value and execution state across all open incidents.",
      },
      { property: "og:title", content: "Recovery Actions — REVIVE AI" },
      {
        property: "og:description",
        content:
          "Every AI-proposed recovery action passes a deterministic policy engine before any execution.",
      },
    ],
  }),
  component: RecoveryPage,
});

function RecoveryPage() {
  const rows = incidents.flatMap((incident) =>
    incident.playbook.map((action) => ({ incident, action })),
  );
  const blocked = rows.filter((r) => r.action.policyStatus === "blocked");
  const approved = rows.filter((r) => r.action.policyStatus === "approved");
  const expected = rows.reduce((s, r) => s + r.action.expectedRecovery, 0);

  return (
    <AppShell
      title="Recovery Actions"
      subtitle="AI proposes · policy engine decides · humans approve customer-facing changes"
    >
      <Panel title="Safety workflow">
        <SafetyPipeline />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          REVIVE AI never executes financial actions directly. Every recommendation is evaluated
          against deterministic policy rules; approved actions run first in bounded test mode, are
          verified against live metrics, and are written to an immutable audit log.
        </p>
      </Panel>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Actions proposed
          </p>
          <p className="num mt-1 text-2xl font-semibold">{rows.length}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Policy approved
          </p>
          <p className="num mt-1 text-2xl font-semibold text-success">{approved.length}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Expected recovery
          </p>
          <p className="num mt-1 text-2xl font-semibold">{formatINR(expected)}</p>
        </Panel>
      </div>

      {blocked.length > 0 && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/8 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <ShieldAlert className="size-4" />
            {blocked.length} actions blocked by policy engine
          </div>
          <ul className="mt-3 space-y-2">
            {blocked.map(({ incident, action }) => (
              <li key={`${incident.id}-${action.id}`} className="text-sm">
                <span className="num text-xs text-muted-foreground">{incident.id}</span>{" "}
                <span className="font-medium">{action.action}</span>
                <p className="text-xs text-destructive">{action.policyNote}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Panel title="All proposed actions" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Incident</th>
                <th className="pb-2 pr-4 font-medium">Action</th>
                <th className="pb-2 pr-4 font-medium">Reason</th>
                <th className="pb-2 pr-4 font-medium">Expected recovery</th>
                <th className="pb-2 pr-4 font-medium">Policy</th>
                <th className="pb-2 font-medium">Execution</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ incident, action }) => (
                <tr
                  key={`${incident.id}-${action.id}`}
                  className="border-b border-border/60 align-top"
                >
                  <td className="py-3 pr-4">
                    <Link
                      to="/incidents/$incidentId"
                      params={{ incidentId: incident.id }}
                      className="num text-xs font-semibold text-primary hover:underline"
                    >
                      {incident.id}
                    </Link>
                    <div className="mt-1">
                      <SeverityBadge severity={incident.severity} />
                    </div>
                  </td>
                  <td className="max-w-[240px] py-3 pr-4 font-medium">{action.action}</td>
                  <td className="max-w-[280px] py-3 pr-4 text-xs text-muted-foreground">
                    {action.reason}
                  </td>
                  <td className="num py-3 pr-4">{formatINR(action.expectedRecovery)}</td>
                  <td className="py-3 pr-4">
                    <PolicyBadge status={action.policyStatus} />
                    <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">
                      {action.policyNote}
                    </p>
                  </td>
                  <td className="py-3">
                    <ExecutionBadge status={action.executionStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
