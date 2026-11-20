/**
 * Contact message "Mark as spam" (owner bug 2026-11-19: clicking it made every
 * button on the page flicker and the message stayed as it was).
 *
 * The spam button alone shows it is working (the other buttons stay usable),
 * the message moves to the Spam view at once with an Undo toast, Undo puts it
 * back, and a failed change says so on the page instead of doing nothing.
 *
 * Data: one open message of this run in the reports DB, written through the
 * stack's control API and removed afterwards, pass or fail.
 */
import crypto from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { E2E_ENTITY_PREFIX, LOCAL_STACK } from './support/env';
import { stackSql } from './support/local-stack';
import { setPreferences } from './support/ui';

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
    if (held || !isServerAction(route)) return route.continue();
    held = true;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return route.continue();
  });
}

const status = (page: Page) => page.getByTestId('contact-message');
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

  test('SPAM-01 only the spam button shows it is working; the message is spam at once, with Undo', async ({ page }) => {
    await page.goto(detail);
    await expect(status(page)).toHaveAttribute('data-status', 'open');
    await slowNextAction(page, 1500);

    const spam = page.getByTestId('contact-spam');
    await spam.click();
    // While it saves: this button says so, the others stay as they were (no flicker of every button)
    await expect(spam).toHaveAttribute('aria-busy', 'true');
    await expect(spam).toHaveText('Working…');
    await expect(page.getByTestId('contact-mark-unread')).toBeEnabled();
    await expect(page.getByTestId('contact-assign-me')).toBeEnabled();
    await expect(page.getByTestId('contact-delete')).toBeEnabled();

    await expect(status(page)).toHaveAttribute('data-status', 'spam');
    await expect(spam).toHaveText('Not spam');
    await expect(page.getByTestId('contact-action-error')).toHaveCount(0);
    await expect(page.getByTestId('undo-toast')).toContainText('Marked as spam');
    await page.unrouteAll({ behavior: 'wait' });

    // Undo puts the status back
    await page.getByTestId('undo-toast-undo').click();
    await expect(status(page)).toHaveAttribute('data-status', 'open');
    await expect(spam).toHaveText('Mark as spam');
  });

  test('SPAM-02 a message marked as spam moves to the Spam view, and Not spam brings it back', async ({ page }) => {
    await page.goto(detail);
    await page.getByTestId('contact-spam').click();
    await expect(status(page)).toHaveAttribute('data-status', 'spam');

    await page.goto(`/contact?status=spam&q=${hex}`);
    await expect(listRow(page)).toHaveAttribute('data-status', 'spam');
    await page.goto(`/contact?status=open&q=${hex}`);
    await expect(listRow(page)).toHaveCount(0);

    await page.goto(detail);
    await page.getByTestId('contact-spam').click();
    await expect(status(page)).toHaveAttribute('data-status', 'open');
    await page.goto(`/contact?status=open&q=${hex}`);
    await expect(listRow(page)).toHaveAttribute('data-status', 'open');
  });

  test('SPAM-03 a change that fails says so on the page, in English and Arabic, and changes nothing', async ({ page }) => {
    await page.goto(detail);
    await expect(status(page)).toHaveAttribute('data-status', 'open');
    await page.route(`**${detail}`, (route) => (isServerAction(route) ? route.fulfill({ status: 500, body: 'down' }) : route.continue()));

    await page.getByTestId('contact-spam').click();
    await expect(page.getByTestId('contact-action-error')).toHaveText('That did not work. Try again.');
    await expect(status(page)).toHaveAttribute('data-status', 'open');
    await expect(page.getByTestId('contact-spam')).toHaveText('Mark as spam');
    await expect(page.getByTestId('contact-spam')).toBeEnabled();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);

    await setPreferences(page, { locale: 'ar' });
    await page.goto(detail);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId('contact-spam').click();
    await expect(page.getByTestId('contact-action-error')).toHaveText(/\S/);
    await expect(page.getByTestId('contact-action-error')).not.toHaveText('That did not work. Try again.');
    await expect(status(page)).toHaveAttribute('data-status', 'open');
    await page.unrouteAll({ behavior: 'wait' });
    await setPreferences(page, { locale: 'en' });
  });
});
