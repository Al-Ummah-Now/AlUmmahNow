/**
 * Unified online Event Calendar contracts & RFC 5545 (.ics) feed builder (Epic 22, E22-D7).
 *
 * Uses the single upcoming-event model shared with Epic 17 (`live_stream_metadata` + `livestream:<id>`
 * + `live_reminders`), covering scheduled live streams, premieres, and classes (`jumuah`, `taraweeh`,
 * `conference`, `halqa`). Online events only; zero physical venues.
 */

import {
  isLiveEventType,
  isLiveStreamKind,
  LIVE_EVENT_TYPES,
  LIVE_STREAM_KINDS,
  LIVE_STREAM_STATUSES,
  type LiveEventType,
  type LiveStreamKind,
  type LiveStreamStatus,
} from './live-apps.ts';

export const EVENT_CALENDAR_TYPES = LIVE_EVENT_TYPES;
export type EventCalendarType = LiveEventType;
export const isEventCalendarType = isLiveEventType;

export const EVENT_CALENDAR_KINDS = LIVE_STREAM_KINDS;
export type EventCalendarKind = LiveStreamKind;
export const isEventCalendarKind = isLiveStreamKind;

export const EVENT_CALENDAR_STATUSES = LIVE_STREAM_STATUSES;
export type EventCalendarStatus = LiveStreamStatus;

export interface CalendarEventItem {
  streamId: string;
  channelId: string;
  channelName: string;
  channelNameAr?: string | null;
  channelHandle?: string | null;
  channelAvatarUrl?: string | null;
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  kind: EventCalendarKind;
  eventType: EventCalendarType | null;
  status: EventCalendarStatus;
  scheduledStartAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  premiereVideoId: string | null;
  reminderCount: number;
  viewerReminded: boolean;
  watchPath: string;
}

export interface EventCalendarListResponse {
  success: boolean;
  result: {
    items: CalendarEventItem[];
    nextCursor: string | null;
  };
}

function escapeIcsValue(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function sanitizeIcsUri(uri: string): string {
  return uri.replace(/[\x00-\x20\x7F]+/g, '');
}

function toIcsUtc(isoOrMs: string | number): string | null {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * RFC 5545 §3.1: content lines longer than 75 UTF-8 octets are folded with CRLF + single SPACE
 * without splitting multi-byte UTF-8 code points (such as Arabic letters).
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).byteLength <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).byteLength;
    if (currentBytes + chBytes > limit && current.length > 0) {
      parts.push(current);
      current = ` ${ch}`;
      currentBytes = 1 + chBytes;
      limit = 75;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts.join('\r\n');
}

export interface BuildEventsIcsOptions {
  calendarName?: string;
  locale?: 'en' | 'ar';
  siteOrigin?: string;
  now?: string | number;
  defaultDurationMinutes?: number;
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

/**
 * Builds an RFC 5545 VCALENDAR feed with one VEVENT (and 15-minute VALARM) per scheduled/live event.
 */
export function buildEventsIcsFeed(
  events: readonly CalendarEventItem[],
  options: BuildEventsIcsOptions = {},
): string {
  const locale = options.locale === 'ar' ? 'ar' : 'en';
  const siteOrigin = stripTrailingSlashes((options.siteOrigin ?? 'https://videos.alummahnow.net').trim());
  const defaultCalName = locale === 'ar' ? 'الأمة الآن — الفعاليات القادمة' : 'Al Ummah Now — Upcoming Events';
  const calName = options.calendarName?.trim() || defaultCalName;
  const dtStamp = toIcsUtc(options.now ?? Date.now()) ?? '20260101T000000Z';
  const defaultDurationMs = Math.max(15, options.defaultDurationMinutes ?? 60) * 60_000;

  const rawLines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Al Ummah Now//Event Calendar//${locale === 'ar' ? 'AR' : 'EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsValue(calName)}`,
  ];

  for (const ev of events) {
    const startRef = ev.scheduledStartAt ?? ev.startedAt;
    if (!startRef) continue;
    const startMs = new Date(startRef).getTime();
    if (Number.isNaN(startMs)) continue;
    const endMs = ev.endedAt && !Number.isNaN(new Date(ev.endedAt).getTime()) && new Date(ev.endedAt).getTime() > startMs
      ? new Date(ev.endedAt).getTime()
      : startMs + defaultDurationMs;
    const dtStart = toIcsUtc(startMs);
    const dtEnd = toIcsUtc(endMs);
    if (!dtStart || !dtEnd) continue;

    const url = sanitizeIcsUri(`${siteOrigin}${ev.watchPath.startsWith('/') ? ev.watchPath : `/${ev.watchPath}`}`);
    const channelLabel = locale === 'ar' && ev.channelNameAr ? ev.channelNameAr : ev.channelName;
    const summary = channelLabel ? `${ev.title} — ${channelLabel}` : ev.title;
    const watchLine = locale === 'ar' ? `شاهد عبر الإنترنت: ${url}` : `Watch online: ${url}`;
    const descParts = [ev.description?.trim(), watchLine].filter(Boolean);

    rawLines.push(
      'BEGIN:VEVENT',
      `UID:live-${ev.streamId}@alummahnow.net`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${escapeIcsValue(summary)}`,
      `DESCRIPTION:${escapeIcsValue(descParts.join('\n\n'))}`,
      `URL:${url}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsValue(ev.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  rawLines.push('END:VCALENDAR');
  return `${rawLines.map(foldIcsLine).join('\r\n')}\r\n`;
}
