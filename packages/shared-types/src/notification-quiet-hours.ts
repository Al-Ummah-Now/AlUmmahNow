/**
 * Notification quiet hours & prayer-time quiet windows (Epic 22, owner decision E22-D6).
 *
 * - One daily quiet window (`enabled`, `timezone`, `startMinute`, `endMinute`) plus an optional
 *   "quiet during prayer times" toggle (`prayerQuietEnabled`, `prayerWindows`).
 * - Prayer windows are up to 5 local-day `[startMinute, endMinute)` intervals computed on-device
 *   from Epic 21's local prayer-time library; neither coordinates nor city names ever leave the device.
 * - During active quiet windows, optional notifications wait silently in the inbox without pushing;
 *   `account` and security notices always come through; no summary push is sent afterwards.
 */

export const MAX_PRAYER_QUIET_WINDOWS = 5;
/** Prayer windows older than 7 days without a client refresh are ignored during push dispatch. */
export const PRAYER_WINDOWS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_QUIET_HOURS_TIMEZONE = 'UTC';
/** 22:00 local time. */
export const DEFAULT_QUIET_START_MINUTE = 22 * 60;
/** 06:00 local time. */
export const DEFAULT_QUIET_END_MINUTE = 6 * 60;

export interface PrayerQuietWindow {
  /** Minute of local day (0..1439, inclusive). */
  startMinute: number;
  /** Minute of local day (0..1439, exclusive; wraps past midnight when startMinute > endMinute). */
  endMinute: number;
}

export interface NotificationQuietHours {
  enabled: boolean;
  timezone: string;
  startMinute: number;
  endMinute: number;
  prayerQuietEnabled: boolean;
  prayerWindows: PrayerQuietWindow[];
  prayerWindowsUpdatedAt?: number | null;
}

export interface NotificationQuietHoursUpdate {
  enabled?: boolean;
  timezone?: string;
  startMinute?: number;
  endMinute?: number;
  prayerQuietEnabled?: boolean;
  prayerWindows?: PrayerQuietWindow[];
}

export const DEFAULT_NOTIFICATION_QUIET_HOURS: NotificationQuietHours = {
  enabled: false,
  timezone: DEFAULT_QUIET_HOURS_TIMEZONE,
  startMinute: DEFAULT_QUIET_START_MINUTE,
  endMinute: DEFAULT_QUIET_END_MINUTE,
  prayerQuietEnabled: false,
  prayerWindows: [],
  prayerWindowsUpdatedAt: null,
};

export function defaultNotificationQuietHours(): NotificationQuietHours {
  return { ...DEFAULT_NOTIFICATION_QUIET_HOURS, prayerWindows: [], prayerWindowsUpdatedAt: null };
}

export function isMinuteOfDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440;
}

export function isValidIanaTimeZone(timezone: unknown): timezone is string {
  if (typeof timezone !== 'string') return false;
  const trimmed = timezone.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    // locale-format: machine
    new Intl.DateTimeFormat('en-GB', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function isValidPrayerQuietWindow(value: unknown): value is PrayerQuietWindow {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return isMinuteOfDay(raw.startMinute) && isMinuteOfDay(raw.endMinute) && raw.startMinute !== raw.endMinute;
}

/** Parses stored JSON into up to MAX_PRAYER_QUIET_WINDOWS valid local-day intervals. */
export function parsePrayerQuietWindows(rawJson: string | null | undefined): PrayerQuietWindow[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidPrayerQuietWindow)
      .slice(0, MAX_PRAYER_QUIET_WINDOWS)
      .map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute }));
  } catch {
    return [];
  }
}

