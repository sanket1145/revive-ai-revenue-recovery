import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, FlaskConical, Gauge, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/revive/shell";
import { Badge, Metric, Panel, SeverityBadge, StatusBadge } from "@/components/revive/primitives";
import { SafetyPipeline } from "@/components/revive/pipeline";
import { Sparkline } from "@/components/revive/charts";
import {
  DataUnavailable,
  EmptyState,
  ErrorState,
  LoadingScreen,
} from "@/components/revive/states";
import { incidentDetailQuery } from "@/lib/revive/queries";
import {
  durationLabel,
  formatCount,
  formatINR,
  formatIST,
  formatISTTime,
  formatMs,
  formatPct,
  sparkLabel,
} from "@/lib/revive/format";
import { buildDetectionNarrative, signalStrength } from "@/lib/revive/summary";
import type { EvidenceRow, IncidentReport } from "@/lib/revive/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/incidents/$incidentId")({
  loader: async ({ params, context }) => {
    const result = await context.queryClient.ensureQueryData(
      incidentDetailQuery(params.incidentId),
    );
    // Surfaced through head() only; the component re-reads from the cache.
    return result.ok && result.data
      ? {
          code: result.data.incident.code,
          title: result.data.incident.title,
          severity: result.data.incident.severity,
          dropPp: result.data.incident.dropPp,
          atRisk: formatINR(result.data.incident.revenueAtRiskPaise),
          scope: result.data.incident.scopeLabel,
        }
      : null;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Incident not found — REVIVE AI" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = `${loaderData.code} · ${loaderData.title} — REVIVE AI`;
    const description = `${loaderData.severity} severity revenue incident on ${loaderData.scope}: ${loaderData.dropPp.toFixed(1)} pp success-rate drop, ${loaderData.atRisk} at risk.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  pendingComponent: () => (
    <AppShell title="Incident investigation" subtitle="Loading evidence…">
      <LoadingScreen />
    </AppShell>
  ),
  errorComponent: ({ error }) => (
    <AppShell title="Incident investigation">
      <ErrorState error={error} />
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell title="Incident not found">
      <EmptyState
        title="No such incident"
        description="This incident code is not in the register. It may have been detected under a different code."
      />
    </AppShell>
  ),
  component: IncidentDetail,
});

function formatEvidence(value: number | null, unit: EvidenceRow["unit"]): string {
  if (value === null) return "—";
  if (unit === "pct") return `${value.toFixed(2)}%`;
  if (unit === "ms") return formatMs(value);
  return formatCount(value);
}

function evidenceTone(row: EvidenceRow): "bad" | "neutral" {
  if (row.observed === null || row.baseline === null) return "neutral";
  const worse =
    row.worseWhen === "higher" ? row.observed > row.baseline * 1.5 : row.observed < row.baseline - 3;
  return worse ? "bad" : "neutral";
}

function RevenueImpact({ report, atRiskPaise }: { report: IncidentReport; atRiskPaise: number }) {
  const captured = report.observed.capturedPaise;
  const attemptedValue = report.observed.attemptedPaise;
  const capturedShare = attemptedValue > 0 ? (captured / attemptedValue) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Value attempted" value={formatINR(attemptedValue)} />
        <Metric label="Value captured" value={formatINR(captured)} />
        <Metric label="Shortfall vs baseline" value={formatINR(atRiskPaise)} tone="critical" />
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Captured share of attempted value</span>
          <span className="num">{capturedShare.toFixed(1)}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, capturedShare))}%` }}
          />
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Revenue at risk = (baseline authorisation rate × value attempted in window) − value actually
        captured, floored at zero. It is an observed shortfall, not a forecast.
      </p>
    </div>
  );
}

