/**
 * Unified Event Calendar contracts & RFC 5545 (.ics) builder tests (Epic 22, E22-D7).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventsIcsFeed,
  foldIcsLine,
  isEventCalendarKind,
  isEventCalendarType,
  type CalendarEventItem,
} from '../src/events-calendar.ts';

test('event calendar type and kind guards match Epic 17 live metadata values', () => {
  assert.equal(isEventCalendarType('jumuah'), true);
  assert.equal(isEventCalendarType('taraweeh'), true);
  assert.equal(isEventCalendarType('conference'), true);
  assert.equal(isEventCalendarType('halqa'), true);
  assert.equal(isEventCalendarType('concert'), false);

  assert.equal(isEventCalendarKind('live'), true);
  assert.equal(isEventCalendarKind('premiere'), true);
  assert.equal(isEventCalendarKind('vod'), false);
});

test('foldIcsLine folds lines above 75 UTF-8 octets without splitting Arabic code points', () => {
  const arabicSummary = 'SUMMARY:' + 'حلقة علم أسبوعية في تفسير القرآن الكريم مع الشيخ عبد الله بن محمد الأنصاري';
  const folded = foldIcsLine(arabicSummary);
  const encoder = new TextEncoder();
  for (const physicalLine of folded.split('\r\n')) {
    assert.ok(encoder.encode(physicalLine).byteLength <= 75, `line exceeded 75 bytes: ${physicalLine}`);
    assert.ok(!physicalLine.includes('\uFFFD'), 'never corrupts UTF-8 code points');
  }
  // Unfolding restores the exact original string
  assert.equal(folded.replace(/\r\n /g, ''), arabicSummary);
});

test('buildEventsIcsFeed emits CRLF RFC 5545 VCALENDAR with VEVENT and 15m VALARM', () => {
  const items: CalendarEventItem[] = [
    {
      streamId: 'ls-1',
      channelId: 'ch-1',
      channelName: 'Al-Noor Academy, Online',
      title: 'Weekly Tafsir; Surah Al-Kahf',
      description: 'Bring your notes,\nquestions welcome.',
      kind: 'live',
      eventType: 'halqa',
      status: 'scheduled',
      scheduledStartAt: '2026-11-27T18:00:00.000Z',
      startedAt: null,
      endedAt: null,
      premiereVideoId: null,
      reminderCount: 12,
      viewerReminded: false,
      watchPath: '/live/ls-1',
    },
  ];
  const ics = buildEventsIcsFeed(items, {
    calendarName: 'Al-Noor Schedule',
    siteOrigin: 'https://videos.alummahnow.net/',
    now: '2026-11-23T12:00:00.000Z',
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /UID:live-ls-1@alummahnow\.net\r\n/);
  assert.match(unfolded, /DTSTART:20261127T180000Z\r\n/);
  assert.match(unfolded, /DTEND:20261127T190000Z\r\n/);
  assert.match(unfolded, /SUMMARY:Weekly Tafsir\\; Surah Al-Kahf — Al-Noor Academy\\, Online\r\n/);
  assert.match(unfolded, /TRIGGER:-PT15M\r\n/);
  assert.match(unfolded, /URL:https:\/\/videos\.alummahnow\.net\/live\/ls-1\r\n/);
});

test('buildEventsIcsFeed strips bare CR/control chars, keeps URL unescaped, and localizes Arabic feeds', () => {
  const items: CalendarEventItem[] = [
    {
      streamId: 'ls-ar',
      channelId: 'ch-1',
      channelName: 'Al-Noor Academy',
      channelNameAr: 'أكاديمية النور',
      title: 'حلقة التفسير',
      description: 'السطر الأول\rINJECTED:BAD\x00\x07\r\nالسطر الثاني',
      kind: 'live',
      eventType: 'halqa',
      status: 'scheduled',
      scheduledStartAt: '2026-11-28T18:00:00.000Z',
      startedAt: null,
      endedAt: null,
      premiereVideoId: null,
      reminderCount: 4,
      viewerReminded: false,
      watchPath: '/live/ls-ar?ref=a,b;c',
    },
  ];
  const ics = buildEventsIcsFeed(items, {
    locale: 'ar',
    siteOrigin: 'https://videos.alummahnow.net',
    now: '2026-11-23T12:00:00.000Z',
  });
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /PRODID:-\/\/Al Ummah Now\/\/Event Calendar\/\/AR\r\n/);
  assert.match(unfolded, /X-WR-CALNAME:الأمة الآن — الفعاليات القادمة\r\n/);
  assert.match(unfolded, /SUMMARY:حلقة التفسير — أكاديمية النور\r\n/);
  assert.match(unfolded, /شاهد عبر الإنترنت:/);
  // Bare \r must never become a raw line break or property separator
  assert.doesNotMatch(unfolded, /\r(?!\n)/);
  assert.doesNotMatch(unfolded, /\r\nINJECTED:/);
  assert.doesNotMatch(unfolded, /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  // URI value type is not backslash-escaped on , or ;
  assert.match(unfolded, /URL:https:\/\/videos\.alummahnow\.net\/live\/ls-ar\?ref=a,b;c\r\n/);
});
