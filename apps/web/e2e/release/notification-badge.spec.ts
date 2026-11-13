/**
 * Notification badge vs read state (owner request 2026-11-13: "Clear the notification badge when
 * the menu is opened; make this admin-configurable: mark as read by button click, or by opening
 * the notification menu").
 *
 * For each language a new signed-in user gets three stored notifications (written straight to the
 * stack's notifications D1, ids carrying the run namespace, deleted afterwards) and opens the site
 * in two tabs of one session:
 *  - mode `seen` (the default): opening the menu in tab 1 clears its badge and, through the
 *    realtime socket, tab 2's; the notifications stay unread (list and API) until "Mark all as read";
 *  - mode `read` (switched through api-videos' internal settings route, restored afterwards): new
 *    notifications bring the badge back, and opening the menu marks the shown ones read.
 * Local stack only: the mode is global, so the tests run in series and leave it on `seen`.
 */
import { expect, type Page } from '@playwright/test';
import { test, ns, onLocalStack } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled, type Locale, type WebUser } from './web-session';

// Signs users up through the auth server: traces would hold the password and code
test.use({ trace: 'off', video: 'off' });
test.describe.configure({ mode: 'serial' });

const LOCAL_CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
const INTERNAL_KEY = process.env.LOCAL_STACK_INTERNAL_API_KEY || 'local-stack-internal-key';
const LOCALES: Locale[] = ['en', 'ar'];
const BELL_NEW: Record<Locale, RegExp> = { en: /^Notifications, \S+ new$/, ar: /^الإشعارات، \S+ جديدة$/ };

const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function d1(sql: string): Promise<void> {
  const res = await fetch(`${LOCAL_CONTROL}/__stack/d1/al-ummah-now-notifications`, { method: 'POST', body: sql });
  expect(res.ok, `stack D1 write: ${await res.text()}`).toBe(true);
}

/** Stored notifications for the user, newest last, created `at` (ms). */
async function seed(user: WebUser, ids: string[], at: number): Promise<void> {
  const rows = ids.map(
    (id, i) =>
      `(${sqlText(id)}, ${sqlText(user.userId)}, 'comments', 'comment', 'newComment', ${sqlText(JSON.stringify({ videoTitle: `Badge ${ns()} ${i}` }))}, ${at + i})`,
  );
  await d1(`INSERT INTO notifications (id, user_id, category, notification_type, notification_key, params_json, created_at) VALUES ${rows.join(', ')}`);
}

async function setMenuOpen(mode: 'seen' | 'read'): Promise<void> {
  const res = await fetch(`${target().api}/internal/notifications/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_KEY },
    body: JSON.stringify({ menuOpen: mode, actorId: 'e2e-notification-badge' }),
  });
  expect(res.ok, `PUT /internal/notifications/settings: ${await res.text()}`).toBe(true);
}

async function counts(user: WebUser) {
  const res = await apiFetch(user, '/api/notifications/unread-count');
  expect(res.ok).toBe(true);
  return ((await res.json()) as { result: { unreadCount: number; unseenCount: number; menuOpen: string } }).result;
}

const badge = (page: Page) => page.getByTestId('notification-badge');

test.describe('notification badge clears when the menu opens', () => {
  for (const locale of LOCALES) {
    test(`seen and read modes, two tabs (${locale})`, async ({ page, context, ownData }) => {
      test.skip(!onLocalStack(), 'Writes the notifications D1 and the global menu mode: local stack only');
      test.setTimeout(180000);
      await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
      const user = await ownData.createUser(page, `notif-badge-${locale}`, locale);
      const tag = `e2e-${ns()}-${locale}`.replace(/[^A-Za-z0-9_-]/g, '-');
      const first = [1, 2, 3].map((i) => `${tag}-a${i}`);
      const second = [1, 2].map((i) => `${tag}-b${i}`);
      ownData.onCleanup(`notifications of ${tag}`, async () => {
        await d1(`DELETE FROM notifications WHERE id LIKE ${sqlText(`${tag}-%`)}`);
        await d1(`DELETE FROM notification_seen WHERE user_id = ${sqlText(user.userId)}`);
      });
      ownData.onCleanup('menu mode back to seen', () => setMenuOpen('seen'));
      await setMenuOpen('seen');
      await seed(user, first, Date.now() - 60_000);

      // Two tabs of one session
      const other = await context.newPage();
      await gotoSettled(page, `${target().web}/${locale}`);
      await gotoSettled(other, `${target().web}/${locale}`);
      for (const p of [page, other]) await expect(badge(p)).toHaveText(/^[3٣]$/);
      await expect(page.getByTestId('notification-bell')).toHaveAttribute('aria-label', BELL_NEW[locale]);

      // Tab 2 is listening once a read-state change from elsewhere reaches it
      await expect(async () => {
        await apiFetch(user, '/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [first[0]] }) });
        await expect(badge(other)).toHaveText(/^[2٢]$/, { timeout: 3000 });
      }).toPass({ timeout: 45000 });
      await apiFetch(user, '/api/notifications/unread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [first[0]] }) });
      await expect(badge(other)).toHaveText(/^[3٣]$/);

      // Mode seen: opening clears both badges, everything stays unread
      await page.getByTestId('notification-bell').click();
      const dropdown = page.getByTestId('notification-dropdown');
      await expect(dropdown).toBeVisible();
      await expect(badge(page)).toHaveCount(0);
      await expect(badge(other)).toHaveCount(0);
      for (const id of first) await expect(dropdown.locator(`[data-notification-id="${id}"]`)).toHaveAttribute('data-read', 'false');
      await expect.poll(() => counts(user)).toMatchObject({ unreadCount: 3, unseenCount: 0, menuOpen: 'seen' });
      await page.keyboard.press('Escape');
      // Still cleared after a reload: stored on the server
      await gotoSettled(page, `${target().web}/${locale}`);
      await expect(page.getByTestId('notification-bell')).toBeVisible();
      await expect(badge(page)).toHaveCount(0);

      // Only the button marks them read
      await page.getByTestId('notification-bell').click();
      await page.getByTestId('notification-mark-all-read').click();
      for (const id of first) await expect(dropdown.locator(`[data-notification-id="${id}"]`)).toHaveAttribute('data-read', 'true');
      await expect.poll(() => counts(user)).toMatchObject({ unreadCount: 0, unseenCount: 0 });
      await page.keyboard.press('Escape');

      // Mode read: new notifications bring the badge back; opening marks the shown ones read
      await setMenuOpen('read');
      await seed(user, second, Date.now() + 1000);
      await gotoSettled(page, `${target().web}/${locale}`);
      await expect(badge(page)).toHaveText(/^[2٢]$/);
      await page.getByTestId('notification-bell').click();
      await expect(badge(page)).toHaveCount(0);
      for (const id of second) await expect(dropdown.locator(`[data-notification-id="${id}"]`)).toHaveAttribute('data-read', 'true');
      await expect.poll(() => counts(user)).toMatchObject({ unreadCount: 0, unseenCount: 0, menuOpen: 'read' });
      await expect(badge(other)).toHaveCount(0);

      // Per-row control: mark one unread again (it stays off the badge)
      const row = dropdown.locator(`[data-notification-id="${second[1]}"]`);
      await row.getByTestId('notification-mark-unread').click();
      await expect(row).toHaveAttribute('data-read', 'false');
      await expect.poll(() => counts(user)).toMatchObject({ unreadCount: 1, unseenCount: 0 });
      await setMenuOpen('seen');
      await other.close();
    });
  }
});
