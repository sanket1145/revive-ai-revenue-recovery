import type { ReactNode } from "react";
import { AlertTriangle, DatabaseZap, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/** Skeleton block used while a route's data is in flight. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-secondary/70", className)} />;
}

export function LoadingScreen({ label = "Loading command centre data" }: { label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="panel p-4">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-3 h-7 w-32" />
            <SkeletonBlock className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <SkeletonBlock className="h-3 w-48" />
          <SkeletonBlock className="mt-4 h-[240px] w-full" />
        </div>
        <div className="panel p-5">
          <SkeletonBlock className="h-3 w-40" />
          <SkeletonBlock className="mt-4 h-[240px] w-full" />
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="panel p-5">
            <SkeletonBlock className="h-3 w-32" />
            <SkeletonBlock className="mt-3 h-5 w-3/4" />
            <SkeletonBlock className="mt-4 h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Shown when the backend responded but has nothing to serve — no dataset,
 * no projection, or a transport error. Never a blank screen.
 */
export function DataUnavailable({
  reason,
  hint,
  onRetry,
}: {
  reason: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <section
      role="alert"
      className="panel flex flex-col items-start gap-3 border-warning/30 p-6 sm:p-8"
    >
      <span className="flex size-10 items-center justify-center rounded-md bg-warning/12 text-warning">
        <DatabaseZap className="size-5" />
      </span>
      <div>
        <h2 className="text-base font-semibold tracking-tight">Data layer unavailable</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{reason}</p>
        {hint && <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{hint}</p>}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
        >
          Retry
        </button>
      )}
    </section>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <section role="alert" className="panel flex flex-col items-start gap-3 border-destructive/40 p-6 sm:p-8">
      <span className="flex size-10 items-center justify-center rounded-md bg-destructive/12 text-destructive">
        <AlertTriangle className="size-5" />
      </span>
      <div>
        <h2 className="text-base font-semibold tracking-tight">Something went wrong</h2>
        <p className="mt-1 max-w-2xl break-words text-sm leading-relaxed text-muted-foreground">
          {error.message || "The page could not be rendered."}
        </p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
        >
          Try again
        </button>
      )}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-elevated/40 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
