import { Link } from "@tanstack/react-router";
import { ArrowRight, TrendingDown } from "lucide-react";
import { formatINR, formatTime, type Incident } from "@/lib/revive-data";
import { SeverityBadge, StatusBadge } from "./primitives";

export function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <article className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-xs font-semibold text-muted-foreground">{incident.id}</span>
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug">{incident.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Detected {formatTime(incident.detectedAt)} IST
          </p>
        </div>
        <Link
          to="/incidents/$incidentId"
          params={{ incidentId: incident.id }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
        >
          Investigate <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Revenue drop
          </dt>
          <dd className="num mt-0.5 flex items-center gap-1 text-base font-semibold text-destructive">
            <TrendingDown className="size-4" />
            {incident.dropPct}%
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Revenue at risk
          </dt>
          <dd className="num mt-0.5 text-base font-semibold">
            {formatINR(incident.revenueAtRisk)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Affected txns
          </dt>
          <dd className="num mt-0.5 text-base font-semibold">
            {incident.affectedTransactions.toLocaleString("en-IN")}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            AI confidence
          </dt>
          <dd className="num mt-0.5 text-base font-semibold text-primary">
            {incident.confidence}%
          </dd>
        </div>
      </dl>

      <div className="mt-4 rounded-md border border-border bg-elevated/60 p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Probable root cause
        </p>
        <p className="mt-1 text-sm leading-relaxed">{incident.rootCause}</p>
      </div>
    </article>
  );
}
