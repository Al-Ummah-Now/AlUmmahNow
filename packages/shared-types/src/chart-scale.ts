/**
 * Value-axis maths and number formats shared by every chart (web Studio
 * analytics, admin-web). Pure: no DOM, no React.
 */

/**
 * The locale for chart numbers and dates: Arabic always gets Arabic-Indic digits
 * (engines differ on the default for plain "ar"), like the calendar does.
 */
export function chartLocale(locale: string): string {
  return /^ar\b/.test(locale) && !locale.includes('-u-nu-') ? 'ar-u-nu-arab' : locale;
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

export interface ValueScale {
  /** Top of the axis: the last tick, never below the largest value. */
  top: number;
  /** Tick values from 0 to `top`, ascending. */
  ticks: number[];
}

/**
 * 0-based axis with about `target` intervals on round numbers (1, 2, 2.5, 5 x 10^n).
 * `integer` keeps steps whole, for counts. A fixed `max` (1 for a share) is used as is.
 */
export function niceScale(values: readonly number[], options: { target?: number; integer?: boolean; max?: number } = {}): ValueScale {
  const target = Math.max(1, options.target ?? 4);
  if (options.max !== undefined && options.max > 0) {
    const step = options.max / target;
    return { top: options.max, ticks: Array.from({ length: target + 1 }, (_, i) => round(i * step)) };
  }
  const largest = Math.max(0, ...values.filter((value) => Number.isFinite(value)));
  if (largest === 0) return { top: 1, ticks: [0, 1] };
  const raw = largest / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  let step = magnitude * (NICE_STEPS.find((candidate) => candidate * magnitude >= raw) ?? 10);
  if (options.integer) step = Math.max(1, Math.ceil(step));
  if (options.integer && !Number.isInteger(step / magnitude) && step < 10) step = Math.ceil(step);
  const count = Math.max(1, Math.ceil(largest / step - 1e-9));
  const ticks = Array.from({ length: count + 1 }, (_, i) => round(i * step));
  return { top: ticks[ticks.length - 1], ticks };
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** 1234 -> "1.2K" (en), "١٫٢ ألف" (ar). */
export function compactNumber(locale: string): (value: number) => string {
  const format = new Intl.NumberFormat(chartLocale(locale), { notation: 'compact', maximumFractionDigits: 1 });
  return (value) => format.format(value);
}

export type WatchTimeUnit = 'minute' | 'hour';

/** Hours once the largest value reaches two hours, minutes below that. */
export function watchTimeUnit(largestSeconds: number): WatchTimeUnit {
  return largestSeconds >= 2 * 3600 ? 'hour' : 'minute';
}

/** A value already in minutes or hours, with the unit: 3.1 -> "3.1 min", "٣٫١ د". */
export function formatInUnit(locale: string, unit: WatchTimeUnit): (value: number) => string {
  const format = new Intl.NumberFormat(chartLocale(locale), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 });
  return (value) => format.format(value || 0);
}

/** Watch time in minutes or hours. */
export function watchTimeInUnit(seconds: number, unit: WatchTimeUnit): number {
  return (seconds || 0) / (unit === 'hour' ? 3600 : 60);
}

/** Seconds as minutes or hours with the unit: "3.1 min", "12.5 hr". */
export function formatWatchTime(locale: string, unit: WatchTimeUnit): (seconds: number) => string {
  const format = formatInUnit(locale, unit);
  return (seconds) => format(watchTimeInUnit(seconds, unit));
}

/** 75 -> "1:15", 3725 -> "1:02:05", with the locale's digits. */
export function formatDuration(locale: string): (seconds: number) => string {
  const plain = new Intl.NumberFormat(chartLocale(locale), { useGrouping: false });
  const two = new Intl.NumberFormat(chartLocale(locale), { minimumIntegerDigits: 2, useGrouping: false });
  return (seconds) => {
    const total = Math.max(0, Math.round(seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${plain.format(h)}:${two.format(m)}:${two.format(s)}` : `${plain.format(m)}:${two.format(s)}`;
  };
}

/** Indices to label on a time axis: the first, the last and evenly spaced ones between (at most `count`). */
export function labelIndices(length: number, count = 5): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const picked = new Set<number>();
  for (let i = 0; i < count; i++) picked.add(Math.round((i * (length - 1)) / (count - 1)));
  return [...picked].sort((a, b) => a - b);
}
