import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/revive/shell";
import { Panel, Badge } from "@/components/revive/primitives";
import { IncidentCard } from "@/components/revive/incident-card";
import {
  RevenueTrendChart,
  RiskByIncidentChart,
  SuccessRateChart,
} from "@/components/revive/charts";
import {
  DataUnavailable,
  EmptyState,
  ErrorState,
  LoadingScreen,
} from "@/components/revive/states";
import { dashboardQuery } from "@/lib/revive/queries";
import {
  formatCount,
  formatDeltaPct,
  formatINR,
  formatISTDate,
  formatISTDateShort,
  formatISTTime,
  formatPct,
  formatSignedCount,
} from "@/lib/revive/format";
import { DETECTION_RULE_SUMMARY, SLA_SUCCESS_RATE_FLOOR } from "@/lib/revive/config";
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
          "Live revenue-at-risk detection, deterministic root-cause evidence, and bounded recovery playbooks validated by a policy engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery()),
  pendingComponent: () => (
    <AppShell title="Revenue Incident Command Center" subtitle="Loading dataset…">
      <LoadingScreen />
    </AppShell>
  ),
  errorComponent: ({ error }) => (
    <AppShell title="Revenue Incident Command Center">
      <ErrorState error={error} />
    </AppShell>
  ),
  component: Overview,
});

function Kpi({
  label,
  value,
  foot,
  footTone = "muted",
  tone,
}: {
  label: string;
  value: string;
  foot: string;
  footTone?: "good" | "bad" | "muted";
  tone?: "critical" | "success" | undefined;
}) {
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
          footTone === "good" && "text-success",
          footTone === "bad" && "text-destructive",
          footTone === "muted" && "text-muted-foreground",
        )}
      >
        {foot}
      </p>
    </div>
  );
}

