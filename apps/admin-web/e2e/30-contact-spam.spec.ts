/**
 * Contact message "Mark as spam" (owner bug 2026-11-19: clicking it made every
 * button on the page flicker and the message stayed as it was).
 *
 * Then (owner): "its marked as spam now but button stil normal": the change was
 * saved but the page never showed it. The spam button alone shows it is
 * working (the other buttons stay usable); once saved the button, status chip
 * and card show spam at once (asserted with the page's refreshes dropped), with
 * an Undo toast; Undo puts it back; the list row and the Spam view follow; and
 * a failed change says so on the page instead of doing nothing.
 *
 * Data: one open message of this run in the reports DB, written through the
 * stack's control API and removed afterwards, pass or fail.
 */
import crypto from 'node:crypto';
import type { Page, Request, Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { E2E_ENTITY_PREFIX, LOCAL_STACK } from './support/env';
import { stackSql } from './support/local-stack';
import { pickOption, setPreferences } from './support/ui';

const REPORTS = 'al-ummah-now-reports';
const hex = crypto.randomBytes(6).toString('hex');
const messageId = `${E2E_ENTITY_PREFIX}spam-${hex}`;
const detail = `/contact/${encodeURIComponent(messageId)}`;

/** Server actions are POSTs to the page with a Next-Action header. */
const isServerAction = (route: Route) => route.request().method() === 'POST' && !!route.request().headers()['next-action'];

/**
 * Holds the next server action of the page (the change) for a moment, so the pending state can be
 * seen. Only that one: the nav badge also reads counts through server actions, and Next runs them
 * one at a time.
 */
async function slowNextAction(page: Page, ms: number) {
  let held = false;
  await page.route(`**${detail}`, async (route) => {
    if (held || !isServerAction(route)) return route.fallback();
    held = true;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return route.continue().catch(() => undefined);
  });
}

/**
 * Production saved the change but the page never showed it (owner 2026-11-19: "its marked as spam
 * now but button stil normal"): the page must show a saved change without the refresh that
 * follows. This holds the page's RSC refreshes for longer than the "at once" checks wait
 * (aborting one makes Next reload the whole page, which would hide the bug).
 */
const REFRESH_HOLD_MS = 8_000;
const AT_ONCE = { timeout: 4_000 };
async function holdRefreshes(page: Page) {
  await page.route('**/*', async (route) => {
    const r = route.request();
    if (r.method() !== 'GET' || r.headers()['rsc'] !== '1' || !new URL(r.url()).searchParams.has('_rsc')) return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, REFRESH_HOLD_MS));
    return route.continue().catch(() => undefined);
  });
}

/**
 * Waits until no RSC request (navigation or refresh) of the page is in flight. A page.goto that
 * cancels a background refresh makes Next fall back to a full load of the URL it was refreshing,
 * which then interrupts the goto (WebKit).
 */
function trackRsc(page: Page): () => Promise<void> {
  const inFlight = new Set<unknown>();
  const isRsc = (r: Request) => r.headers()['rsc'] === '1';
  page.on('request', (r) => isRsc(r) && inFlight.add(r));
  page.on('requestfinished', (r) => inFlight.delete(r));
  page.on('requestfailed', (r) => inFlight.delete(r));
  return async () => {
    await expect.poll(() => inFlight.size, { timeout: 20_000 }).toBe(0);
  };
}

const card = (page: Page) => page.getByTestId('contact-message');
const chip = (page: Page) => card(page).getByTestId('contact-status-chip');
const listRow = (page: Page) => page.locator(`[data-testid="contact-row"][data-message-id="${messageId}"]`);

