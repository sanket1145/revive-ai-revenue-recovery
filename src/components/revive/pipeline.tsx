import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const stages = [
  "AI Recommendation",
  "Policy Engine",
  "Approved / Blocked",
  "Test Action",
  "Verification",
  "Audit Log",
];

/**
 * AI → Policy → Execution safety rail.
 *
 * `activeIndex` marks the last stage that has actually happened. It defaults
 * to -1 because in Step 1 nothing beyond detection runs: no stage is lit
 * unless the caller can prove it executed.
 */
export function SafetyPipeline({
  activeIndex = -1,
  blocked = false,
  className,
}: {
  activeIndex?: number;
  blocked?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {stages.map((stage, i) => {
        const done = i <= activeIndex;
        const isBlockGate = blocked && i === 2;
        return (
          <div key={stage} className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] font-medium",
                isBlockGate
                  ? "border-destructive/40 bg-destructive/12 text-destructive"
                  : done
                    ? "border-primary/30 bg-primary/12 text-primary"
                    : "border-border bg-secondary/60 text-muted-foreground",
              )}
            >
              {stage}
            </span>
            {i < stages.length - 1 && (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            )}
          </div>
        );
      })}
    </div>
  );
}
