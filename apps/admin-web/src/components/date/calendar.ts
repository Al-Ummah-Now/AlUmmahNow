/**
 * The admin calendar's date arithmetic (#1598): ISO days ("YYYY-MM-DD"), always in UTC so no
 * time zone or daylight-saving change ever shifts a day. Pure functions, so the keyboard rules
 * of the WAI-ARIA date picker pattern are unit-tested without a browser.
 */

/** 0 = Sunday … 6 = Saturday, as Date.getUTCDay() counts. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The first day of the week for the admin's language, from CLDR (Intl.Locale weekInfo): Saturday
 * in Arabic (ar, ar-EG), Sunday in English (en-US). Falls back to those when the runtime has no
 * weekInfo.
 */
export function weekStart(locale: string): Weekday {
  const arabic = locale.toLowerCase().startsWith('ar');
  try {
    const l = new Intl.Locale(arabic ? 'ar' : 'en-US') as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const first = (l.getWeekInfo?.() ?? l.weekInfo)?.firstDay;
    if (typeof first === 'number' && first >= 1 && first <= 7) return (first % 7) as Weekday;
  } catch {
    // older runtime: the defaults below
  }
  return arabic ? 6 : 0;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toUtc(iso: string): Date {
  const m = DAY.exec(iso);
  if (!m) throw new Error(`not an ISO day: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today in the browser's own calendar (the admin's day, not UTC's). */
export function todayIso(now = new Date()): string {
  return isoDay(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

/** Moves by whole months, keeping the day where it exists (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const d = toUtc(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return isoDay(target);
}

/** The first of the month containing `iso`. */
export function monthOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/**
 * The month as weeks, each starting on `firstDay`; days outside the month are null (shown as
 * empty cells, so a row never offers a day of another month).
 */
export function monthGrid(monthIso: string, firstDay: Weekday): (string | null)[][] {
  const first = toUtc(monthOf(monthIso));
  const lead = (first.getUTCDay() - firstDay + 7) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= days; d++) cells.push(isoDay(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), d))));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The seven weekdays in display order, starting on `firstDay`. */
export function weekdayOrder(firstDay: Weekday): Weekday[] {
  return Array.from({ length: 7 }, (_, i) => ((firstDay + i) % 7) as Weekday);
}

export function outOfRange(iso: string, min?: string, max?: string): boolean {
  return (!!min && iso < min.slice(0, 10)) || (!!max && iso > max.slice(0, 10));
}

/**
 * Where a key moves the focused day (the WAI-ARIA date picker grid): arrows one day (left and
 * right swap in a right-to-left page, so the arrow points where focus goes) or one week,
 * Home/End the first/last day of the week, PageUp/PageDown a month (with Shift a year).
 * Null for any other key.
 */
export function keyTarget(iso: string, key: string, opts: { rtl: boolean; firstDay: Weekday; shift?: boolean }): string | null {
  switch (key) {
    case 'ArrowRight':
      return addDays(iso, opts.rtl ? -1 : 1);
    case 'ArrowLeft':
      return addDays(iso, opts.rtl ? 1 : -1);
    case 'ArrowDown':
      return addDays(iso, 7);
    case 'ArrowUp':
      return addDays(iso, -7);
    case 'Home':
      return addDays(iso, -((toUtc(iso).getUTCDay() - opts.firstDay + 7) % 7));
    case 'End':
      return addDays(iso, 6 - ((toUtc(iso).getUTCDay() - opts.firstDay + 7) % 7));
    case 'PageUp':
      return addMonths(iso, opts.shift ? -12 : -1);
    case 'PageDown':
      return addMonths(iso, opts.shift ? 12 : 1);
    default:
      return null;
  }
}

/** The day the calendar opens on: the value, else today, kept inside min/max. */
export function startDay(value: string, today: string, min?: string, max?: string): string {
  const day = value || today;
  if (min && day < min.slice(0, 10)) return min.slice(0, 10);
  if (max && day > max.slice(0, 10)) return max.slice(0, 10);
  return day;
}
