/**
 * Contact messages inbox (owner bug 2026-11-15: rows did not open, no read
 * state, the badge never cleared, the table scrolled sideways) on the local
 * stack.
 *
 * Data: three messages of this run in the reports DB (two unread, one filed
 * as spam by the content rule with its bot verdict), written through the
 * stack's control API and removed afterwards, pass or fail. Assignees are the
 * run's own admin accounts. The nav badge is a global count, so the
 * spec runs in the shared-state project and compares counts before and after.
 */
import crypto from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { E2E_ENTITY_PREFIX, LOCAL_STACK, accounts } from './support/env';
import { stackSql } from './support/local-stack';
import { expectNoAxeViolations, horizontalOverflow, setPreferences } from './support/ui';

const REPORTS = 'al-ummah-now-reports';
const hex = crypto.randomBytes(6).toString('hex');
const id = (n: string) => `${E2E_ENTITY_PREFIX}inbox-${n}-${hex}`;
const [m1, m2, m3] = [id('a'), id('b'), id('spam')];
const inbox = `/contact?q=${hex}`;

const row = (page: Page, messageId: string) => page.locator(`[data-testid="contact-row"][data-message-id="${messageId}"]`);
const badgeCount = async (page: Page) => {
  const badge = page.getByTestId('contact-nav-badge');
  return (await badge.count()) ? Number(await badge.first().getAttribute('data-count')) : 0;
};

