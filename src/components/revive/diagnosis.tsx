/**
 * AI investigation surface: root cause, confidence, cited evidence, and the
 * explainable recovery-opportunity score.
 *
 * The model only ever sees measured aggregates; when no diagnosis exists yet
 * the panel shows the deterministic narrative instead of a placeholder.
 */
import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, Loader2, Sparkles } from "lucide-react";
import { Badge, Panel } from "@/components/revive/primitives";
import { investigateIncident } from "@/lib/revive/actions.functions";
import { formatCount, formatINR, formatIST } from "@/lib/revive/format";
import type { IncidentRecord } from "@/lib/revive/types";
import { cn } from "@/lib/utils";

function confidenceTone(confidence: number) {
  if (confidence >= 80) return "success" as const;
  if (confidence >= 60) return "info" as const;
  return "warning" as const;
}

export function DiagnosisPanel({
  incident,
  narrative,
  className,
}: {
  incident: IncidentRecord;
  narrative: string[];
  className?: string;
}) {
  const router = useRouter();
  const investigate = useServerFn(investigateIncident);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await investigate({ data: { code: incident.code } });
      if (!result.ok) setError(result.reason);
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The investigation could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const hasDiagnosis = incident.diagnosis !== null;

  return (
    <Panel
      title="AI investigation"
      className={className}
      action={
        <div className="flex items-center gap-2">
          {incident.confidence !== null && (
            <Badge tone={confidenceTone(incident.confidence)}>
              confidence {incident.confidence.toFixed(0)}%
            </Badge>
          )}
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/12 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {hasDiagnosis ? "Re-run investigation" : "Run AI investigation"}
          </button>
        </div>
      }
    >
      {error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </p>
      )}

      {hasDiagnosis && incident.rootCause && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/8 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Root cause</p>
          <p className="mt-0.5 text-sm font-semibold text-destructive">{incident.rootCause}</p>
        </div>
      )}

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

      {incident.evidence.length > 0 && (
        <ul className="mt-3 space-y-2">
          {incident.evidence.map((e, i) => (
            <li key={`${e.signal}-${i}`} className="flex items-start gap-2 text-xs">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <span>
                <span className="font-medium">{e.signal}</span>
                <span className="text-muted-foreground"> — {e.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {hasDiagnosis
          ? `Generated from measured ledger aggregates only${
              incident.investigatedAt ? ` · ${formatIST(incident.investigatedAt)} IST` : ""
            } · read-only analysis with no execution authority.`
          : "Composed from measured values in the transaction ledger. Run the investigation to add an AI root cause, a confidence score and cited evidence."}
      </p>
    </Panel>
  );
}

export function RecoveryScorePanel({ incident }: { incident: IncidentRecord }) {
  const detail = incident.scoreDetail;
  const score = incident.recoveryScore;

  return (
    <Panel
      title="Recovery opportunity"
      action={
        score !== null && (
          <span className="num text-sm font-semibold text-primary">{score.toFixed(0)}/100</span>
        )
      }
    >
      {score === null || !detail ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The score is computed when the investigation runs. It ranks incidents by how much of the
          measured shortfall is actually addressable by a bounded recovery action.
        </p>
      ) : (
        <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full",
                score >= 70 ? "bg-success" : score >= 40 ? "bg-primary" : "bg-warning",
              )}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
          </div>
          <ul className="mt-3 space-y-2">
            {detail.factors.map((f) => (
              <li key={f.label}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span>{f.label}</span>
                  <span className="num text-muted-foreground">
                    {f.points.toFixed(1)} / {f.max}
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${f.max > 0 ? (f.points / f.max) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="num mt-3 text-[11px] text-muted-foreground">
            {formatCount(detail.eligibleTransactions)} eligible transactions ·{" "}
            {formatINR(detail.eligiblePaise)} of recoverable failed value · expected{" "}
            {formatINR(detail.expectedRecoveryPaise)}
          </p>
        </>
      )}
    </Panel>
  );
}
