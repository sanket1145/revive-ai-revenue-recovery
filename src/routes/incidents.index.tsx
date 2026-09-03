import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/revive/shell";
import { IncidentCard } from "@/components/revive/incident-card";
import { Panel } from "@/components/revive/primitives";
import {
  DataUnavailable,
  EmptyState,
  ErrorState,
  LoadingScreen,
} from "@/components/revive/states";
import { incidentsQuery } from "@/lib/revive/queries";
import { formatCount, formatINR, formatISTDateShort } from "@/lib/revive/format";
import { cn } from "@/lib/utils";

type View = "all" | "open" | "recovered";

const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "recovered", label: "Recovered" },
];

export const Route = createFileRoute("/incidents/")({
  // `view` is optional so that plain <Link to="/incidents"> stays valid.
  validateSearch: (search: Record<string, unknown>): { view?: View } => {
    const view = search["view"];
    return view === "open" || view === "recovered" ? { view } : {};
  },
  head: () => ({
    meta: [
      { title: "Revenue Incidents — REVIVE AI" },
      {
        name: "description",
        content:
          "Every detected revenue degradation event with severity, revenue at risk, affected transactions and detection signal strength.",
      },
      { property: "og:title", content: "Revenue Incidents — REVIVE AI" },
      {
        property: "og:description",
        content:
          "Triage register of merchant revenue incidents ranked by revenue at risk and statistical signal strength.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(incidentsQuery()),
  pendingComponent: () => (
    <AppShell title="Revenue Incidents" subtitle="Loading register…">
      <LoadingScreen />
    </AppShell>
  ),
  errorComponent: ({ error }) => (
    <AppShell title="Revenue Incidents">
      <ErrorState error={error} />
    </AppShell>
  ),
  component: IncidentsPage,
});

function IncidentsPage() {
  const router = useRouter();
  const navigate = useNavigate({ from: "/incidents/" });
  const search = Route.useSearch();
  const view: View = search.view ?? "all";
  const { data: result } = useSuspenseQuery(incidentsQuery());

  if (!result.ok) {
    return (
      <AppShell title="Revenue Incidents">
        <DataUnavailable reason={result.reason} onRetry={() => void router.invalidate()} />
      </AppShell>
    );
  }

  const { meta, incidents } = result.data;
  const open = incidents.filter((i) => i.status !== "recovered");
  const totalRisk = incidents.reduce((s, i) => s + i.revenueAtRiskPaise, 0);
  const totalRecovered = incidents.reduce((s, i) => s + i.revenueRecoveredPaise, 0);
  const txns = incidents.reduce((s, i) => s + i.affectedTransactions, 0);

  const filtered =
    view === "open"
      ? open
      : view === "recovered"
        ? incidents.filter((i) => i.status === "recovered")
        : incidents;

  return (
    <AppShell
      title="Revenue Incidents"
      subtitle={`${incidents.length} incident${incidents.length === 1 ? "" : "s"} detected across ${formatISTDateShort(meta.windowStart)} → ${formatISTDateShort(meta.asOf)}`}
      meta={meta}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Total revenue at risk
          </p>
          <p className="num mt-1 text-2xl font-semibold text-destructive">
            {formatINR(totalRisk)}
          </p>
          <p className="num mt-1 text-[11px] text-muted-foreground">
            {open.length} open · {incidents.length - open.length} resolved
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Recovered so far
          </p>
          <p
            className={cn(
              "num mt-1 text-2xl font-semibold",
              totalRecovered > 0 ? "text-success" : "text-foreground",
            )}
          >
            {formatINR(totalRecovered)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            recovery execution not enabled yet
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Failed transactions in scope
          </p>
          <p className="num mt-1 text-2xl font-semibold">{formatCount(txns)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            counted only inside detection windows
          </p>
        </Panel>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => void navigate({ search: v.key === "all" ? {} : { view: v.key } })}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              view === v.key
                ? "border-primary/30 bg-primary/12 text-primary"
                : "border-border bg-elevated text-muted-foreground hover:bg-secondary",
            )}
          >
            {v.label}
            <span className="num ml-1.5 text-[11px] opacity-70">
              {v.key === "all"
                ? incidents.length
                : v.key === "open"
                  ? open.length
                  : incidents.length - open.length}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        {filtered.length === 0 ? (
          <EmptyState
            className="xl:col-span-2"
            icon={<ShieldCheck className="size-5" />}
            title={
              incidents.length === 0
                ? "No incidents detected"
                : "No incidents match this filter"
            }
            description={
              incidents.length === 0
                ? "The detector found no window where a scope breached the drop, relative-drop and z-score thresholds simultaneously."
                : "Switch the filter to see the rest of the register."
            }
          />
        ) : (
          filtered.map((incident) => <IncidentCard key={incident.code} incident={incident} />)
        )}
      </div>
    </AppShell>
  );
}
