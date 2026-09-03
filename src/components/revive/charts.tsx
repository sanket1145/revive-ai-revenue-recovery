import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SLA_SUCCESS_RATE_FLOOR } from "@/lib/revive/config";
import { paiseToLakh } from "@/lib/revive/format";
import type {
  RevenueTrendPoint,
  RiskByIncidentRow,
  SparkPoint,
  SuccessRateTrendPoint,
} from "@/lib/revive/types";

const axis = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

const tooltipStyle = {
  contentStyle: {
    background: "var(--elevated)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "var(--foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)" },
} as const;

function EmptyChart({ height, label }: { height: number; label: string }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
    >
      {label}
    </div>
  );
}

/** Hourly captured revenue against the same-hour 7-day baseline, in ₹ lakh. */
export function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  if (data.length === 0) return <EmptyChart height={240} label="No revenue recorded yet today" />;

  const series = data.map((p) => ({
    time: p.time,
    revenue: paiseToLakh(p.revenuePaise),
    baseline: paiseToLakh(p.baselinePaise),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="time" {...axis} />
        <YAxis {...axis} />
        <Tooltip
          {...tooltipStyle}
          formatter={(v: number, name: string) => [`₹${v.toFixed(2)} L`, name]}
        />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="baseline"
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          fill="none"
          strokeWidth={1.5}
          name="Baseline"
        />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="revenue"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#revFill)"
          name="Captured"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Hourly payment success rate against the same-hour 7-day baseline. */
export function SuccessRateChart({ data }: { data: SuccessRateTrendPoint[] }) {
  const series = data.filter((p) => p.sr !== null);
  if (series.length === 0) return <EmptyChart height={240} label="No attempts recorded yet today" />;

  const values = series.flatMap((p) => [p.sr ?? 100, p.baseline ?? 100]);
  const min = Math.min(...values, SLA_SUCCESS_RATE_FLOOR);
  const lower = Math.max(0, Math.floor((min - 5) / 5) * 5);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="time" {...axis} />
        <YAxis domain={[lower, 100]} {...axis} />
        <Tooltip
          {...tooltipStyle}
          formatter={(v: number, name: string) => [`${v.toFixed(2)}%`, name]}
        />
        <ReferenceLine
          y={SLA_SUCCESS_RATE_FLOOR}
          stroke="var(--destructive)"
          strokeDasharray="4 4"
          label={{
            value: "SLA floor",
            fill: "var(--destructive)",
            fontSize: 10,
            position: "insideTopRight",
          }}
        />
        <Line
          isAnimationActive={false}
          type="monotone"
          dataKey="baseline"
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          dot={false}
          name="Baseline"
        />
        <Line
          isAnimationActive={false}
          type="monotone"
          dataKey="sr"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          name="Success rate"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Revenue at risk per open incident, in ₹ lakh. */
export function RiskByIncidentChart({ data }: { data: RiskByIncidentRow[] }) {
  if (data.length === 0)
    return <EmptyChart height={240} label="No incidents carrying revenue at risk" />;

  const series = data.map((r) => ({
    id: r.code,
    risk: paiseToLakh(r.atRiskPaise),
    severity: r.severity,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={series}
        layout="vertical"
        margin={{ top: 6, right: 12, bottom: 0, left: 8 }}
      >
        <CartesianGrid stroke="var(--border)" horizontal={false} />
        <XAxis type="number" {...axis} />
        <YAxis type="category" dataKey="id" width={72} {...axis} />
        <Tooltip
          {...tooltipStyle}
          formatter={(v: number) => [`₹${v.toFixed(2)} L at risk`, ""]}
        />
        <Bar isAnimationActive={false} dataKey="risk" radius={[0, 4, 4, 0]} barSize={18}>
          {series.map((entry) => (
            <Cell
              key={entry.id}
              fill={
                entry.severity === "critical" || entry.severity === "high"
                  ? "var(--destructive)"
                  : "var(--chart-1)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Per-incident success-rate trace with the detection window shaded. */
export function Sparkline({
  data,
  formatLabel,
}: {
  data: SparkPoint[];
  formatLabel: (iso: string) => string;
}) {
  if (data.length === 0) return <EmptyChart height={120} label="No trace available" />;

  const series = data.map((p) => ({ t: formatLabel(p.ts), sr: p.sr, inIncident: p.inIncident }));
  const firstHit = series.findIndex((p) => p.inIncident);
  const lastHit = series.length - 1 - [...series].reverse().findIndex((p) => p.inIncident);
  const shade =
    firstHit >= 0 && lastHit >= firstHit
      ? { from: series[firstHit]?.t, to: series[lastHit]?.t }
      : null;

  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -28 }}>
        <XAxis dataKey="t" {...axis} interval="preserveStartEnd" />
        <YAxis domain={[0, 100]} {...axis} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v.toFixed(2)}%`, "Success rate"]} />
        {shade?.from && shade.to && (
          <ReferenceArea
            x1={shade.from}
            x2={shade.to}
            fill="var(--destructive)"
            fillOpacity={0.1}
            stroke="none"
          />
        )}
        <Line
          isAnimationActive={false}
          type="monotone"
          dataKey="sr"
          stroke="var(--chart-2)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
