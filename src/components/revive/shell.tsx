import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertOctagon,
  ClipboardList,
  LayoutDashboard,
  Menu,
  ShieldCheck,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/incidents", label: "Revenue Incidents", icon: AlertOctagon },
  { to: "/recovery", label: "Recovery Actions", icon: ShieldCheck },
  { to: "/audit", label: "Audit Trail", icon: ClipboardList },
] as const;

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-panel px-4 py-5 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link to="/" className="flex items-center gap-2.5 px-2" onClick={() => setOpen(false)}>
          <span className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="size-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight">REVIVE AI</span>
            <span className="block text-[11px] text-muted-foreground">
              Revenue Incident Commander
            </span>
          </span>
        </Link>

        <nav className="mt-7 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{ className: "bg-accent text-foreground" }}
              inactiveProps={{ className: "text-muted-foreground hover:bg-secondary/60" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="absolute inset-x-4 bottom-5 rounded-md border border-border bg-elevated p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Radio className="size-3.5 text-success" />
            Detection engine live
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Streaming 1.2M txn/hr · policy engine v4.2 · autonomous execution disabled
          </p>
        </div>
      </aside>

      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-background/70 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
            <button
              className="rounded-md border border-border p-2 lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
              {subtitle && (
                <p className="truncate text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
              )}
            </div>
            <div className="hidden items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-xs text-muted-foreground sm:flex">
              <span className="size-1.5 rounded-full bg-success" />
              Merchant: Zolvex Retail · MID 7741208
            </div>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