test.describe('contact inbox', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK, 'Seeds contact messages through the local stack');
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const insert = (messageId: string, name: string, message: string, extra: { status?: string; spam?: string; verdict?: string; minutes: number }) =>
      `('${messageId}', '${extra.status ?? 'open'}', 'general', '${name}', 'sender-${hex}@e2e.example', '${message}', 'en', 'h-${hex}', NULL, '${extra.verdict ?? 'pass'}', ${extra.spam ? `'${extra.spam}'` : 'NULL'}, ${extra.status === 'spam' ? `'${at(extra.minutes)}'` : 'NULL'}, '${at(extra.minutes)}', '${at(extra.minutes)}', 'sent', 'sent')`;
    await stackSql(
      REPORTS,
      `INSERT INTO contact_messages (id, status, topic, name, email, message, locale, ip_hash, user_id, bot_verdict, spam_reason, read_at, created_at, updated_at, notify_status, ack_status) VALUES
       ${insert(m1, `Inbox Amina ${hex}`, `The player stops on my phone after a minute ${hex}. It happens on every video I open from the home page, and reloading does not help at all.`, { minutes: 3 })},
       ${insert(m2, `Inbox Bilal ${hex}`, `How do I change my channel name ${hex}?`, { minutes: 2 })},
       ${insert(m3, `Inbox Pitch ${hex}`, `We can grow your online visibility and rank higher on Google ${hex}`, { status: 'spam', spam: 'content', verdict: 'off', minutes: 1 })}`,
    );
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK) return;
    const ids = `'${m1}', '${m2}', '${m3}'`;
    await stackSql(REPORTS, `DELETE FROM contact_notes WHERE message_id IN (${ids})`);
    await stackSql(REPORTS, `DELETE FROM contact_messages WHERE id IN (${ids})`);
    // The delete and restore audit rows (lib/trash-audit.ts) of these messages
    await stackSql(REPORTS, `DELETE FROM site_settings_log WHERE key LIKE '%${hex}%'`);
  });

  test('INBOX-01 the whole row opens the message, which reads it; the badge counts unread only and follows changes live on any page', async ({ page }) => {
    // The admin live socket's subscription replies, to publish only once the page follows contact changes
    const subscriptions: string[] = [];
    page.on('websocket', (ws) =>
      ws.on('framereceived', (f) => {
        try {
          const msg = JSON.parse(String(f.payload)) as { type?: string; channel?: string };
          if (msg.channel === 'admin:moderation' && (msg.type === 'subscribed' || msg.type === 'unsubscribed')) subscriptions.push(msg.type);
        } catch {
          // not JSON
        }
      }),
    );
    await page.goto(inbox);
    await expect(page.getByTestId('contact-row')).toHaveCount(3);
    await expect(row(page, m1)).toHaveAttribute('data-read', 'false');
    await expect(row(page, m1).getByTestId('contact-unread-dot')).toBeVisible();
    // Spam is never unread, and says why it is spam
    await expect(row(page, m3)).toHaveAttribute('data-read', 'true');
    await expect(row(page, m3).getByTestId('contact-spam-reason')).toHaveText('Reads as a sales pitch');
    const before = await badgeCount(page);
    expect(before).toBeGreaterThanOrEqual(2);

    // A click on the message text (not the sender's name) opens it: a real mouse click at that
    // spot, which the row-wide link takes (Playwright's locator click refuses a covered element)
    // The paragraph is clamped to two lines; its text box runs on below the clamp, so aim at the paragraph
    const messageText = row(page, m1).locator('p', { hasText: `The player stops on my phone after a minute ${hex}` });
    await messageText.scrollIntoViewIfNeeded();
    const text = await messageText.boundingBox();
    expect(text, 'message text on screen').not.toBeNull();
    await page.mouse.click(text!.x + text!.width / 2, text!.y + text!.height / 2);
    await expect(page).toHaveURL(new RegExp(`/contact/${encodeURIComponent(m1)}$`));
    await expect(page.getByTestId('contact-message')).toHaveAttribute('data-read', 'true');
    await expect(page.getByTestId('contact-message-body')).toContainText('reloading does not help at all');
    await expect(page.getByTestId('contact-bot-verdict')).toHaveText('Passed');
    await expect.poll(() => badgeCount(page)).toBe(before - 1);

    // Another admin marks it unread while this admin is on another page (the dashboard): the
    // badge follows there too, without a reload
    const seen = subscriptions.length;
    await page.goto('/dashboard');
    await expect.poll(() => badgeCount(page)).toBe(before - 1);
    await expect.poll(() => subscriptions.slice(seen).at(-1), { timeout: 15_000, message: 'the dashboard follows admin:moderation' }).toBe('subscribed');
    await page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });
    const res = await adminApi(`/api/contact/messages/${encodeURIComponent(m1)}`, { method: 'PATCH', body: JSON.stringify({ read: false }) });
    expect(res.status).toBe(200);
    await expect.poll(() => badgeCount(page), { timeout: 20_000 }).toBe(before);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument), 'no full reload').toBe(true);
  });

  test('INBOX-02 detail: read/unread, status in progress, assign through the live picker, spam verdict and reason', async ({ page }) => {
    await page.goto(`/contact/${encodeURIComponent(m2)}`);
    await expect(page.getByTestId('contact-message')).toHaveAttribute('data-read', 'true');
    await page.getByTestId('contact-mark-unread').click();
    await expect(page.getByTestId('contact-message')).toHaveAttribute('data-read', 'false');
    await page.getByTestId('contact-mark-read').click();
    await expect(page.getByTestId('contact-message')).toHaveAttribute('data-read', 'true');

    await page.getByTestId('contact-status-select').selectOption('in_progress');
    await page.getByTestId('contact-save-status').click();
    await expect(page.getByTestId('contact-message')).toHaveAttribute('data-status', 'in_progress');

    // The picker lists every account that can handle messages (the run's admin and super admin,
    // from their roles; neither opened this message) and finds one by email
    const superadmin = accounts.superadmin.email.toLowerCase();
    await page.getByTestId('contact-assignee-picker-input').fill(superadmin.split('@')[0]);
    const option = page.locator('[data-testid="contact-assignee-picker-option"]').filter({ hasText: superadmin });
    await expect(option).toHaveCount(1);
    await option.click();
    // Stored on the message, and shown by name (the display-name rule: name, else email; never an id)
    await expect
      .poll(async () => (await adminApi<{ message: { assignee_email: string | null } }>(`/api/contact/messages/${encodeURIComponent(m2)}`)).body.result?.message.assignee_email)
      .toBe(superadmin);
    await expect(page.getByTestId('contact-assignee')).not.toHaveText(/^\s*$/);
    await expect(page.getByTestId('contact-assignee')).not.toContainText('usr_');

    await page.goto(`/contact/${encodeURIComponent(m3)}`);
    await expect(page.getByTestId('contact-spam-reason')).toHaveAttribute('data-reason', 'content');
    await expect(page.getByTestId('contact-bot-verdict')).toHaveAttribute('data-verdict', 'off');
    await expect(page.getByTestId('contact-reply-body')).toBeDisabled();
  });

  test('INBOX-03 bulk: select, mark read, set status, delete with Undo', async ({ page }) => {
    await page.goto(inbox);
    await row(page, m1).getByTestId('contact-row-select').check();
    await row(page, m2).getByTestId('contact-row-select').check();
    await expect(page.getByTestId('contact-bulk-count')).toHaveText('2 selected');
    await page.getByTestId('contact-bulk-read').click();
    await expect(row(page, m1)).toHaveAttribute('data-read', 'true');

    await page.getByTestId('contact-bulk-status').selectOption('closed');
    await page.getByTestId('contact-bulk-status-apply').click();
    await expect(row(page, m1)).toHaveAttribute('data-status', 'closed');
    await expect(row(page, m2)).toHaveAttribute('data-status', 'closed');

    // Delete happens at once (no confirm, no browser prompt); Undo brings both back
    page.on('dialog', (d) => { throw new Error(`A browser dialog opened: ${d.type()}`); });
    await page.getByTestId('contact-bulk-delete').click();
    await expect(page.getByTestId('undo-toast')).toContainText('2 messages deleted');
    await expect(page.getByTestId('contact-row')).toHaveCount(1);
    await page.getByTestId('undo-toast-undo').click();
    await expect(page.getByTestId('contact-row')).toHaveCount(3);
  });

  test('INBOX-04 phone, English and Arabic: no sideways scroll, rows still open, axe clean', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const locale of ['en', 'ar'] as const) {
      await setPreferences(page, { locale });
      await page.goto(inbox);
      await expect(page.getByTestId('contact-row')).toHaveCount(3);
      expect(await horizontalOverflow(page), `${locale} list`).toBeLessThanOrEqual(1);
      await expectNoAxeViolations(page, `contact inbox (${locale}, phone)`);
      await row(page, m2).getByTestId('contact-row-link').click();
      await expect(page).toHaveURL(new RegExp(`/contact/${encodeURIComponent(m2)}$`));
      expect(await horizontalOverflow(page), `${locale} detail`).toBeLessThanOrEqual(1);
      await expectNoAxeViolations(page, `contact message (${locale}, phone)`);
    }
    await setPreferences(page, { locale: 'en' });
  });
});
