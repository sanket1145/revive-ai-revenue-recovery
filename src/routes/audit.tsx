import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/revive/shell";
import { Badge, Panel, type Tone } from "@/components/revive/primitives";
import {
  DataUnavailable,
  EmptyState,
  ErrorState,
  LoadingScreen,
} from "@/components/revive/states";
import { auditQuery } from "@/lib/revive/queries";
import { formatIST } from "@/lib/revive/format";
import { cn } from "@/lib/utils";

type StageFilter = "all" | "dataset" | "detection" | "policy" | "execution" | "verification";

const STAGE_FILTERS: { key: StageFilter; label: string }[] = [
  { key: "all", label: "All stages" },
  { key: "dataset", label: "Dataset" },
  { key: "detection", label: "Detection" },
  { key: "policy", label: "Policy" },
  { key: "execution", label: "Execution" },
  { key: "verification", label: "Verification" },
];

export const Route = createFileRoute("/audit")({
  // `stage` is optional so that plain <Link to="/audit"> stays valid.
  validateSearch: (search: Record<string, unknown>): { stage?: StageFilter } => {
    const stage = search["stage"];
    const valid = STAGE_FILTERS.some((f) => f.key === stage && f.key !== "all");
    return valid ? { stage: stage as StageFilter } : {};
  },
  head: () => ({
    meta: [
      { title: "Audit Trail — REVIVE AI" },
      {
        name: "description",
        content:
          "Append-only, timestamped record of every dataset build, detection decision, policy verdict, human approval and verification result.",
      },
      { property: "og:title", content: "Audit Trail — REVIVE AI" },
      {
        property: "og:description",
        content:
          "Compliance-grade log of all revenue recovery decisions, including blocked AI actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(auditQuery()),
  pendingComponent: () => (
    <AppShell title="Audit Trail" subtitle="Loading ledger…">
      <LoadingScreen />
    </AppShell>
  ),
  errorComponent: ({ error }) => (
    <AppShell title="Audit Trail">
      <ErrorState error={error} />
    </AppShell>
  ),
  component: AuditPage,
});

const outcomeTone: Record<string, Tone> = {
  info: "info",
  success: "success",
  blocked: "critical",
  critical: "critical",
};

function AuditPage() {
  const router = useRouter();
  const navigate = useNavigate({ from: "/audit" });
  const search = Route.useSearch();
  const stage: StageFilter = search.stage ?? "all";
  const { data: result } = useSuspenseQuery(auditQuery());

  if (!result.ok) {
    return (
      <AppShell title="Audit Trail">
        <DataUnavailable reason={result.reason} onRetry={() => void router.invalidate()} />
      </AppShell>
    );
  }

  const { meta, events, incidents } = result.data;
  const knownIncidents = new Set(incidents.map((i) => i.code));
  const filtered = stage === "all" ? events : events.filter((e) => e.stage === stage);
  const blocks = events.filter((e) => e.outcome === "blocked").length;
  const verifications = events.filter((e) => e.stage === "verification").length;
  const detections = events.filter((e) => e.stage === "detection").length;

  return (
    <AppShell
      title="Audit Trail"
      subtitle="Append-only ledger · every automated decision is recorded before it is acted on"
      meta={meta}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Logged events
          </p>
          <p className="num mt-1 text-2xl font-semibold">{events.length}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Detection decisions
          </p>
          <p className="num mt-1 text-2xl font-semibold">{detections}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Policy blocks
          </p>
          <p
            className={cn(
              "num mt-1 text-2xl font-semibold",
              blocks > 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {blocks}
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Verified recoveries
          </p>
          <p
            className={cn(
              "num mt-1 text-2xl font-semibold",
              verifications > 0 ? "text-success" : "text-foreground",
            )}
          >
            {verifications}
          </p>
        </Panel>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {STAGE_FILTERS.map((f) => {
          const count =
            f.key === "all" ? events.length : events.filter((e) => e.stage === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => void navigate({ search: f.key === "all" ? {} : { stage: f.key } })}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                stage === f.key
                  ? "border-primary/30 bg-primary/12 text-primary"
                  : "border-border bg-elevated text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
              <span className="num ml-1.5 text-[11px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <Panel title="Event log" className="mt-3">
        {filtered.length === 0 ? (
          <EmptyState
            title={events.length === 0 ? "Ledger is empty" : "No events at this stage"}
            description={
              events.length === 0
                ? "Audit records are written by the dataset generator and the detection engine."
                : "Stages that are not enabled yet write no records. Switch the filter to see the rest of the ledger."
            }
          />
        ) : (
          <ol className="relative space-y-5 border-l border-border pl-5">
            {filtered.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[26px] top-1.5 size-2.5 rounded-full",
                    e.outcome === "blocked" || e.outcome === "critical"
                      ? "bg-destructive"
                      : e.outcome === "success"
                        ? "bg-success"
                        : "bg-primary",
                  )}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-xs text-muted-foreground">
                    {formatIST(e.occurredAt)} IST
                  </span>
                  <Badge tone={outcomeTone[e.outcome] ?? "neutral"}>{e.event}</Badge>
                  <span className="text-xs text-muted-foreground">by {e.actor}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {e.stage}
                  </span>
                  {e.incidentCode &&
                    (knownIncidents.has(e.incidentCode) ? (
                      <Link
                        to="/incidents/$incidentId"
                        params={{ incidentId: e.incidentCode }}
                        className="num text-xs font-semibold text-primary hover:underline"
                      >
                        {e.incidentCode}
                      </Link>
                    ) : (
                      <span className="num text-xs text-muted-foreground">{e.incidentCode}</span>
                    ))}
                </div>
                <p className="mt-1 text-sm leading-relaxed">{e.detail}</p>
                <p className="num mt-0.5 text-[11px] text-muted-foreground">Record {e.code}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </AppShell>
  );
}