/** Normalizes a stored D1 row (or null/undefined) into a clean NotificationQuietHours value. */
export function normaliseNotificationQuietHours(row: {
  enabled?: number | boolean | null;
  timezone?: string | null;
  start_minute?: number | null;
  end_minute?: number | null;
  prayer_quiet_enabled?: number | boolean | null;
  prayer_windows_json?: string | null;
  prayer_windows_updated_at?: number | null;
} | null | undefined): NotificationQuietHours {
  if (!row) return defaultNotificationQuietHours();
  const timezone = isValidIanaTimeZone(row.timezone) ? row.timezone.trim() : DEFAULT_QUIET_HOURS_TIMEZONE;
  const startMinute = isMinuteOfDay(row.start_minute) ? row.start_minute : DEFAULT_QUIET_START_MINUTE;
  const endMinute = isMinuteOfDay(row.end_minute) ? row.end_minute : DEFAULT_QUIET_END_MINUTE;
  const prayerWindowsUpdatedAt =
    typeof row.prayer_windows_updated_at === 'number' &&
    Number.isFinite(row.prayer_windows_updated_at) &&
    row.prayer_windows_updated_at > 0
      ? Math.trunc(row.prayer_windows_updated_at)
      : null;
  return {
    enabled: row.enabled === 1 || row.enabled === true,
    timezone,
    startMinute,
    endMinute,
    prayerQuietEnabled: row.prayer_quiet_enabled === 1 || row.prayer_quiet_enabled === true,
    prayerWindows: parsePrayerQuietWindows(row.prayer_windows_json),
    prayerWindowsUpdatedAt,
  };
}

/** True when `minute` (0..1439) falls inside `[startMinute, endMinute)` on the 24-hour clock. */
export function isMinuteInWindow(minute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) return minute >= startMinute && minute < endMinute;
  return minute >= startMinute || minute < endMinute;
}

const tzFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getTzHourMinuteFormatter(timezone: string): Intl.DateTimeFormat {
  const safeTz = isValidIanaTimeZone(timezone) ? timezone.trim() : DEFAULT_QUIET_HOURS_TIMEZONE;
  let fmt = tzFormatterCache.get(safeTz);
  if (!fmt) {
    if (tzFormatterCache.size > 256) tzFormatterCache.clear();
    // locale-format: machine
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: safeTz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    tzFormatterCache.set(safeTz, fmt);
  }
  return fmt;
}

/** Local minute of day (0..1439) at `nowMs` in `timezone` (falls back to UTC on invalid zone). */
export function localMinuteOfDay(timezone: string, nowMs = Date.now()): number {
  const parts = getTzHourMinuteFormatter(timezone).formatToParts(new Date(nowMs));
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
  }
  // Some older ICU builds emit "24" at midnight even with h23
  const normalizedHour = Number.isFinite(hour) ? hour % 24 : 0;
  const normalizedMinute = Number.isFinite(minute) ? minute : 0;
  return normalizedHour * 60 + normalizedMinute;
}

/**
 * Whether `nowMs` falls within the user's daily quiet window or any active prayer quiet window.
 * Short-circuits in O(1) without formatting when both toggles are off.
 */
export function isInQuietWindow(quietHours: NotificationQuietHours | null | undefined, nowMs = Date.now()): boolean {
  if (!quietHours) return false;
  const checkDaily = quietHours.enabled && quietHours.startMinute !== quietHours.endMinute;
  const prayerFresh =
    quietHours.prayerWindowsUpdatedAt != null &&
    nowMs - quietHours.prayerWindowsUpdatedAt <= PRAYER_WINDOWS_MAX_AGE_MS;
  const checkPrayer = quietHours.prayerQuietEnabled && quietHours.prayerWindows.length > 0 && prayerFresh;
  if (!checkDaily && !checkPrayer) return false;

  const minute = localMinuteOfDay(quietHours.timezone, nowMs);
  if (checkDaily && isMinuteInWindow(minute, quietHours.startMinute, quietHours.endMinute)) {
    return true;
  }
  if (checkPrayer) {
    for (const w of quietHours.prayerWindows) {
      if (isMinuteInWindow(minute, w.startMinute, w.endMinute)) return true;
    }
  }
  return false;
}
