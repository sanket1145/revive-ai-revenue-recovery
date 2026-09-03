/**
 * Presentation helpers. All money arrives from the backend in paise.
 *
 * Every formatter here is implemented without `toLocaleString`/`Intl` on
 * purpose: this app is server-rendered, and Node's ICU and the browser's ICU
 * disagree on `en-IN` date ordering, which produces React hydration mismatches.
 * Deterministic string building keeps SSR and client output byte-identical.
 */

const IST_OFFSET_MINUTES = 330; // UTC+05:30, no DST

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

interface IstParts {
  weekday: string;
  day: string;
  monthShort: string;
  monthLong: string;
  year: number;
  hour: string;
  minute: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function istParts(iso: string): IstParts | null {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return null;
  const shifted = new Date(base.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    weekday: WEEKDAYS[shifted.getUTCDay()] ?? "",
    day: pad(shifted.getUTCDate()),
    monthShort: MONTHS_SHORT[shifted.getUTCMonth()] ?? "",
    monthLong: MONTHS_LONG[shifted.getUTCMonth()] ?? "",
    year: shifted.getUTCFullYear(),
    hour: pad(shifted.getUTCHours()),
    minute: pad(shifted.getUTCMinutes()),
  };
}

/** Indian digit grouping: 96,622 · 1,00,000 · 1,23,45,678 */
export function groupIndian(value: number): string {
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  let out: string;
  if (digits.length <= 3) {
    out = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    out = `${rest},${last3}`;
  }
  return negative ? `-${out}` : out;
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** ₹2.70 Cr · ₹18.68 L · ₹4,530 */
export function formatINR(paise: number | null | undefined): string {
  if (paise == null || Number.isNaN(paise)) return "—";
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  if (abs >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(2)} L`;
  return `₹${groupIndian(rupees)}`;
}

/** Value in ₹ lakh, for chart axes. */
export function paiseToLakh(paise: number): number {
  return Math.round((paise / 100 / 1_00_000) * 100) / 100;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return groupIndian(n);
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatPp(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)} pp`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Clamps runaway percentage deltas so a KPI card never shows +4,247%. */
export function formatDeltaPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  if (value > 999) return ">+999%";
  if (value < -999) return "<-999%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatSignedCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}`;
}

/** 03 Sep 16:20 */
export function formatIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = istParts(iso);
  if (!p) return "—";
  return `${p.day} ${p.monthShort} ${p.hour}:${p.minute}`;
}

/** 16:20 */
export function formatISTTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = istParts(iso);
  if (!p) return "—";
  return `${p.hour}:${p.minute}`;
}

/** Thursday, 03 September 2026 */
export function formatISTDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = istParts(iso);
  if (!p) return "—";
  return `${p.weekday}, ${p.day} ${p.monthLong} ${p.year}`;
}

/** 03 Sep 2026 */
export function formatISTDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = istParts(iso);
  if (!p) return "—";
  return `${p.day} ${p.monthShort} ${p.year}`;
}

/** Short axis label: `16:20`, or `03 Sep 16:20` when the series spans days. */
export function sparkLabel(iso: string, spansDays: boolean): string {
  return spansDays ? formatIST(iso) : formatISTTime(iso);
}

export function durationLabel(startIso: string, endIso: string): string {
  const mins = Math.max(
    0,
    Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000),
  );
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Human label for a raw gateway failure code. */
export function humaniseReason(reason: string | null | undefined): string {
  if (!reason) return "unclassified";
  return reason.toLowerCase().replace(/_/g, " ");
}
