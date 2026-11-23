/**
 * Client helpers for Notification Quiet Hours & Prayer-Time Quiet Windows (Epic 22, E22-D6).
 *
 * - Formats `0..1439` minutes of day through `@al-ummah/shared-types` `dateTimeFormat` so Arabic
 *   uses Eastern Arabic numerals (`٠–٩`) and English uses `0–9` with identical SSR/client spaces.
 * - Reads locally cached prayer quiet windows computed on-device by Epic 21's local prayer-time
 *   calculator (`localStorage` key `aun:prayer-quiet-windows:v1`). Neither GPS coordinates nor
 *   city names ever leave the device.
 */
import {
  dateTimeFormat,
  DEFAULT_QUIET_HOURS_TIMEZONE,
  isValidIanaTimeZone,
  isValidPrayerQuietWindow,
  MAX_PRAYER_QUIET_WINDOWS,
  type PrayerQuietWindow,
} from '@al-ummah/shared-types';

export const LOCAL_PRAYER_WINDOWS_STORAGE_KEY = 'aun:prayer-quiet-windows:v1';

export const COMMON_QUIET_TIMEZONES: readonly string[] = [
  'UTC',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Africa/Cairo',
  'Europe/Istanbul',
  'Asia/Karachi',
  'Asia/Jakarta',
  'Asia/Kuala_Lumpur',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
];

/** Half-hour increments across the 24-hour day (0..1410). */
export const HALF_HOUR_MINUTES: readonly number[] = Array.from({ length: 48 }, (_, i) => i * 30);

/** Formats a minute-of-day (0..1439) for display in `locale` (Eastern Arabic digits in `ar`). */
export function formatMinuteOfDay(locale: string, minuteOfDay: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.floor(minuteOfDay)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return dateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(Date.UTC(2026, 0, 1, hours, minutes));
}

/** Browser's local IANA time zone when valid, else null. */
export function detectBrowserTimeZone(): string | null {
  try {
    // locale-format: machine
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidIanaTimeZone(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** Builds a deduplicated list of selectable IANA zones including current and browser-detected zones. */
export function buildQuietTimezoneOptions(currentZone: string, detectedZone: string | null): string[] {
  const set = new Set<string>();
  if (isValidIanaTimeZone(currentZone)) set.add(currentZone);
  if (detectedZone && isValidIanaTimeZone(detectedZone)) set.add(detectedZone);
  for (const tz of COMMON_QUIET_TIMEZONES) set.add(tz);
  if (set.size === 0) set.add(DEFAULT_QUIET_HOURS_TIMEZONE);
  return [...set];
}

/** Builds sorted minute options, preserving any custom non-half-hour minute saved from another client. */
export function buildQuietMinuteOptions(extraMinutes: number[] = []): number[] {
  const set = new Set<number>(HALF_HOUR_MINUTES);
  for (const m of extraMinutes) {
    if (Number.isInteger(m) && m >= 0 && m < 1440) set.add(m);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Reads up to 5 local-day `[startMinute, endMinute)` prayer intervals stored on-device by Epic 21's
 * prayer-time calculator (`aun:prayer-quiet-windows:v1`). Never reads or transmits coordinates.
 */
export function readLocalPrayerQuietWindows(): PrayerQuietWindow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PRAYER_WINDOWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { windows?: unknown }).windows)
        ? (parsed as { windows: unknown[] }).windows
        : [];
    return list
      .filter(isValidPrayerQuietWindow)
      .slice(0, MAX_PRAYER_QUIET_WINDOWS)
      .map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute }));
  } catch {
    return [];
  }
}