test.describe('contact message spam', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK, 'Seeds a contact message through the local stack');
    const at = new Date(Date.now() - 5 * 60_000).toISOString();
    await stackSql(
      REPORTS,
      `INSERT INTO contact_messages (id, status, topic, name, email, message, locale, ip_hash, bot_verdict, read_at, created_at, updated_at, notify_status, ack_status)
       VALUES ('${messageId}', 'open', 'general', 'Spam Check ${hex}', 'sender-${hex}@e2e.example', 'Is there a schedule for the new lessons ${hex}?', 'en', 'h-${hex}', 'pass', '${at}', '${at}', '${at}', 'sent', 'sent')`,
    );
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK) return;
    await stackSql(REPORTS, `DELETE FROM contact_notes WHERE message_id = '${messageId}'`);
    await stackSql(REPORTS, `DELETE FROM contact_messages WHERE id = '${messageId}'`);
  });

  test('SPAM-01 only the spam button shows it is working; the message shows spam at once with Not spam and Undo, without a page refresh', async ({ page }) => {
    await page.goto(detail);
    await expect(card(page)).toHaveAttribute('data-status', 'open');
    await expect(chip(page)).toHaveAttribute('data-status', 'open');
    await slowNextAction(page, 1500);
    await holdRefreshes(page);

    const spam = page.getByTestId('contact-spam');
    await expect(spam).toHaveText('Mark as spam');
    await spam.click();
    // While it saves: this button says so, the others stay as they were (no flicker of every button)
    await expect(spam).toHaveAttribute('aria-busy', 'true');
    await expect(spam).toHaveText('Working…');
    await expect(page.getByTestId('contact-mark-unread')).toBeEnabled();
    await expect(page.getByTestId('contact-assign-me')).toBeEnabled();
    await expect(page.getByTestId('contact-delete')).toBeEnabled();

    // Saved: the page shows it at once, long before the held refresh could
    await expect(spam).toHaveText('Not spam', AT_ONCE);
    await expect(spam).not.toHaveAttribute('aria-busy', 'true', AT_ONCE);
    await expect(chip(page)).toHaveAttribute('data-status', 'spam', AT_ONCE);
    await expect(chip(page)).toHaveText('Spam', AT_ONCE);
    await expect(card(page)).toHaveAttribute('data-status', 'spam', AT_ONCE);
    await expect(page.getByTestId('contact-reply-body')).toBeDisabled(AT_ONCE);
    await expect(page.getByTestId('contact-action-error')).toHaveCount(0);
    await expect(page.getByTestId('undo-toast')).toContainText('Marked as spam', AT_ONCE);
    // Stored, too
    expect((await stackSql<{ status: string }>(REPORTS, `SELECT status FROM contact_messages WHERE id = '${messageId}'`))[0]?.status).toBe('spam');

    // Undo puts the status back on the page as soon as it is saved
    await page.getByTestId('undo-toast-undo').click();
    await expect(spam).toHaveText('Mark as spam', { timeout: REFRESH_HOLD_MS * 2 });
    await expect(chip(page)).toHaveAttribute('data-status', 'open');
    await expect(card(page)).toHaveAttribute('data-status', 'open');
    await expect.poll(async () => (await stackSql<{ status: string }>(REPORTS, `SELECT status FROM contact_messages WHERE id = '${messageId}'`))[0]?.status).toBe('open');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('SPAM-02 the list follows: spam shows on the row and in the Spam view; a bulk change moves the row at once', async ({ page }) => {
    const settled = trackRsc(page);
    await page.goto(detail);
    await page.getByTestId('contact-spam').click();
    await expect(page.getByTestId('contact-spam')).toHaveText('Not spam');
    await settled();

    // Back to the inbox in the app (client navigation): the row shows spam
    await page.getByRole('link', { name: 'Back to contact messages' }).click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(listRow(page)).toHaveAttribute('data-status', 'spam');
    await expect(listRow(page).getByTestId('contact-status-chip')).toHaveText('Spam');
    await settled();

    // In the Spam view, not in Open
    await page.goto(`/contact?status=spam&q=${hex}`);
    await expect(listRow(page)).toHaveAttribute('data-status', 'spam');
    await settled();
    await page.goto(`/contact?status=open&q=${hex}`);
    await expect(listRow(page)).toHaveCount(0);
    await settled();

    // From the Spam view, a bulk "Open" leaves the view at once, before the held refresh
    await page.goto(`/contact?status=spam&q=${hex}`);
    await expect(listRow(page)).toHaveAttribute('data-status', 'spam');
    await settled();
    await holdRefreshes(page);
    await listRow(page).getByTestId('contact-row-select').check();
    await pickOption(page.getByTestId('contact-bulk-status'), 'open');
    await page.getByTestId('contact-bulk-status-apply').click();
    await expect(listRow(page)).toHaveCount(0, AT_ONCE);
    await expect(page.getByTestId('contact-bulk-error')).toHaveCount(0);
    // The held refresh lands, still without the row
    await settled();
    await expect(listRow(page)).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto(`/contact?status=open&q=${hex}`);
    await expect(listRow(page)).toHaveAttribute('data-status', 'open');
  });

  test('SPAM-03 a change that fails says so on the page, in English and Arabic, and changes nothing', async ({ page }) => {
    await page.goto(detail);
    await expect(card(page)).toHaveAttribute('data-status', 'open');
    await page.route(`**${detail}`, (route) => (isServerAction(route) ? route.fulfill({ status: 500, body: 'down' }) : route.continue()));

    await page.getByTestId('contact-spam').click();
    await expect(page.getByTestId('contact-action-error')).toHaveText('That did not work. Try again.');
    await expect(card(page)).toHaveAttribute('data-status', 'open');
    await expect(page.getByTestId('contact-spam')).toHaveText('Mark as spam');
    await expect(page.getByTestId('contact-spam')).toBeEnabled();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);

    await setPreferences(page, { locale: 'ar' });
    await page.goto(detail);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId('contact-spam').click();
    await expect(page.getByTestId('contact-action-error')).toHaveText(/\S/);
    await expect(page.getByTestId('contact-action-error')).not.toHaveText('That did not work. Try again.');
    await expect(card(page)).toHaveAttribute('data-status', 'open');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await setPreferences(page, { locale: 'en' });
  });
});
