/** Event Calendar on the local stack. The spec owns its channel and scheduled stream. */
import { expect } from '@playwright/test';
import { ns, onLocalStack, test } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled } from './web-session';

test.use({ trace: 'off', video: 'off' });
test.describe.configure({ mode: 'serial' });

const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
const SWITCH_LANDS = { timeout: 60_000, intervals: [1_000, 2_000, 5_000] };

async function searchSql(statement: string): Promise<void> {
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: statement });
  expect(res.ok, `stack search D1 SQL: ${await res.text()}`).toBe(true);
}

async function setSwitch(key: 'eventCalendar' | 'liveEvents', on: boolean): Promise<void> {
  const at = new Date().toISOString();
  await searchSql(
    `INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES ('${key}', ${on ? 1 : 0}, 1, 'e2e-e22', '${at}')
     ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled, version = feature_switches.version + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  );
}

test.describe('Release: online Event Calendar (E22-S6)', () => {
  test.beforeAll(() => {
    test.skip(!onLocalStack(), 'Toggles site-wide eventCalendar switch via local stack SQL');
  });

  test('hidden when off, shows Gregorian + Hijri calendar and .ics feed when on (en and ar)', async ({ page, ownData }) => {
    test.setTimeout(180_000);
    await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    const tag = ns();
    const viewer = await ownData.createUser(page, `e22-events-${tag}`);
    await ownData.grantCreator(viewer);
    const channelId = await ownData.createChannel(viewer);
    const streamId = `e22-halqa-${tag}`;
    const streamTitle = `Tafsir halqa ${tag}`;
    const streamUrl = `${CONTROL}/__stack/r2/videos/${encodeURIComponent(`livestream:${streamId}`)}`;
    const now = Date.now();
    const startsAt = now + 2 * 60 * 60 * 1_000;
    const card = page.getByTestId('event-card').filter({ hasText: streamTitle });

    try {
      await setSwitch('eventCalendar', false);
      await expect
        .poll(
          async () => ((await (await apiFetch(viewer, '/api/me/features')).json()) as { features?: { eventCalendar?: boolean } }).features?.eventCalendar,
          SWITCH_LANDS,
        )
        .toBe(false);

      const apiOff = await apiFetch(viewer, '/api/events');
      expect(apiOff.status).toBe(404);
      expect(await apiOff.json()).toMatchObject({ success: false, code: 'feature_off', feature: 'eventCalendar' });

      const webOffEn = await page.goto(`${target().web}/en/events`);
      expect(webOffEn?.status()).toBe(404);
      const webOffAr = await page.goto(`${target().web}/ar/events`);
      expect(webOffAr?.status()).toBe(404);
      await gotoSettled(page, `${target().web}/en/help/watching`);
      await expect(page.locator('#event-calendar')).toHaveCount(0);
      await gotoSettled(page, `${target().web}/en`);
      await expect(page.getByTestId('nav-events')).toHaveCount(0);

      const seeded = await fetch(streamUrl, {
        method: 'PUT',
        body: JSON.stringify({
          id: streamId,
          channelId,
          userId: viewer.userId,
          kind: 'live',
          title: streamTitle,
          status: 'scheduled',
          eventType: 'halqa',
          scheduledStartTime: new Date(startsAt).toISOString(),
        }),
      });
      expect(seeded.ok, await seeded.text()).toBe(true);
      await searchSql(
        `INSERT INTO live_stream_metadata
           (stream_id, channel_id, owner_id, kind, event_type, status, visibility, scheduled_start_at, created_at, updated_at)
         VALUES ('${streamId}', '${channelId}', '${viewer.userId}', 'live', 'halqa', 'scheduled', 'public', ${startsAt}, ${now}, ${now})`,
      );
      await setSwitch('liveEvents', true);
      await setSwitch('eventCalendar', true);
      await expect
        .poll(
          async () => ((await (await apiFetch(viewer, '/api/me/features')).json()) as { features?: { eventCalendar?: boolean } }).features?.eventCalendar,
          SWITCH_LANDS,
        )
        .toBe(true);

      const webOnEn = await page.goto(`${target().web}/en/events`);
      expect(webOnEn?.status()).toBe(200);
      await expect(page.getByTestId('events-page')).toBeVisible();
      await expect(page.getByTestId('events-ics-link')).toHaveAttribute('href', /\/api\/events\.ics\?lang=en$/);
      await expect(card.getByTestId('event-date-hijri')).toContainText('AH');
      await expect(card.getByTestId('event-watch-link')).toHaveAttribute('href', `/en/live/${streamId}`);
      await page.getByTestId('events-filter-halqa').click();
      await expect(card.getByTestId('event-type-badge')).toHaveText('Halqas');

      const webOnAr = await page.goto(`${target().web}/ar/events`);
      expect(webOnAr?.status()).toBe(200);
      await expect(page.getByTestId('events-page')).toBeVisible();

      await expect(page.getByTestId('events-page')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('events-ics-link')).toHaveAttribute('href', /\/api\/events\.ics\?lang=ar$/);
      for (const part of ['event-date-gregorian', 'event-date-hijri', 'event-time']) {
        const text = await card.getByTestId(part).innerText();
        expect(text).toMatch(/[٠-٩]/);
        expect(text).not.toMatch(/[0-9]/);
      }
      await expect(card.getByTestId('event-schedule-line')).toContainText('،');

      const icsRes = await fetch(`${target().api}/api/events.ics?lang=ar`);
      expect(icsRes.status).toBe(200);
      expect(icsRes.headers.get('content-type')).toContain('text/calendar');
      const ics = (await icsRes.text()).replace(/\r\n /g, '');
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain(`UID:live-${streamId}@alummahnow.net`);

      await gotoSettled(page, `${target().web}/en/channels/${channelId}`);
      const schedule = page.getByTestId('channel-upcoming-events');
      await expect(schedule.getByTestId('channel-upcoming-event-card').filter({ hasText: streamTitle })).toBeVisible();
      await expect(schedule.getByTestId('channel-events-ics')).toHaveAttribute('href', `${target().api}/api/channels/${channelId}/events.ics?lang=en`);
    } finally {
      await Promise.all([
        fetch(streamUrl, { method: 'DELETE' }).then(async (removed) => {
          expect(removed.ok, await removed.text()).toBe(true);
        }),
        searchSql(`DELETE FROM live_stream_metadata WHERE stream_id = '${streamId}'`),
        setSwitch('eventCalendar', false),
        setSwitch('liveEvents', false),
      ]);
    }
  });
});
