import { formatDate, formatDateToParts, formatTime } from '@al-ummah/shared-types';

/**
 * The full history page groups what was watched by day, the way YouTube does: Today, Yesterday, the weekday for the
 * rest of the last week, then the date (with the year once it is not this year). Days are the viewer's own: the
 * browser's time zone unless one is given.
 */
export interface HistoryDay<T> {
  /** The calendar day, YYYY-MM-DD in the time zone */
  key: string;
  label: string;
  entries: T[];
}

/** YYYY-MM-DD of the date in the time zone (Latin digits: the 'en' parts) */
const dayKey = (date: Date, timeZone?: string) => {
  const parts = formatDateToParts('en', date, { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) });
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/** Whole days between two YYYY-MM-DD keys (b - a) */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function dayLabel(date: Date, lang: 'en' | 'ar', texts: { today: string; yesterday: string }, now: Date, timeZone?: string): string {
  const zone = timeZone ? { timeZone } : {};
  const ago = daysBetween(dayKey(date, timeZone), dayKey(now, timeZone));
  if (ago <= 0) return texts.today;
  if (ago === 1) return texts.yesterday;
  if (ago < 7) return formatDate(lang, date, { weekday: 'long', ...zone });
  const sameYear = dayKey(date, timeZone).slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  return formatDate(lang, date, { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }), ...zone });
}

/** Entries (newest first) grouped by the day they were last watched, in order */
export function groupByDay<T extends { lastWatchedAt: string }>(
  entries: T[],
  lang: 'en' | 'ar',
  texts: { today: string; yesterday: string },
  now: Date = new Date(),
  timeZone?: string,
): HistoryDay<T>[] {
  const days: HistoryDay<T>[] = [];
  for (const entry of entries) {
    const date = new Date(entry.lastWatchedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date, timeZone);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, label: dayLabel(date, lang, texts, now, timeZone), entries: [entry] });
  }
  return days;
}

/** The time of day it was watched, with the zone: "3:42 PM EST" / «٣:٤٢ م غرينتش-٥» */
export function watchedTime(value: string, lang: 'en' | 'ar', timeZone?: string): string {
  return formatTime(lang, value, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) });
}
