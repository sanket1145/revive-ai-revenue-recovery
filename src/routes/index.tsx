import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/revive/shell";
import { Panel, Badge } from "@/components/revive/primitives";
import { IncidentCard } from "@/components/revive/incident-card";
import {
  RevenueTrendChart,
  RiskByIncidentChart,
  SuccessRateChart,
} from "@/components/revive/charts";
import { formatINR, incidents, kpis, methodBreakdown } from "@/lib/revive-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "REVIVE AI — Revenue Incident Commander" },
      {
        name: "description",
        content:
          "Detect merchant revenue degradation, diagnose root cause, and run policy-validated recovery playbooks from one incident command center.",
      },
      { property: "og:title", content: "REVIVE AI — Revenue Incident Commander" },
      {
        property: "og:description",
        content:
          "Live revenue-at-risk detection, AI root-cause diagnosis, and bounded recovery playbooks validated by a deterministic policy engine.",
      },
    ],
  }),
  component: Overview,
});

function Kpi({
  label,
  value,
  delta,
  positiveIsGood = true,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  positiveIsGood?: boolean;
  tone?: "critical" | "success";
}) {
  const isUp = delta.trim().startsWith("+");
  const good = positiveIsGood ? isUp : !isUp;
  return (
    <div className="panel p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "num mt-2 text-2xl font-semibold",
          tone === "critical" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "num mt-1 text-xs",
          good ? "text-success" : "text-destructive",
        )}
      >
        {delta} vs 7-day baseline
      </p>
    </div>
  );
}

function Overview() {
  const active = incidents.filter((i) => i.status !== "recovered");

  return (
    <AppShell
      title="Revenue Incident Command Center"
      subtitle="Live monitoring · 3 Sep 2026 · last sync 12s ago"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Revenue Today" value={formatINR(kpis.revenueToday)} delta="-6.4%" />
        <Kpi
          label="Revenue at Risk"
          value={formatINR(kpis.revenueAtRisk)}
          delta="+12.1%"
          positiveIsGood={false}
          tone="critical"
        />
        <Kpi
          label="Revenue Recovered"
          value={formatINR(kpis.revenueRecovered)}
          delta="+18.7%"
          tone="success"
        />
        <Kpi label="Recovery Rate" value={`${kpis.recoveryRate}%`} delta="+4.2 pp" />
        <Kpi
          label="Active Incidents"
          value={String(kpis.activeIncidents)}
          delta="+1"
          positiveIsGood={false}
          tone="critical"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Revenue trend vs baseline (₹ lakh / 2h)"
          action={<Badge tone="critical">Deviation 14:00–18:00</Badge>}
        >
          <RevenueTrendChart />
        </Panel>
        <Panel
          title="Payment success rate"
          action={<Badge tone="warning">Breached SLA floor</Badge>}
        >
          <SuccessRateChart />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Payment method breakdown">
          <ul className="space-y-3">
            {methodBreakdown.map((m) => (
              <li key={m.method}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{m.method}</span>
                  <span className="num text-muted-foreground">
                    {m.share}% volume · SR {m.sr}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      m.status === "degraded"
                        ? "bg-destructive"
                        : m.status === "watch"
                          ? "bg-warning"
                          : "bg-primary",
                    )}
                    style={{ width: `${m.share * 2}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Revenue at risk by incident (₹ lakh)">
          <RiskByIncidentChart />
        </Panel>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Active incidents</h2>
        <Link
          to="/incidents"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View all incidents <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        {active.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} />
        ))}
      </div>
    </AppShell>
  );
}
