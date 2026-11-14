/**
 * Pure editing helpers for the Review alerts screen (rota, owners, escalation minutes).
 * The server validates again (shared-types validateReviewAlertSettings).
 */
import type { ReviewAlertSettings, ReviewRotaEntry, ReviewRotaShift } from '@al-ummah/shared-types';

export const DEFAULT_SHIFT: ReviewRotaShift = { days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00' };

/** The browser's zone for a new reviewer (they usually add themselves), UTC otherwise. */
export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every IANA zone the runtime knows, with the current one first when it is missing. */
export function timeZones(current?: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (!zones.includes('UTC')) zones = ['UTC', ...zones];
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

export const toMinutes = (seconds: number) => Math.round((seconds / 60) * 10) / 10;
export const toSeconds = (minutes: number) => Math.round(minutes * 60);

export function addReviewer(settings: ReviewAlertSettings, userId: string, timeZone = defaultTimeZone()): ReviewAlertSettings {
  if (!userId || settings.rota.some((e) => e.userId === userId)) return settings;
  return { ...settings, rota: [...settings.rota, { userId, senior: false, timeZone, shifts: [{ ...DEFAULT_SHIFT, days: [...DEFAULT_SHIFT.days] }] }] };
}

export function updateReviewer(settings: ReviewAlertSettings, userId: string, patch: Partial<ReviewRotaEntry>): ReviewAlertSettings {
  return { ...settings, rota: settings.rota.map((e) => (e.userId === userId ? { ...e, ...patch } : e)) };
}

export function removeReviewer(settings: ReviewAlertSettings, userId: string): ReviewAlertSettings {
  return { ...settings, rota: settings.rota.filter((e) => e.userId !== userId) };
}

export function addOwner(settings: ReviewAlertSettings, userId: string): ReviewAlertSettings {
  return !userId || settings.owners.includes(userId) ? settings : { ...settings, owners: [...settings.owners, userId] };
}

export function removeOwner(settings: ReviewAlertSettings, userId: string): ReviewAlertSettings {
  return { ...settings, owners: settings.owners.filter((o) => o !== userId) };
}

export function toggleDay(shift: ReviewRotaShift, day: number): ReviewRotaShift {
  const days = shift.days.includes(day) ? shift.days.filter((d) => d !== day) : [...shift.days, day].sort();
  return { ...shift, days };
}

/** "22:00 → 06:00": the shift ends the next day. */
export const crossesMidnight = (shift: ReviewRotaShift) => shift.end !== '24:00' && shift.end <= shift.start;

/** What the form can save: both steps set, the second after the first, every shift with a day. */
export function canSave(settings: ReviewAlertSettings): boolean {
  return (
    settings.escalateAllAfterSeconds >= 30 &&
    settings.escalateSeniorsAfterSeconds > settings.escalateAllAfterSeconds &&
    settings.rota.every((e) => e.shifts.every((s) => s.days.length > 0 && s.start !== s.end))
  );
}

/** Seconds under a minute ("45 s"), minutes and seconds from there ("1:50"), for the timings table. */
export function formatSeconds(value: number | null, units: { s: (n: number) => string }): string {
  if (value === null) return '—';
  if (value < 60) return units.s(value);
  const m = Math.floor(value / 60);
  const s = value % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m}:00`;
}