function Overview() {
  const router = useRouter();
  const { data: result } = useSuspenseQuery(dashboardQuery());

  if (!result.ok) {
    return (
      <AppShell title="Revenue Incident Command Center">
        <DataUnavailable
          reason={result.reason}
          hint="The dashboard reads from generated projections. If the dataset has not been built, no KPI can be shown — the UI will not fall back to placeholder numbers."
          onRetry={() => void router.invalidate()}
        />
      </AppShell>
    );
  }

  const { meta, snapshot, incidents } = result.data;
  const { kpis } = snapshot;
  const active = incidents.filter((i) => i.status !== "recovered");
  const openRiskPaise = active.reduce((sum, i) => sum + i.revenueAtRiskPaise, 0);
  const maxSharePct = snapshot.methodBreakdown.reduce(
    (max, m) => Math.max(max, m.sharePct),
    0,
  );
  const breached =
    kpis.successRatePct !== null && kpis.successRatePct < SLA_SUCCESS_RATE_FLOOR;
  const deviating = snapshot.revenueTrend.filter(
    (p) => p.baselinePaise > 0 && p.revenuePaise < p.baselinePaise * 0.85,
  );

  return (
    <AppShell
      title="Revenue Incident Command Center"
      subtitle={`${formatISTDate(snapshot.asOf)} · data as of ${formatISTTime(snapshot.asOf)} IST`}
      meta={meta}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Revenue Today"
          value={formatINR(kpis.revenueTodayPaise)}
          foot={`${formatDeltaPct(kpis.revenueTodayDeltaPct)} vs 7-day baseline`}
          footTone={
            kpis.revenueTodayDeltaPct === null
              ? "muted"
              : kpis.revenueTodayDeltaPct >= 0
                ? "good"
                : "bad"
          }
        />
        <Kpi
          label="Revenue at Risk"
          value={formatINR(kpis.revenueAtRiskPaise)}
          tone="critical"
          foot={
            openRiskPaise > 0
              ? `${formatINR(openRiskPaise)} in ${active.length} open incident${active.length === 1 ? "" : "s"}`
              : "all detected incidents have returned to baseline"
          }
          footTone={openRiskPaise > 0 ? "bad" : "good"}
        />
        <Kpi
          label="Revenue Recovered"
          value={formatINR(kpis.revenueRecoveredPaise)}
          tone={kpis.revenueRecoveredPaise > 0 ? "success" : undefined}
          foot="recovery execution not enabled"
        />
        <Kpi
          label="Recovery Rate"
          value={formatPct(kpis.recoveryRatePct, 1)}
          foot="recovered ÷ revenue at risk"
        />
        <Kpi
          label="Active Incidents"
          value={String(kpis.activeIncidents)}
          tone={kpis.activeIncidents > 0 ? "critical" : undefined}
          foot={`${formatSignedCount(kpis.activeIncidentsDelta)} vs yesterday`}
          footTone={kpis.activeIncidentsDelta > 0 ? "bad" : "muted"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Captured revenue vs baseline (₹ lakh / hour)"
          action={
            deviating.length > 0 ? (
              <Badge tone="critical">
                {deviating.length} hour{deviating.length === 1 ? "" : "s"} below baseline
              </Badge>
            ) : (
              <Badge tone="success">Tracking baseline</Badge>
            )
          }
        >
          <RevenueTrendChart data={snapshot.revenueTrend} />
        </Panel>
        <Panel
          title="Payment success rate vs baseline"
          action={
            breached ? (
              <Badge tone="warning">Below {SLA_SUCCESS_RATE_FLOOR}% SLA floor</Badge>
            ) : (
              <Badge tone="success">Within SLA</Badge>
            )
          }
        >
          <SuccessRateChart data={snapshot.successRateTrend} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Payment method breakdown"
          action={
            <span className="num text-[11px] text-muted-foreground">
              {formatCount(kpis.attemptsToday)} attempts today
            </span>
          }
        >
          {snapshot.methodBreakdown.length === 0 ? (
            <EmptyState
              title="No attempts recorded today"
              description="Method mix appears once the dataset contains attempts for the current day."
            />
          ) : (
            <ul className="space-y-3">
              {snapshot.methodBreakdown.map((m) => (
                <li key={m.method}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{m.label}</span>
                    <span className="num text-xs text-muted-foreground">
                      {m.sharePct.toFixed(1)}% volume · SR {formatPct(m.srPct, 1)}
                      {m.baselineSrPct !== null && (
                        <span className="text-muted-foreground/70">
                          {" "}
                          (base {m.baselineSrPct.toFixed(1)}%)
                        </span>
                      )}
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
                      style={{
                        width: `${maxSharePct > 0 ? Math.max(3, (m.sharePct / maxSharePct) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Revenue at risk by incident (₹ lakh)"
          action={
            <Link
              to="/incidents"
              className="text-[11px] font-medium text-primary hover:underline"
            >
              Open register
            </Link>
          }
        >
          <RiskByIncidentChart data={snapshot.riskByIncident} />
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
        {active.length === 0 ? (
          <EmptyState
            className="xl:col-span-2"
            icon={<ShieldCheck className="size-5" />}
            title="No open revenue incidents"
            description="Every scope is tracking within its rolling baseline. Detected degradations appear here automatically."
          />
        ) : (
          active.map((incident) => <IncidentCard key={incident.code} incident={incident} />)
        )}
      </div>

      <Panel className="mt-6" title="Detection provenance">
        <dl className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="uppercase tracking-wide text-muted-foreground">Dataset</dt>
            <dd className="num mt-1">
              {formatCount(meta.transactionCount)} attempts · seed {meta.seed}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-muted-foreground">Observation window</dt>
            <dd className="num mt-1">
              {formatISTDateShort(meta.windowStart)} → {formatISTDateShort(meta.asOf)}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-muted-foreground">Detection rule</dt>
            <dd className="num mt-1">{meta.detectionRule}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-muted-foreground">Autonomous execution</dt>
            <dd className="mt-1 flex items-center gap-1.5">
              <Badge tone="critical">disabled</Badge>
            </dd>
          </div>
        </dl>
        <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          {DETECTION_RULE_SUMMARY} Every KPI on this page is computed from the transaction ledger; no
          value is hard-coded.
        </p>
      </Panel>
    </AppShell>
  );
}
