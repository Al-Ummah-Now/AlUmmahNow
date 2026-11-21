/**
 * Fixed and other costs (COST-GAPS): what the platform pays outside the collected usage (Apple
 * Developer, domains, GitHub, Linear, AI subscriptions…), entered by a super admin on the Costs
 * page so the one monthly budget, the projection and the alerts include them. A yearly amount is
 * spread evenly over its twelve months; a cost counts from its start date to its end date (if any).
 */

export const FIXED_COST_PERIODS = ['monthly', 'yearly'] as const;
export type FixedCostPeriod = (typeof FIXED_COST_PERIODS)[number];

export interface FixedCost {
  id: string;
  name: string;
  /** USD per period. */
  amountUsd: number;
  period: FixedCostPeriod;
  /** 'YYYY-MM-DD': first day it is paid for. */
  startDate: string;
  /** 'YYYY-MM-DD' or null: last day it is paid for. */
  endDate: string | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface FixedCostInput {
  name: string;
  amountUsd: number;
  period: FixedCostPeriod;
  startDate: string;
  endDate: string | null;
  note: string | null;
}

export const FIXED_COST_LIMITS = { nameMax: 80, noteMax: 200, amountMax: 100_000, items: 100 } as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Validates a create/update body. Returns the clean input or an English error (the page maps codes to copy). */
export function parseFixedCostInput(body: unknown): FixedCostInput | { error: string; field: keyof FixedCostInput } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object', field: 'name' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > FIXED_COST_LIMITS.nameMax) return { error: `name must be 1–${FIXED_COST_LIMITS.nameMax} characters`, field: 'name' };
  const amount = typeof b.amountUsd === 'number' ? b.amountUsd : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > FIXED_COST_LIMITS.amountMax) return { error: `amountUsd must be more than 0 and at most ${FIXED_COST_LIMITS.amountMax}`, field: 'amountUsd' };
  if (!(FIXED_COST_PERIODS as readonly unknown[]).includes(b.period)) return { error: 'period must be monthly or yearly', field: 'period' };
  if (!validDay(b.startDate)) return { error: 'startDate must be a date (YYYY-MM-DD)', field: 'startDate' };
  const endDate = b.endDate === null || b.endDate === undefined || b.endDate === '' ? null : b.endDate;
  if (endDate !== null && !validDay(endDate)) return { error: 'endDate must be a date (YYYY-MM-DD) or empty', field: 'endDate' };
  if (endDate !== null && endDate < (b.startDate as string)) return { error: 'endDate must not be before startDate', field: 'endDate' };
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, FIXED_COST_LIMITS.noteMax) : null;
  return { name, amountUsd: Math.round(amount * 100) / 100, period: b.period as FixedCostPeriod, startDate: b.startDate as string, endDate, note };
}

/** What one cost adds to a month: the month's share of its amount for the days it is active. */
export function fixedCostMonthShare(c: Pick<FixedCost, 'amountUsd' | 'period' | 'startDate' | 'endDate'>, month: string): number {
  const first = `${month}-01`;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const from = c.startDate > first ? c.startDate : first;
  const to = c.endDate && c.endDate < last ? c.endDate : last;
  if (from > to) return 0;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const monthly = c.period === 'yearly' ? c.amountUsd / 12 : c.amountUsd;
  return Math.round(((monthly * days) / daysInMonth) * 1e6) / 1e6;
}

/**
 * The month so far and the whole month for every active cost. "So far" counts the active days up
 * to `now` (the same way the plan's fee is spread), so the projection never jumps on the 1st.
 */
export function fixedCostsForMonth(items: Pick<FixedCost, 'amountUsd' | 'period' | 'startDate' | 'endDate'>[], now: Date): { mtd: number; projected: number } {
  const month = now.toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);
  const elapsedFraction = (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  let mtd = 0;
  let projected = 0;
  for (const c of items) {
    const whole = fixedCostMonthShare(c, month);
    if (whole <= 0) continue;
    projected += whole;
    // Days before today, plus the part of today that has passed
    const untilYesterday = today > `${month}-01` ? fixedCostMonthShare({ ...c, endDate: minDay(c.endDate, dayBefore(today)) }, month) : 0;
    const todayShare = fixedCostMonthShare({ ...c, startDate: maxDay(c.startDate, today), endDate: minDay(c.endDate, today) }, month);
    mtd += untilYesterday + todayShare * elapsedFraction;
  }
  return { mtd: Math.round(mtd * 100) / 100, projected: Math.round(projected * 100) / 100 };
}

const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const minDay = (a: string | null, b: string) => (a && a < b ? a : b);
const maxDay = (a: string, b: string) => (a > b ? a : b);
