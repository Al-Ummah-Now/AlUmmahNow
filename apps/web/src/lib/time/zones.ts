/**
 * Time zones for people to pick and read (the post scheduler; Story 29.4 owner review):
 * a friendly localized name with its GMT offset («توقيت شرق أمريكا الشمالية (غرينتش−٥)»,
 * "Eastern Time (GMT−5)"), and wall-clock times in a chosen zone converted to and from UTC.
 *
 * Every formatter comes from the shared locale-format (packages/shared-types, #1503): cached, with
 * the digits pinned (Arabic ٠–٩, English 0–9). Internal parsing uses the English formatter, whose
 * parts are always 0–9.
 */
import { dateTimeFormat, numberFormat } from '@al-ummah/shared-types';
import { ZONE_PLACES_AR } from './zone-places-ar';

/** The viewer's own zone (UTC when the browser does not say). */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every zone the browser knows (the picker's list), the viewer's own first. */
export function allZones(): string[] {
  const own = browserZone();
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (!zones.includes('UTC')) zones.push('UTC');
  return [own, ...zones.filter((z) => z !== own)];
}

export function isZone(zone: string): boolean {
  try {
    dateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Minutes the zone is ahead of UTC at that instant (New York in winter: -300). */
export function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = dateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return Math.round((asUtc - (at.getTime() - at.getMilliseconds())) / 60_000);
}

/** "YYYY-MM-DDTHH:mm" read as a wall-clock time in `zone`, as a Date (NaN date when malformed). */
export function wallTimeToDate(local: string, zone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return new Date(NaN);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Two passes settle the offset across a daylight-saving change
  let at = guess - zoneOffsetMinutes(zone, new Date(guess)) * 60_000;
  at = guess - zoneOffsetMinutes(zone, new Date(at)) * 60_000;
  return new Date(at);
}

/** An instant as "YYYY-MM-DDTHH:mm" on the wall clock of `zone`. */
export function dateToWallTime(at: Date, zone: string): string {
  const parts = dateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at);
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour') === '24' ? '00' : v('hour')}:${v('minute')}`;
}

/** "GMT−5", "GMT+5:30" in the locale's digits («غرينتش−٥» is not used: GMT reads the same in both). */
export function offsetLabel(zone: string, locale: string, at = new Date()): string {
  const minutes = zoneOffsetMinutes(zone, at);
  if (minutes === 0) return 'GMT';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const nf = numberFormat(locale, { useGrouping: false });
  const h = nf.format(Math.floor(abs / 60));
  const mm = abs % 60 ? `:${numberFormat(locale, { minimumIntegerDigits: 2 }).format(abs % 60)}` : '';
  return `GMT${sign}${h}${mm}`;
}

/**
 * The zone's localized generic name ("Eastern Time", «التوقيت الشرقي»), else its city. Arabic CLDR adds
 * «لأمريكا الشمالية» to the Eastern, Central and Mountain names where English says only "Eastern Time":
 * that suffix is dropped, so both languages name the zone the same way (AUDIT-2).
 */
export function zoneName(zone: string, locale: string, at = new Date()): string {
  if (zone === 'UTC' || zone === 'Etc/UTC') return locale === 'ar' ? 'التوقيت العالمي المنسق' : 'Coordinated Universal Time';
  try {
    const part = dateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longGeneric' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    // A bare offset ("GMT+03:00") is no name: fall back to the city
    if (part && !/^(GMT|UTC|غرينتش)/.test(part)) return part.replace(/\s+لأمريكا الشمالية$/, '');
  } catch {
    // An unknown zone: the city below
  }
  return zoneCity(zone);
}

/**
 * The zone's place in the page's language: English takes it from the zone id ("Buenos Aires"); Arabic
 * from CLDR's location name («توقيت نيويورك» → «نيويورك», a one-zone country by its country name:
 * «مصر»). Null when CLDR has only an offset for it. Arabic reads a table generated from full ICU
 * (zone-places-ar.ts): browsers ship trimmed ICU data, and Chromium answered «توقيت New York», so an
 * Arabic row showed a Latin city (AUDIT-2). The browser's own name is used only for a zone the table
 * lacks, and never when it holds a Latin letter.
 */
export function zonePlace(zone: string, locale: string, at = new Date()): string | null {
  if (locale !== 'ar') return zoneCity(zone);
  if (Object.prototype.hasOwnProperty.call(ZONE_PLACES_AR, zone)) return ZONE_PLACES_AR[zone];
  try {
    const part = dateTimeFormat('ar', { timeZone: zone, timeZoneName: 'shortGeneric' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!part || /(GMT|UTC|غرينتش|[0-9٠-٩A-Za-z])/.test(part)) return null;
    return part.replace(/^توقيت\s+/, '').trim() || null;
  } catch {
    return null;
  }
}

/** The place in the zone id ("America/Argentina/Buenos_Aires" → "Buenos Aires"). */
export function zoneCity(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/**
 * "Eastern Time (GMT−5)" / «التوقيت الشرقي (GMT−٥)», joined by a no-break space. In Arabic the offset is a
 * left-to-right isolate (U+2066 … U+2069): without it the bidi algorithm shows «(٥−GMT)».
 */
export function zoneLabel(zone: string, locale: string, at = new Date()): string {
  const offset = offsetLabel(zone, locale, at);
  // A no-break space keeps the offset with the name's last word: "(GMT−5)" never wraps onto a line alone
  return `${zoneName(zone, locale, at)}\u00a0(${locale === 'ar' ? `\u2066${offset}\u2069` : offset})`;
}
