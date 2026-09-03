import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/revive/shell";
import { IncidentCard } from "@/components/revive/incident-card";
import { Panel } from "@/components/revive/primitives";
import { formatINR, incidents } from "@/lib/revive-data";

export const Route = createFileRoute("/incidents/")({
  head: () => ({
    meta: [
      { title: "Revenue Incidents — REVIVE AI" },
      {
        name: "description",
        content:
          "Every detected revenue degradation event with severity, revenue at risk, affected transactions and AI root-cause confidence.",
      },
      { property: "og:title", content: "Revenue Incidents — REVIVE AI" },
      {
        property: "og:description",
        content:
          "Triage queue of merchant revenue incidents ranked by revenue at risk and severity.",
      },
    ],
  }),
  component: IncidentsPage,
});

function IncidentsPage() {
  const totalRisk = incidents.reduce((s, i) => s + i.revenueAtRisk, 0);
  const totalRecovered = incidents.reduce((s, i) => s + i.revenueRecovered, 0);
  const txns = incidents.reduce((s, i) => s + i.affectedTransactions, 0);

  return (
    <AppShell
      title="Revenue Incidents"
      subtitle={`${incidents.length} incidents in the last 48 hours`}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Total revenue at risk
          </p>
          <p className="num mt-1 text-2xl font-semibold text-destructive">
            {formatINR(totalRisk)}
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Recovered so far
          </p>
          <p className="num mt-1 text-2xl font-semibold text-success">
            {formatINR(totalRecovered)}
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Transactions impacted
          </p>
          <p className="num mt-1 text-2xl font-semibold">{txns.toLocaleString("en-IN")}</p>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {incidents.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} />
        ))}
      </div>
    </AppShell>
  );
}
