/**
 * Recovery playbook surface: AI-proposed bounded actions, the deterministic
 * policy verdict for each, the human approval gate, canary execution and the
 * verified result + counterfactual.
 *
 * Every number rendered here comes from the backend (`recovery_actions`); this
 * component computes nothing but simple sums of persisted values.
 */
import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Play, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Badge, ExecutionBadge, Panel, PolicyBadge } from "@/components/revive/primitives";
import { EmptyState } from "@/components/revive/states";
import { decideRecoveryAction, executeRecoveryAction } from "@/lib/revive/actions.functions";
import { formatCount, formatINR } from "@/lib/revive/format";
import type { RecoveryAction } from "@/lib/revive/types";
import { cn } from "@/lib/utils";

const checkTone = {
  pass: "text-success",
  warn: "text-warning",
  fail: "text-destructive",
} as const;

export function PlaybookPanel({
  incidentCode,
  actions,
  investigated,
}: {
  incidentCode: string;
  actions: RecoveryAction[];
  investigated: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const decide = useServerFn(decideRecoveryAction);
  const execute = useServerFn(executeRecoveryAction);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    key: string,
    fn: () => Promise<{ ok: boolean; reason?: string }>,
  ) {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) setError(result.reason ?? "The action was refused.");
      await queryClient.invalidateQueries({ queryKey: ["revive"] });
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0) {
    return (
      <Panel
        title="Recommended recovery playbook"
        className="mt-4"
        action={<Badge tone="warning">not yet generated</Badge>}
      >
        <EmptyState
          title="No recovery actions proposed"
          description={
            investigated
              ? "The policy engine has not produced a playbook for this incident yet. Re-run the investigation to refresh it."
              : "Run the AI investigation first. The playbook is only proposed once a diagnosis with a confidence score exists — the policy engine blocks any action below 60% confidence."
          }
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Recommended recovery playbook"
      className="mt-4"
      action={
        <span className="text-[11px] text-muted-foreground">
          AI proposes · policy decides · execution is bounded to {actions[0]?.canaryLimit ?? 50}{" "}
          transactions
        </span>
      }
    >
      {error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-4">
        {actions.map((a) => {
          const decidedKey = `${a.actionKey}:decide`;
          const execKey = `${a.actionKey}:exec`;
          const canExecute = a.policyStatus === "approved" && a.executionStatus === "pending";
          const needsApproval =
            a.policyStatus === "requires_approval" && a.executionStatus === "pending";

          return (
            <div key={a.actionKey} className="rounded-lg border border-border bg-elevated/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-[240px] flex-1">
                  <h3 className="text-sm font-semibold">{a.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.reason}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PolicyBadge status={a.policyStatus} />
                  <ExecutionBadge status={a.executionStatus} />
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Cell
                  label="Eligible transactions"
                  value={formatCount(a.eligibleTransactions)}
                  hint={`${formatINR(a.eligiblePaise)} of failed value`}
                />
                <Cell
                  label="Expected recovery"
                  value={formatINR(a.expectedRecoveryPaise)}
                  hint="eligible value × per-reason recovery propensity"
                />
                <Cell
                  label="Recovered so far"
                  value={formatINR(a.recoveredPaise)}
                  hint={
                    a.executionStatus === "executed"
                      ? `${formatCount(a.recovered)} of ${formatCount(a.attempted)} attempted`
                      : "no batch has run"
                  }
                  tone={a.recoveredPaise > 0 ? "success" : "neutral"}
                />
              </div>

              <ul className="mt-3 space-y-1.5">
                {a.policyChecks.map((c) => (
                  <li key={c.check} className="flex items-start gap-2 text-xs">
                    <span className={cn("mt-0.5 shrink-0", checkTone[c.status])}>
                      {c.status === "pass" ? (
                        <ShieldCheck className="size-3.5" />
                      ) : (
                        <ShieldAlert className="size-3.5" />
                      )}
                    </span>
                    <span>
                      <span className="font-medium">{c.check}</span>
                      <span className="text-muted-foreground"> — {c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>

              {a.verification && (
                <div className="mt-3 rounded-md border border-success/30 bg-success/8 p-3">
                  <p className="text-xs font-semibold text-success">
                    Verified canary result ({a.verification.mode})
                  </p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-4">
                    <Cell label="Attempted" value={formatCount(a.verification.attempted)} />
                    <Cell label="Recovered" value={formatCount(a.verification.succeeded)} />
                    <Cell label="Failed" value={formatCount(a.verification.failed)} />
                    <Cell
                      label="Recovery rate"
                      value={`${a.verification.recoveryRatePct.toFixed(1)}%`}
                      tone="success"
                    />
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {needsApproval && (
                  <>
                    <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-warning">
                      <ShieldAlert className="size-3.5" /> Human approval required
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(decidedKey, () =>
                          decide({
                            data: { code: incidentCode, actionKey: a.actionKey, decision: "approve" },
                          }),
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success/12 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 disabled:opacity-50"
                    >
                      {busy === decidedKey ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(decidedKey, () =>
                          decide({
                            data: { code: incidentCode, actionKey: a.actionKey, decision: "reject" },
                          }),
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/70 disabled:opacity-50"
                    >
                      <X className="size-3.5" /> Reject
                    </button>
                  </>
                )}

                {canExecute && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(execKey, () =>
                        execute({ data: { code: incidentCode, actionKey: a.actionKey } }),
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/12 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                  >
                    {busy === execKey ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                    Execute canary batch ({Math.min(a.canaryLimit, a.eligibleTransactions)}{" "}
                    transactions, test mode)
                  </button>
                )}

                {a.executionStatus === "blocked" && (
                  <span className="text-xs text-destructive">
                    Blocked by the policy engine — no execution path exists for this action.
                  </span>
                )}
                {a.executionStatus === "rejected" && (
                  <span className="text-xs text-muted-foreground">
                    Rejected by the human approver.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          REVIVE holds no live payment credentials. Canary batches run against the merchant ledger
          in Razorpay-compatible test mode: outcomes are computed per transaction from its failure
          reason, never sampled at random and never applied to real money.
        </span>
      </div>
    </Panel>
  );
}

function Cell({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "success";
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "num mt-0.5 text-sm font-semibold",
          tone === "success" ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Counterfactual: measured shortfall vs what the executed batches recovered. */
export function CounterfactualPanel({
  atRiskPaise,
  actions,
}: {
  atRiskPaise: number;
  actions: RecoveryAction[];
}) {
  const recovered = actions.reduce((s, a) => s + a.recoveredPaise, 0);
  const executed = actions.some((a) => a.executionStatus === "executed");
  const remaining = Math.max(0, atRiskPaise - recovered);
  const share = atRiskPaise > 0 ? (recovered / atRiskPaise) * 100 : 0;

  return (
    <Panel
      title="Counterfactual revenue impact"
      action={
        executed ? (
          <Badge tone="success">measured</Badge>
        ) : (
          <Badge tone="neutral">no execution yet</Badge>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Cell
          label="Estimated loss without intervention"
          value={formatINR(atRiskPaise)}
          hint="observed shortfall vs baseline in the window"
        />
        <Cell
          label="Revenue recovered with REVIVE"
          value={formatINR(recovered)}
          hint={executed ? "captured by executed canary batches" : "nothing executed yet"}
          tone={recovered > 0 ? "success" : "neutral"}
        />
        <Cell
          label="Remaining revenue at risk"
          value={formatINR(remaining)}
          hint={`${share.toFixed(1)}% of the shortfall closed`}
        />
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-success"
          style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Prevented revenue loss equals what the bounded batches actually captured — it is the
        difference between the two figures above, not a projection of a full rollout.
      </p>
    </Panel>
  );
}
