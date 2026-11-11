/**
 * "3 minutes ago" for list rows, in the admin's language (Intl.RelativeTimeFormat),
 * with the exact time for the hover title. Pure apart from Intl.
 */

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** The largest whole unit for the gap (negative = in the past). Under 45 s is "now" (0 seconds). */
export function relativeParts(date: Date, now: Date): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return { value: 0, unit: 'second' };
  for (const [unit, size] of UNITS) {
    if (abs >= size) return { value: Math.trunc(seconds / size), unit };
  }
  return { value: 0, unit: 'second' };
}

export function formatRelative(value: string | number | Date, locale: string, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const { value: amount, unit } = relativeParts(date, now);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(amount, unit);
}

/** The exact time for the title: date and time in the admin's language, with the time zone. */
export function formatExact(value: string | number | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long' }).format(date);
}
