/**
 * Operations page model (docs/admin/LIVE_OPS.md §A.4): query params, which
 * charts each tab shows, gap filling of sparse series, number formats with
 * the locale's digits, and the cap bar. Pure: server and client safe.
 */
import { chartLocale, compactNumber } from '@al-ummah/shared-types';
import { OPS_ENVS, OPS_KINDS, OPS_RANGES, type OpsBudgetLevel, type OpsCosts, type OpsEnv, type OpsKind, type OpsMetric, type OpsRange, type OpsSeries } from '@/lib/api/ops-types';

type Param = string | string[] | undefined;
const one = (v: Param) => (Array.isArray(v) ? v[0] : v);

export function parseEnv(v: Param): OpsEnv {
  const s = one(v);
  return (OPS_ENVS as readonly string[]).includes(s ?? '') ? (s as OpsEnv) : 'production';
}
export function parseTab(v: Param): OpsKind {
  const s = one(v);
  return (OPS_KINDS as readonly string[]).includes(s ?? '') ? (s as OpsKind) : 'worker';
}
export function parseRange(v: Param): OpsRange {
  const s = one(v);
  return (OPS_RANGES as readonly string[]).includes(s ?? '') ? (s as OpsRange) : '24h';
}

export type ValueFormat = 'count' | 'bytes' | 'ms' | 'us' | 'gbs';

export interface ChartSpec {
  metric: OpsMetric;
  /** operations.charts.<label> */
  label: 'requests' | 'errors' | 'cpu_p99' | 'reads' | 'writes' | 'latency_p99' | 'r2requests' | 'stored_bytes' | 'bytes' | 'backlog_max' | 'messages' | 'kvReads' | 'kvWrites' | 'doRequests' | 'gb_seconds';
  format: ValueFormat;
}

/** Three charts per tab: volume, failures/pressure, size or latency. */
export const TAB_CHARTS: Record<OpsKind, ChartSpec[]> = {
  worker: [
    { metric: 'requests', label: 'requests', format: 'count' },
    { metric: 'errors', label: 'errors', format: 'count' },
    { metric: 'cpu_p99', label: 'cpu_p99', format: 'us' },
  ],
  d1: [
    { metric: 'reads', label: 'reads', format: 'count' },
    { metric: 'writes', label: 'writes', format: 'count' },
    { metric: 'latency_p99', label: 'latency_p99', format: 'ms' },
  ],
  r2: [
    { metric: 'requests', label: 'r2requests', format: 'count' },
    { metric: 'bytes', label: 'bytes', format: 'bytes' },
    { metric: 'stored_bytes', label: 'stored_bytes', format: 'bytes' },
  ],
  queue: [
    { metric: 'backlog_max', label: 'backlog_max', format: 'count' },
    { metric: 'writes', label: 'messages', format: 'count' },
  ],
  kv: [
    { metric: 'reads', label: 'kvReads', format: 'count' },
    { metric: 'writes', label: 'kvWrites', format: 'count' },
    { metric: 'stored_bytes', label: 'stored_bytes', format: 'bytes' },
  ],
  do: [
    { metric: 'gb_seconds', label: 'gb_seconds', format: 'gbs' },
    { metric: 'requests', label: 'doRequests', format: 'count' },
  ],
};

const HOUR = 3_600_000;
const DAY = 86_400_000;
const hourKey = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Every hour (or day) of the range, oldest first, with the series' value or null (a gap). */
export function fillSeries(series: Pick<OpsSeries, 'granularity' | 'points'>, range: OpsRange, now: Date): { t: string; value: number | null }[] {
  const byT = new Map(series.points.map((p) => [p.t, p.value]));
  if (series.granularity === 'hour') {
    const end = Math.floor(now.getTime() / HOUR) * HOUR;
    const hours = range === '24h' ? 24 : 168;
    return Array.from({ length: hours }, (_, i) => {
      const t = hourKey(end - (hours - i) * HOUR);
      return { t, value: byT.get(t) ?? null };
    });
  }
  const days = range === '30d' ? 30 : 7;
  const today = Math.floor(now.getTime() / DAY) * DAY;
  return Array.from({ length: days }, (_, i) => {
    const t = dayKey(today - (days - 1 - i) * DAY);
    return { t, value: byT.get(t) ?? null };
  });
}

