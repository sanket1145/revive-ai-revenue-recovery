import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/revive/shell";
import { Badge, Panel, type Tone } from "@/components/revive/primitives";
import { auditTrail, formatTime } from "@/lib/revive-data";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — REVIVE AI" },
      {
        name: "description",
        content:
          "Immutable, timestamped record of every detection, AI recommendation, policy verdict, human approval and verification result.",
      },
      { property: "og:title", content: "Audit Trail — REVIVE AI" },
      {
        property: "og:description",
        content:
          "Compliance-grade log of all revenue recovery decisions, including blocked AI actions.",
      },
    ],
  }),
  component: AuditPage,
});

const outcomeTone: Record<string, Tone> = {
  info: "info",
  success: "success",
  blocked: "critical",
  critical: "critical",
};

function AuditPage() {
  const events = [...auditTrail].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <AppShell
      title="Audit Trail"
      subtitle="Append-only ledger · retained 7 years · exportable for compliance review"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Logged events
          </p>
          <p className="num mt-1 text-2xl font-semibold">{events.length}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Policy blocks
          </p>
          <p className="num mt-1 text-2xl font-semibold text-destructive">
            {events.filter((e) => e.outcome === "blocked").length}
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Verified recoveries
          </p>
          <p className="num mt-1 text-2xl font-semibold text-success">
            {events.filter((e) => e.event === "Verification passed").length}
          </p>
        </Panel>
      </div>

      <Panel title="Event log" className="mt-4">
        <ol className="relative space-y-5 border-l border-border pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span
                className={
                  "absolute -left-[26px] top-1.5 size-2.5 rounded-full " +
                  (e.outcome === "blocked" || e.outcome === "critical"
                    ? "bg-destructive"
                    : e.outcome === "success"
                      ? "bg-success"
                      : "bg-primary")
                }
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-xs text-muted-foreground">{formatTime(e.at)} IST</span>
                <Badge tone={outcomeTone[e.outcome] ?? "neutral"}>{e.event}</Badge>
                <span className="text-xs text-muted-foreground">by {e.actor}</span>
                <Link
                  to="/incidents/$incidentId"
                  params={{ incidentId: e.incidentId }}
                  className="num text-xs font-semibold text-primary hover:underline"
                >
                  {e.incidentId}
                </Link>
              </div>
              <p className="mt-1 text-sm leading-relaxed">{e.detail}</p>
              <p className="num mt-0.5 text-[11px] text-muted-foreground">Record {e.id}</p>
            </li>
          ))}
        </ol>
      </Panel>
    </AppShell>
  );
}
