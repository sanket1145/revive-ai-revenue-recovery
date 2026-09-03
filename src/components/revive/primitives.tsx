import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  ExecutionStatus,
  IncidentStatus,
  PolicyStatus,
  Severity,
} from "@/lib/revive/types";

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel p-4 sm:p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const tones = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  info: "border-primary/30 bg-primary/12 text-primary",
  success: "border-success/30 bg-success/12 text-success",
  warning: "border-warning/30 bg-warning/12 text-warning",
  critical: "border-destructive/40 bg-destructive/12 text-destructive",
} as const;

export type Tone = keyof typeof tones;

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const severityTone: Record<Severity, Tone> = {
  critical: "critical",
  high: "warning",
  medium: "info",
  low: "neutral",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={severityTone[severity]}>{severity}</Badge>;
}

const statusTone: Record<IncidentStatus, Tone> = {
  detected: "critical",
  investigating: "warning",
  recovering: "info",
  recovered: "success",
  monitoring: "neutral",
};

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return <Badge tone={statusTone[status]}>{status}</Badge>;
}

const policyTone: Record<PolicyStatus, Tone> = {
  approved: "success",
  blocked: "critical",
  requires_approval: "warning",
};

export function PolicyBadge({ status }: { status: PolicyStatus }) {
  return <Badge tone={policyTone[status]}>{status.replace("_", " ")}</Badge>;
}

const execTone: Record<ExecutionStatus, Tone> = {
  executed: "info",
  verified: "success",
  test_mode: "warning",
  pending: "neutral",
  blocked: "critical",
};

export function ExecutionBadge({ status }: { status: ExecutionStatus }) {
  return <Badge tone={execTone[status]}>{status.replace("_", " ")}</Badge>;
}

export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  const valueColor =
    tone === "critical"
      ? "text-destructive"
      : tone === "success"
        ? "text-success"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-elevated/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 text-lg font-semibold", valueColor)}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