export interface OpsFormats {
  count: (v: number) => string;
  bytes: (v: number) => string;
  ms: (v: number) => string;
  us: (v: number) => string;
  /** Durable Object duration, GB-seconds. */
  gbs: (v: number) => string;
  percent: (v: number) => string;
  usd: (v: number) => string;
  hour: (t: string) => string;
  day: (t: string) => string;
  /** 'YYYY-MM' as the month's name and year. */
  month: (ym: string) => string;
  time: (iso: string) => string;
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

export function opsFormats(locale: string): OpsFormats {
  const loc = chartLocale(locale);
  const compact = compactNumber(locale);
  const ms = new Intl.NumberFormat(loc, { style: 'unit', unit: 'millisecond', unitDisplay: 'short', maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 2 });
  const usd = new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hour = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', hour: 'numeric', timeZone: 'UTC' });
  const day = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const time = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const date = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return {
    count: (v) => compact(v),
    bytes: (v) => {
      let i = 0;
      let n = v;
      while (Math.abs(n) >= 1000 && i < BYTE_UNITS.length - 1) {
        n /= 1000;
        i++;
      }
      return new Intl.NumberFormat(loc, { style: 'unit', unit: BYTE_UNITS[i], unitDisplay: 'short', maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);
    },
    ms: (v) => ms.format(v),
    // CPU comes in microseconds: shown in ms from 1,000 µs
    us: (v) => (v >= 1000 ? ms.format(v / 1000) : `${compact(v)} µs`),
    gbs: (v) => `${compact(Math.round(v))} GB-s`,
    percent: (v) => percent.format(v),
    usd: (v) => usd.format(v),
    hour: (t) => hour.format(date(t)),
    day: (t) => day.format(date(t)),
    month: (ym) => month.format(date(`${ym}-01`)),
    time: (iso) => `${time.format(date(iso))} UTC`,
  };
}

/** Share of the monthly cap the projection uses (0..1, capped for the bar), and whether it is over. */
export function capShare(projected: number, cap: number): { share: number; over: boolean; warn: boolean } {
  const raw = cap > 0 ? projected / cap : 0;
  return { share: Math.max(0, Math.min(1, raw)), over: raw > 1, warn: raw >= 0.8 };
}

export type MeterTone = 'ok' | 'warn' | 'danger';

export interface BudgetMeter {
  /** Month to date, % of the budget (0..100 for the bar). */
  spentPct: number;
  /** Projected month end, % of the budget (0..100 for the bar). */
  projectedPct: number;
  /** Where the warning ticks sit, % of the budget. */
  ticks: number[];
  tone: MeterTone;
  projectedTone: MeterTone;
  over: boolean;
  projectedOver: boolean;
}

/** Under 50%: ok; from 50%: warn; from 80% (and over): danger. */
const toneOf = (level: OpsBudgetLevel): MeterTone => (level === 'over' || level === 'warn80' ? 'danger' : level === 'warn50' ? 'warn' : 'ok');
const pct = (share: number) => Math.round(Math.max(0, Math.min(1, share)) * 1000) / 10;

/** The budget meter: spent and projected against the budget, ticks at the warning levels. */
export function budgetMeter(budget: OpsCosts['budget']): BudgetMeter {
  return {
    spentPct: pct(budget.share),
    projectedPct: pct(budget.projectedShare),
    ticks: budget.levels.filter((l) => l < 1).map((l) => Math.round(l * 100)),
    tone: toneOf(budget.level),
    projectedTone: toneOf(budget.projectedLevel),
    over: budget.share >= 1,
    projectedOver: budget.projectedShare >= 1,
  };
}

/** Whether the projected idle cost is under its target, and by how much it is over. */
export function idleStatus(idle: Pick<OpsCosts['idle'], 'monthlyUsd' | 'targetUsd'>): { under: boolean; overBy: number } {
  return { under: idle.monthlyUsd <= idle.targetUsd, overBy: Math.max(0, Math.round((idle.monthlyUsd - idle.targetUsd) * 100) / 100) };
}

/** The daily share of the budget, the reference line on the spend chart. */
export function dailyBudget(capUsd: number, month: string): number {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.round((capUsd / days) * 100) / 100;
}
