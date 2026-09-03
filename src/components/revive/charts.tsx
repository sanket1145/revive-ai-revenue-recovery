import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { revenueTrend, riskByIncident, successRateTrend } from "@/lib/revive-data";

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

export function RevenueTrendChart() {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={revenueTrend} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="time" {...axis} />
        <YAxis {...axis} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [`₹${v} L`, ""]} />
        <Area isAnimationActive={false}
          type="monotone"
          dataKey="baseline"
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          fill="none"
          strokeWidth={1.5}
          name="Baseline"
        />
        <Area isAnimationActive={false}
          type="monotone"
          dataKey="revenue"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#revFill)"
          name="Actual"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SuccessRateChart() {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={successRateTrend} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="time" {...axis} />
        <YAxis domain={[60, 100]} {...axis} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, ""]} />
        <ReferenceLine
          y={93}
          stroke="var(--destructive)"
          strokeDasharray="4 4"
          label={{ value: "SLA floor", fill: "var(--destructive)", fontSize: 10, position: "insideTopRight" }}
        />
        <Line isAnimationActive={false}
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

export function RiskByIncidentChart() {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={riskByIncident}
        layout="vertical"
        margin={{ top: 6, right: 12, bottom: 0, left: 8 }}
      >
        <CartesianGrid stroke="var(--border)" horizontal={false} />
        <XAxis type="number" {...axis} />
        <YAxis type="category" dataKey="id" width={72} {...axis} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [`₹${v} L at risk`, ""]} />
        <Bar isAnimationActive={false} dataKey="risk" radius={[0, 4, 4, 0]} barSize={18}>
          {riskByIncident.map((entry) => (
            <Cell
              key={entry.id}
              fill={entry.risk > 60 ? "var(--destructive)" : "var(--chart-1)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data }: { data: { t: string; sr: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -28 }}>
        <XAxis dataKey="t" {...axis} />
        <YAxis domain={[0, 100]} {...axis} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, "Success rate"]} />
        <Line isAnimationActive={false}
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
