/**
 * Times in the videos admin (owner, 2026-11-21): the admin's own time zone with the zone shown
 * ("Nov 22, 2026, 2:20 PM UTC−5"; Arabic with Arabic digits and «غرينتش−٥»), and the UTC time for a
 * tooltip, to compare with logs. Pure (Intl only), so it is tested with a pinned zone.
 */
import { dateTimeFormat, isArabicLocale, localizeDigits, numberFormat } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';

/** The zone's offset from UTC at that moment: "UTC−5", "UTC+5:30", "UTC" (Arabic: «غرينتش−٥»). */
export function zoneLabel(at: Date, timeZone: string, locale: Locale): string {
  let raw = 'GMT';
  try {
    raw = dateTimeFormat('en', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  } catch {
    raw = 'GMT';
  }
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(raw);
  const arabic = isArabicLocale(locale);
  const base = arabic ? 'غرينتش' : 'UTC';
  // Newer ICU writes UTC itself as "GMT+0": a zero offset is the plain name on every runtime
  if (!m || (Number(m[2]) === 0 && !m[3])) return base;
  const offset = `${m[1] === '-' ? '−' : '+'}${Number(m[2])}${m[3] && m[3] !== '00' ? `:${m[3]}` : ''}`;
  return `${base}${arabic ? localizeDigits(locale, offset) : offset}`;
}

export interface LocalTime {
  /** In the zone, with its label */
  text: string;
  /** The same moment in UTC, for the tooltip */
  utc: string;
}

/** A moment in `timeZone` (the admin's browser zone) with the zone label, and in UTC. `seconds` for logs, where steps are seconds apart. */
export function formatLocalTime(value: string | number | Date, locale: Locale, timeZone: string, opts: { date?: boolean; seconds?: boolean } = {}): LocalTime | null {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const withDate = opts.date !== false;
  const timeStyle = opts.seconds ? 'medium' : 'short';
  const local = dateTimeFormat(locale, { ...(withDate ? { dateStyle: 'medium' } : {}), timeStyle, timeZone }).format(at);
  const utc = dateTimeFormat(locale, { dateStyle: 'medium', timeStyle, timeZone: 'UTC' }).format(at);
  return { text: `${local} ${zoneLabel(at, timeZone, locale)}`, utc: `${utc} ${zoneLabel(at, 'UTC', locale)}` };
}

/** A wait in words: "10 seconds", "5 minutes", "12 hours" («١٠ ثوانٍ», «٥ دقائق»). Rounded down. */
export function formatDuration(seconds: number, locale: Locale): string {
  const s = Math.max(0, Math.floor(seconds));
  const [value, unit] = s < 60 ? [s, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 86400), 'day'];
  return numberFormat(locale, { style: 'unit', unit, unitDisplay: 'long', useGrouping: false }).format(value);
}
