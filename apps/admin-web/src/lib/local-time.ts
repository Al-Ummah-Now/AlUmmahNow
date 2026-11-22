/**
 * Times in the videos admin (owner, 2026-11-21): the admin's own time zone with the zone shown
 * ("Nov 22, 2026, 2:20 PM EST"; Arabic with Arabic digits and «غرينتش-٥»), and the UTC time for a
 * tooltip, to compare with logs. Pure (Intl only), so it is tested with a pinned zone.
 */
import { dateTimeFormat, isArabicLocale, numberFormat } from '@al-ummah/shared-types';
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

const NBSP = '\u00A0';
const glue = (part: string) => part.replace(/\s/g, NBSP);

/**
 * The date stays whole ("Nov 22, 2026"), the time stays whole ("9:02 PM") and the zone stays with the time:
 * a narrow cell breaks only between the date and the time (AUDIT-2 2026-11-22).
 */
function keepTogether(text: string, at: Date, locale: Locale, timeZone: string, withDate: boolean, timeStyle: 'short' | 'medium'): string {
  const time = dateTimeFormat(locale, { timeStyle, timeZone }).format(at);
  let out = text.endsWith(time) ? text.slice(0, text.length - time.length) + glue(time) : glue(text);
  if (withDate) {
    const date = dateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(at);
    if (out.startsWith(date)) out = glue(date) + out.slice(date.length);
  }
  return out;
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
  const local = keepTogether(dateTimeFormat(locale, { ...(withDate ? { dateStyle: 'medium' } : {}), timeStyle, timeZone }).format(at), at, locale, timeZone, withDate, timeStyle);
  const utc = keepTogether(dateTimeFormat(locale, { dateStyle: 'medium', timeStyle, timeZone: 'UTC' }).format(at), at, locale, 'UTC', true, timeStyle);
  return { text: `${local}${NBSP}${zoneLabel(at, timeZone, locale)}`, utc: `${utc}${NBSP}${zoneLabel(at, 'UTC', locale)}` };
}

/** An hour on a chart axis in `timeZone`, without the zone (the heading names it): "Nov 22, 4:00 PM". */
export function formatLocalHour(value: string | number | Date, locale: Locale, timeZone: string): string | null {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return dateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(at);
}

/**
 * A wait in words, exact to the second: "10 seconds", "1 minute 20 seconds", "2 hours 5 minutes"
 * («١٠ ثوانٍ», «دقيقة واحدة و٢٠ ثانية» in the page's own forms). Two units at most, the larger first.
 */
export function formatDuration(seconds: number, locale: Locale): string {
  const s = Math.max(0, Math.floor(seconds));
  const [big, small]: [[number, string], [number, string]] =
    s < 60 ? [[s, 'second'], [0, 'second']] : s < 3600 ? [[Math.floor(s / 60), 'minute'], [s % 60, 'second']] : s < 86400 ? [[Math.floor(s / 3600), 'hour'], [Math.floor((s % 3600) / 60), 'minute']] : [[Math.floor(s / 86400), 'day'], [Math.floor((s % 86400) / 3600), 'hour']];
  // Each number stays with its unit ("20\u00A0seconds"): a narrow log line never leaves the unit alone (AUDIT-2)
  const unit = ([value, name]: [number, string]) => glue(numberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'long', useGrouping: false }).format(value));
  if (!small[0]) return unit(big);
  return isArabicLocale(locale) ? `${unit(big)} و${unit(small)}` : `${unit(big)} ${unit(small)}`;
}
