/**
 * Notification quiet hours & prayer-time quiet windows (Epic 22, E22-D6):
 * IANA timezone validation, overnight wrap-around, prayer windows, and DST boundaries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  MAX_PRAYER_QUIET_WINDOWS,
  PRAYER_WINDOWS_MAX_AGE_MS,
  defaultNotificationQuietHours,
  isInQuietWindow,
  isMinuteInWindow,
  isMinuteOfDay,
  isValidIanaTimeZone,
  isValidPrayerQuietWindow,
  localMinuteOfDay,
  normaliseNotificationQuietHours,
  parsePrayerQuietWindows,
} from '../src/notification-quiet-hours.ts';

test('defaults start disabled with 22:00–06:00 UTC and empty prayer windows', () => {
  const d = defaultNotificationQuietHours();
  assert.deepEqual(d, DEFAULT_NOTIFICATION_QUIET_HOURS);
  assert.equal(d.enabled, false);
  assert.equal(d.startMinute, 1320);
  assert.equal(d.endMinute, 360);
  assert.equal(d.prayerQuietEnabled, false);
  assert.deepEqual(d.prayerWindows, []);
  assert.equal(d.prayerWindowsUpdatedAt, null);
  assert.equal(isInQuietWindow(d, Date.UTC(2026, 10, 23, 23, 30)), false);
});

test('validates IANA timezones, minutes of day, and prayer windows', () => {
  assert.equal(isValidIanaTimeZone('UTC'), true);
  assert.equal(isValidIanaTimeZone('Asia/Riyadh'), true);
  assert.equal(isValidIanaTimeZone('America/New_York'), true);
  assert.equal(isValidIanaTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidIanaTimeZone(''), false);
  assert.equal(isValidIanaTimeZone(null), false);

  assert.equal(isMinuteOfDay(0), true);
  assert.equal(isMinuteOfDay(1439), true);
  assert.equal(isMinuteOfDay(-1), false);
  assert.equal(isMinuteOfDay(1440), false);
  assert.equal(isMinuteOfDay(12.5), false);

  assert.equal(isValidPrayerQuietWindow({ startMinute: 300, endMinute: 330 }), true);
  assert.equal(isValidPrayerQuietWindow({ startMinute: 300, endMinute: 300 }), false);
  assert.equal(isValidPrayerQuietWindow({ startMinute: -1, endMinute: 300 }), false);

  const parsed = parsePrayerQuietWindows(
    JSON.stringify(
      Array.from({ length: 8 }, (_, i) => ({ startMinute: i * 60, endMinute: i * 60 + 25 })),
    ),
  );
  assert.equal(parsed.length, MAX_PRAYER_QUIET_WINDOWS);
  assert.deepEqual(parsePrayerQuietWindows('not-json'), []);
});

test('isMinuteInWindow handles same-day and midnight-wrapping intervals', () => {
  // Same-day 13:00 (780) to 14:00 (840)
  assert.equal(isMinuteInWindow(779, 780, 840), false);
  assert.equal(isMinuteInWindow(780, 780, 840), true);
  assert.equal(isMinuteInWindow(839, 780, 840), true);
  assert.equal(isMinuteInWindow(840, 780, 840), false);

  // Overnight 22:00 (1320) to 07:00 (420)
  assert.equal(isMinuteInWindow(1319, 1320, 420), false);
  assert.equal(isMinuteInWindow(1320, 1320, 420), true);
  assert.equal(isMinuteInWindow(0, 1320, 420), true);
  assert.equal(isMinuteInWindow(419, 1320, 420), true);
  assert.equal(isMinuteInWindow(420, 1320, 420), false);
});

test('isInQuietWindow respects user timezone, overnight wrap, and prayer windows independently', () => {
  // Asia/Riyadh is UTC+3 year-round. 20:30 UTC = 23:30 Riyadh (inside 22:00–06:00).
  const riyadhNight = {
    enabled: true,
    timezone: 'Asia/Riyadh',
    startMinute: 22 * 60,
    endMinute: 6 * 60,
    prayerQuietEnabled: false,
    prayerWindows: [],
  };
  assert.equal(localMinuteOfDay('Asia/Riyadh', Date.UTC(2026, 10, 23, 20, 30)), 23 * 60 + 30);
  assert.equal(isInQuietWindow(riyadhNight, Date.UTC(2026, 10, 23, 20, 30)), true);
  // 04:00 UTC = 07:00 Riyadh (outside 22:00–06:00)
  assert.equal(isInQuietWindow(riyadhNight, Date.UTC(2026, 10, 24, 4, 0)), false);

  // Prayer-only quiet mode (daily window disabled, prayerQuietEnabled = true, fresh sync)
  const syncedAt = Date.UTC(2026, 10, 23, 0, 0);
  const prayerOnly = {
    enabled: false,
    timezone: 'Asia/Riyadh',
    startMinute: 22 * 60,
    endMinute: 6 * 60,
    prayerQuietEnabled: true,
    prayerWindows: [
      { startMinute: 12 * 60 + 5, endMinute: 12 * 60 + 35 }, // Dhuhr 12:05–12:35 Riyadh = 09:05–09:35 UTC
      { startMinute: 15 * 60 + 20, endMinute: 15 * 60 + 50 }, // Asr
    ],
    prayerWindowsUpdatedAt: syncedAt,
  };
  assert.equal(isInQuietWindow(prayerOnly, Date.UTC(2026, 10, 23, 9, 15)), true);
  assert.equal(isInQuietWindow(prayerOnly, Date.UTC(2026, 10, 23, 9, 40)), false);
  assert.equal(isInQuietWindow(prayerOnly, Date.UTC(2026, 10, 23, 20, 30)), false);

  // Stale prayer windows (> 7 days without refresh, or null timestamp) are ignored
  assert.equal(
    isInQuietWindow(prayerOnly, syncedAt + PRAYER_WINDOWS_MAX_AGE_MS + 1000),
    false,
  );
  assert.equal(
    isInQuietWindow({ ...prayerOnly, prayerWindowsUpdatedAt: null }, Date.UTC(2026, 10, 23, 9, 15)),
    false,
  );

  // Stored row normalization recovers cleanly from corrupt JSON or bad timezone
  const normalized = normaliseNotificationQuietHours({
    enabled: 1,
    timezone: 'Bad/Zone',
    start_minute: 1320,
    end_minute: 360,
    prayer_quiet_enabled: 1,
    prayer_windows_json: '[{"startMinute":300,"endMinute":325},{"bad":true}]',
    prayer_windows_updated_at: syncedAt,
  });
  assert.equal(normalized.timezone, 'UTC');
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.prayerQuietEnabled, true);
  assert.deepEqual(normalized.prayerWindows, [{ startMinute: 300, endMinute: 325 }]);
  assert.equal(normalized.prayerWindowsUpdatedAt, syncedAt);
});

test('isInQuietWindow tracks real DST transitions in America/New_York and Europe/London', () => {
  const nySchedule = {
    enabled: true,
    timezone: 'America/New_York',
    startMinute: 22 * 60, // 22:00 local
    endMinute: 6 * 60, // 06:00 local
    prayerQuietEnabled: false,
    prayerWindows: [],
  };

  // Before US spring-forward (2026-03-07, EST = UTC-5):
  // 10:30 UTC = 05:30 EST (inside 22:00–06:00); 11:00 UTC = 06:00 EST (outside)
  assert.equal(localMinuteOfDay('America/New_York', Date.UTC(2026, 2, 7, 10, 30)), 5 * 60 + 30);
  assert.equal(isInQuietWindow(nySchedule, Date.UTC(2026, 2, 7, 10, 30)), true);
  assert.equal(isInQuietWindow(nySchedule, Date.UTC(2026, 2, 7, 11, 0)), false);

  // US spring-forward morning (2026-03-08: 02:00 EST jumps to 03:00 EDT at 07:00 UTC, EDT = UTC-4):
  // 06:59 UTC = 01:59 EST (inside); 07:01 UTC = 03:01 EDT (still inside);
  // 10:30 UTC is now 06:30 EDT (outside 22:00–06:00, shifted 1h earlier in UTC!)
  assert.equal(localMinuteOfDay('America/New_York', Date.UTC(2026, 2, 8, 6, 59)), 1 * 60 + 59);
  assert.equal(localMinuteOfDay('America/New_York', Date.UTC(2026, 2, 8, 7, 1)), 3 * 60 + 1);
  assert.equal(isInQuietWindow(nySchedule, Date.UTC(2026, 2, 8, 6, 59)), true);
  assert.equal(isInQuietWindow(nySchedule, Date.UTC(2026, 2, 8, 7, 1)), true);
  assert.equal(isInQuietWindow(nySchedule, Date.UTC(2026, 2, 8, 9, 59)), true); // 05:59 EDT
  assert.equal(isInQuietWindow(nySchedule, Date.UTC(2026, 2, 8, 10, 30)), false); // 06:30 EDT

  // US fall-back morning (2026-11-01: 02:00 EDT falls back to 01:00 EST at 06:00 UTC):
  // 10:30 UTC is back to 05:30 EST (inside 22:00–06:00)
  assert.equal(localMinuteOfDay('America/New_York', Date.UTC(2026, 10, 1, 10, 30)), 5 * 60 + 30);
  assert.equal(isInQuietWindow(nySchedule, Date.UTC(2026, 10, 1, 10, 30)), true);
  assert.equal(isInQuietWindow(nySchedule, Date.UTC(2026, 10, 1, 11, 0)), false);

  // UK BST transition (Europe/London: GMT UTC+0 -> BST UTC+1 on 2026-03-29 at 01:00 UTC):
  const londonSchedule = {
    enabled: true,
    timezone: 'Europe/London',
    startMinute: 22 * 60,
    endMinute: 6 * 60,
    prayerQuietEnabled: false,
    prayerWindows: [],
  };
  assert.equal(isInQuietWindow(londonSchedule, Date.UTC(2026, 2, 28, 5, 30)), true); // 05:30 GMT
  assert.equal(isInQuietWindow(londonSchedule, Date.UTC(2026, 2, 29, 5, 30)), false); // 06:30 BST
  assert.equal(isInQuietWindow(londonSchedule, Date.UTC(2026, 2, 29, 21, 30)), true); // 22:30 BST
  // UK autumn return to GMT (2026-10-25): 21:30 UTC is 21:30 GMT (outside 22:00–06:00)
  assert.equal(isInQuietWindow(londonSchedule, Date.UTC(2026, 9, 25, 21, 30)), false);
});
