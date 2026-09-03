import { Link } from "@tanstack/react-router";
import { ArrowRight, TrendingDown } from "lucide-react";
import { formatCount, formatINR, formatIST } from "@/lib/revive/format";
import { detectionSignature, signalStrength } from "@/lib/revive/summary";
import type { IncidentRecord } from "@/lib/revive/types";
import { SeverityBadge, StatusBadge } from "./primitives";
import { cn } from "@/lib/utils";

export function IncidentCard({ incident }: { incident: IncidentRecord }) {
  const strength = signalStrength(incident.zScore);

  return (
    <article className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-xs font-semibold text-muted-foreground">{incident.code}</span>
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug">{incident.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Detected {formatIST(incident.detectedAt)} IST · window{" "}
            {formatIST(incident.windowStart)}–{formatIST(incident.windowEnd)}
          </p>
        </div>
        <Link
          to="/incidents/$incidentId"
          params={{ incidentId: incident.code }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
        >
          Investigate <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Success-rate drop
          </dt>
          <dd className="num mt-0.5 flex items-center gap-1 text-base font-semibold text-destructive">
            <TrendingDown className="size-4" />
            {incident.dropPp.toFixed(1)} pp
          </dd>
          <p className="num mt-0.5 text-[11px] text-muted-foreground">
            {incident.observedSuccessRate.toFixed(1)}% vs {incident.baselineSuccessRate.toFixed(1)}%
          </p>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Revenue at risk
          </dt>
          <dd className="num mt-0.5 text-base font-semibold">
            {formatINR(incident.revenueAtRiskPaise)}
          </dd>
          <p className="num mt-0.5 text-[11px] text-muted-foreground">
            {formatINR(incident.revenueRecoveredPaise)} recovered
          </p>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Failed txns
          </dt>
          <dd className="num mt-0.5 text-base font-semibold">
            {formatCount(incident.affectedTransactions)}
          </dd>
          <p className="num mt-0.5 text-[11px] text-muted-foreground">
            of {formatCount(incident.attemptedTransactions)} attempts
          </p>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Signal strength
          </dt>
          <dd
            className={cn(
              "num mt-0.5 text-base font-semibold",
              strength.tone === "critical" ? "text-destructive" : "text-primary",
            )}
          >
            {incident.zScore.toFixed(1)}σ
          </dd>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{strength.label} deviation</p>
        </div>
      </dl>

      <div className="mt-4 rounded-md border border-border bg-elevated/60 p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {incident.rootCause ? "AI root cause" : "Detected failure signature"}
        </p>
        <p className="mt-1 text-sm leading-relaxed">{detectionSignature(incident)}</p>
      </div>
    </article>
  );
}