function IncidentDetail() {
  const router = useRouter();
  const { incidentId } = Route.useParams();
  const { data: result } = useSuspenseQuery(incidentDetailQuery(incidentId));

  if (!result.ok) {
    return (
      <AppShell title="Incident investigation">
        <DataUnavailable reason={result.reason} onRetry={() => void router.invalidate()} />
      </AppShell>
    );
  }

  if (!result.data) {
    return (
      <AppShell title="Incident not found" subtitle={incidentId}>
        <Link
          to="/incidents"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to incidents
        </Link>
        <EmptyState
          className="mt-4"
          title={`${incidentId} is not in the register`}
          description="The detector did not open an incident under this code. Open the register to see every detected degradation."
        />
      </AppShell>
    );
  }

  const { meta, incident, report, audit, siblings } = result.data;
  const strength = signalStrength(incident.zScore);
  const narrative = incident.diagnosis
    ? [incident.diagnosis]
    : buildDetectionNarrative(incident, report);
  const spanDays =
    report !== null &&
    report.sparkline.length > 1 &&
    new Date(report.sparkline[report.sparkline.length - 1]?.ts ?? 0).getTime() -
      new Date(report.sparkline[0]?.ts ?? 0).getTime() >
      20 * 60 * 60 * 1000;
  const others = siblings.filter((s) => s.code !== incident.code).slice(0, 4);

  return (
    <AppShell
      title={`${incident.code} — Investigation`}
      subtitle={incident.title}
      meta={meta}
    >
      <Link
        to="/incidents"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to incidents
      </Link>

      <Panel className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
          <Badge tone={strength.tone === "critical" ? "critical" : "info"}>
            z = {incident.zScore.toFixed(2)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Detected {formatIST(incident.detectedAt)} IST · scope {incident.scopeLabel}
          </span>
        </div>
        <h2 className="mt-3 text-lg font-semibold leading-snug">{incident.title}</h2>
        <p className="num mt-1 text-xs text-muted-foreground">
          Window {formatISTTime(incident.windowStart)}–{formatISTTime(incident.windowEnd)} IST (
          {durationLabel(incident.windowStart, incident.windowEnd)})
          {incident.resolvedAt && ` · recovered ${formatIST(incident.resolvedAt)} IST`}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Success-rate drop"
            value={`${incident.dropPp.toFixed(2)} pp`}
            hint={`${incident.observedSuccessRate.toFixed(2)}% observed vs ${incident.baselineSuccessRate.toFixed(2)}% baseline`}
            tone="critical"
          />
          <Metric
            label="Revenue at risk"
            value={formatINR(incident.revenueAtRiskPaise)}
            hint="observed shortfall in window"
            tone="critical"
          />
          <Metric
            label="Revenue recovered"
            value={formatINR(incident.revenueRecoveredPaise)}
            hint="recovery execution not enabled"
            tone={incident.revenueRecoveredPaise > 0 ? "success" : "neutral"}
          />
          <Metric
            label="Failed transactions"
            value={formatCount(incident.affectedTransactions)}
            hint={`of ${formatCount(incident.attemptedTransactions)} in-scope attempts`}
          />
        </div>

        <div className="mt-4">
          <SafetyPipeline activeIndex={-1} />
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Detection has completed and is written to the audit ledger. No stage beyond detection has
            run for this incident — REVIVE holds no execution authority.
          </p>
        </div>
      </Panel>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <Panel title="Success-rate trace" className="lg:col-span-1">
          {report ? (
            <>
              <Sparkline
                data={report.sparkline}
                formatLabel={(iso) => sparkLabel(iso, spanDays)}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                30-minute buckets for {incident.scopeLabel}. The shaded band is the detection window.
              </p>
            </>
          ) : (
            <EmptyState
              title="Trace unavailable"
              description="The per-incident report projection has not been built for this incident."
            />
          )}
        </Panel>

        <Panel title="Deterministic diagnosis" className="lg:col-span-2">
          <div className="flex items-start gap-3 rounded-md border border-primary/25 bg-primary/8 p-3">
            <Gauge className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="space-y-2">
              {narrative.map((paragraph, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {incident.diagnosis
              ? `Generated by the REVIVE investigation model · read-only analysis · no execution authority.${
                  incident.confidence !== null
                    ? ` Model confidence ${incident.confidence.toFixed(0)}%.`
                    : ""
                }`
              : "Composed from measured values in the transaction ledger — no model inference and no fabricated confidence score. LLM root-cause analysis is the next milestone."}
          </p>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Evidence"
          action={
            report && (
              <span className="num text-[11px] text-muted-foreground">
                baseline {formatIST(report.baselineWindow.start)} →{" "}
                {formatIST(report.baselineWindow.end)}
              </span>
            )
          }
        >
          {report && report.evidence.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-medium">Signal</th>
                    <th className="pb-2 font-medium">Observed</th>
                    <th className="pb-2 font-medium">Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {report.evidence.map((e) => (
                    <tr key={e.signal} className="border-b border-border/60">
                      <td className="py-2 pr-3">{e.signal}</td>
                      <td
                        className={cn(
                          "num py-2 pr-3 font-medium",
                          evidenceTone(e) === "bad" ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {formatEvidence(e.observed, e.unit)}
                      </td>
                      <td className="num py-2 text-muted-foreground">
                        {formatEvidence(e.baseline, e.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No evidence rows"
              description="Evidence is computed from the raw ledger when the incident report projection is refreshed."
            />
          )}
        </Panel>

        <Panel title="Failure composition in window">
          {report && report.failureMix.length > 0 ? (
            <ul className="space-y-3">
              {report.failureMix.map((f) => {
                const share = f.sharePct ?? 0;
                const base = f.baselineSharePct ?? 0;
                const elevated = share > base * 1.5 && share >= 5;
                return (
                  <li key={f.reason}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className={cn(elevated && "font-medium text-destructive")}>
                        {f.label}
                      </span>
                      <span className="num text-xs text-muted-foreground">
                        {formatCount(f.count)} · {share.toFixed(1)}%
                        <span className="text-muted-foreground/70"> (base {base.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          elevated ? "bg-destructive" : "bg-primary",
                        )}
                        style={{ width: `${Math.min(100, share)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title="No failures classified"
              description="No failed attempts were recorded inside the detection window."
            />
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Affected segments">
          {report && report.segments.length > 0 ? (
            <ul className="space-y-3">
              {report.segments.map((s) => (
                <li key={s.segment}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{s.segment}</span>
                    <span className="num text-xs text-muted-foreground">
                      {(s.impactPct ?? 0).toFixed(1)}% of loss · {formatCount(s.lostTransactions)}{" "}
                      failed / {formatCount(s.attempts)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        (s.impactPct ?? 0) >= 50 ? "bg-destructive" : "bg-primary",
                      )}
                      style={{ width: `${Math.min(100, s.impactPct ?? 0)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No segment breakdown"
              description="Segment attribution requires the incident report projection."
            />
          )}
        </Panel>

        <Panel title="Revenue impact">
          {report ? (
            <RevenueImpact report={report} atRiskPaise={incident.revenueAtRiskPaise} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="Revenue at risk"
                value={formatINR(incident.revenueAtRiskPaise)}
                tone="critical"
              />
              <Metric
                label="Failed transactions"
                value={formatCount(incident.affectedTransactions)}
              />
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Recommended recovery playbook"
        className="mt-4"
        action={<Badge tone="warning">not yet generated</Badge>}
      >
        <EmptyState
          icon={<FlaskConical className="size-5" />}
          title="No recovery actions proposed"
          description="The AI recommendation service and the deterministic policy engine are the next milestones. Until they ship, REVIVE reports what it measured and proposes nothing — an empty playbook is the honest state, not a placeholder."
        />
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Autonomous execution is disabled at the platform level. REVIVE has no credentials to
            move money, change routing, alter pricing, or issue refunds. When playbooks arrive, every
            action must clear the policy engine and run in bounded test mode before any rollout.
          </span>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Verification"
          action={
            incident.status === "recovered" ? (
              <Badge tone="success">metric recovered</Badge>
            ) : (
              <Badge tone="neutral">in progress</Badge>
            )
          }
        >
          {report && report.verification.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Metric</th>
                      <th className="pb-2 font-medium">In window</th>
                      <th className="pb-2 font-medium">After window</th>
                      <th className="pb-2 font-medium">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.verification.map((v) => {
                      const delta =
                        v.before !== null && v.after !== null ? v.after - v.before : null;
                      const improved =
                        delta !== null && (v.unit === "ms" ? delta < 0 : delta > 0);
                      return (
                        <tr key={v.metric} className="border-b border-border/60">
                          <td className="py-2 pr-3">{v.metric}</td>
                          <td className="num py-2 pr-3 text-muted-foreground">
                            {v.unit === "ms" ? formatMs(v.before) : formatPct(v.before)}
                          </td>
                          <td className="num py-2 pr-3 font-medium">
                            {v.unit === "ms" ? formatMs(v.after) : formatPct(v.after)}
                          </td>
                          <td
                            className={cn(
                              "num py-2 font-medium",
                              improved ? "text-success" : "text-muted-foreground",
                            )}
                          >
                            {delta === null
                              ? "—"
                              : v.unit === "ms"
                                ? `${delta > 0 ? "+" : ""}${formatMs(Math.abs(delta) * (delta < 0 ? -1 : 1))}`
                                : `${delta > 0 ? "+" : ""}${delta.toFixed(2)} pp`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Observational only: the metric recovered on its own or through action taken outside
                REVIVE. No REVIVE-initiated action contributed to these numbers.
              </p>
            </>
          ) : (
            <EmptyState
              title="Verification pending"
              description="Post-window metrics are compared once the detection window closes and enough traffic has accumulated after it."
            />
          )}
        </Panel>

        <Panel title="Audit timeline">
          {audit.length > 0 ? (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {audit.map((e) => (
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
                      {formatIST(e.occurredAt)}
                    </span>
                    <span className="text-sm font-medium">{e.event}</span>
                    <span className="text-xs text-muted-foreground">· {e.actor}</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{e.detail}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No audit entries"
              description="Audit records are written by the detection engine when an incident opens or resolves."
            />
          )}
        </Panel>
      </div>

      {others.length > 0 && (
        <Panel title="Other incidents in this window" className="mt-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {others.map((s) => (
              <li key={s.code}>
                <Link
                  to="/incidents/$incidentId"
                  params={{ incidentId: s.code }}
                  className="flex items-center gap-2 rounded-md border border-border bg-elevated/60 px-3 py-2 text-xs transition-colors hover:bg-secondary"
                >
                  <span className="num font-semibold text-primary">{s.code}</span>
                  <span className="truncate text-muted-foreground">{s.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </AppShell>
  );
}
