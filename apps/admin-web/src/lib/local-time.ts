/**
 * Times in the videos admin (owner, 2026-11-21): the admin's own time zone with the zone shown
 * ("Nov 22, 2026, 2:20 PM EST"; Arabic with Arabic digits and «غرينتش-٥»), and the UTC time for a
 * tooltip, to compare with logs. Pure (Intl only), so it is tested with a pinned zone.
 */
import { dateTimeFormat, numberFormat } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';

/**
 * The zone's short name at that moment, as Intl writes it in the page language (orchestrator ruling
 * 2026-11-22, from the owner's "9:41 AM EST"): "EST", "EDT", "GMT+5:30", "UTC"; Arabic «غرينتش-٥»,
 * «غرينتش+٣». Never a hand-built offset, so every admin page and the Tools app read the same.
 */
export function zoneLabel(at: Date, timeZone: string, locale: Locale): string {
  try {
    return dateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || 'UTC';
  } catch {
    return 'UTC';
  }
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
