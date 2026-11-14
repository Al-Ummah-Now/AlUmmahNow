/**
 * Release regression: Contact us. Visitors send messages from the videos site
 * signed out and signed in, in English and Arabic; an admin finds them in the
 * admin-web inbox, replies by email and deletes them again, permanently (self-cleaning).
 *
 * Mail goes through admin-api's contact mail queue. Every sender is an
 * @e2e.alummahnow.net sink address: outside production the queue consumer
 * records their mail as "sunk" instead of sending it (lib/contact-mail-queue.ts),
 * the same idea as the auth server's code sink. The test reads that delivery
 * state back from the admin inbox, so the support inbox never gets test mail.
 */
import { test, expect, type Page } from '@playwright/test';
import { adminConfirm, confirmInApp } from './in-app-confirm';
import { promoteToAdmin } from './sink';
import { sinkEmail, target } from './targets';
import { completeRegistration, createProfile, signUpOnWeb, type Locale, submitPasswordSignIn } from './web-session';
import { fetchRetry } from './net';
import { runId } from '../test-utils/run-users';

// Signs in through the auth server: the trace would hold the password and code
test.use({ trace: 'off' });
test.describe.configure({ mode: 'serial' });

/** One marker per run: every message of this run carries it, so the admin finds (and deletes) exactly these. */
const RUN = `rc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// admin-api drops forms sent faster than this (a bot signal, lib/contact.ts MIN_FILL_MS)
// and still answers 201, so a too-fast send looks like success but stores nothing
const SERVER_MIN_FILL_MS = 3000;
const MIN_FILL_MS = SERVER_MIN_FILL_MS + 500;

const MESSAGE = {
  en: `Release check ${RUN}: the player stops after a minute on my phone.`,
  ar: `فحص الإصدار ${RUN}: يتوقف المشغّل بعد دقيقة على هاتفي.`,
};

test.beforeAll(async () => {
  const res = await fetchRetry(`${target().web}/en/contact`, { redirect: 'manual' });
  // Pull requests run against QA, which gets the page only once this change is on main
  test.skip(res.status === 404 && process.env.GITHUB_EVENT_NAME === 'pull_request', 'Contact us is not deployed on QA yet');
  expect(res.status, 'GET /en/contact').toBe(200);
});

async function sendMessage(page: Page, locale: Locale, opts: { name: string; email?: string; topic: string }): Promise<void> {
  await page.goto(`${target().web}/${locale}/contact?from=${encodeURIComponent(`/${locale}/explore`)}`);
  // Exactly one page body once rendered (retried: a strict-mode lookup threw at once on a
  // transient second copy while the signed-in page re-rendered, #803)
  await expect(page.getByTestId('contact-page')).toHaveCount(1);
  await expect(page.getByTestId('contact-page')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.getByTestId('contact-page-url')).toContainText(`/${locale}/explore`);

  // Nothing filled: accessible errors, nothing sent
  await page.getByTestId('contact-submit').click();
  await expect(page.getByTestId('contact-error-summary')).toBeFocused();
  await expect(page.getByTestId('contact-message')).toHaveAttribute('aria-invalid', 'true');
  // The form starts its fill clock when it hydrates, not when navigation starts:
  // the client-side validation above proves it has, so count from here
  const openedAt = Date.now();

  await page.getByTestId('contact-name').fill(opts.name);
  if (opts.email) await page.getByTestId('contact-email').fill(opts.email);
  await page.getByTestId(`contact-topic-${opts.topic}`).check();
  await page.getByTestId('contact-message').fill(MESSAGE[locale]);
  const wait = MIN_FILL_MS - (Date.now() - openedAt);
  if (wait > 0) await page.waitForTimeout(wait);
  const sent = page.waitForRequest((req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/contact');
  await page.getByTestId('contact-submit').click();
  // Below the floor admin-api would drop the message as a bot and still report success
  const elapsedMs = Number((await sent).postDataJSON()?.elapsedMs);
  expect(elapsedMs, 'the fill time the form reports to admin-api').toBeGreaterThanOrEqual(SERVER_MIN_FILL_MS);
  await expect(page.getByTestId('contact-success')).toBeVisible({ timeout: 30000 });
}

test.describe('Release: Contact us', () => {
  test('a signed-out visitor sends a message in English and in Arabic', async ({ page }) => {
    for (const locale of ['en', 'ar'] as const) {
      const email = sinkEmail(`rel-contact-out-${locale}`);
      await sendMessage(page, locale, { name: `Release ${RUN} out-${locale}`, email, topic: 'general' });
      await expect(page.getByTestId('contact-success')).toContainText(email);
    }
  });

  test('a signed-in user sends a message with the account email (Arabic, then English)', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-contact-in', 'ar');
    await createProfile(user);
    for (const locale of ['ar', 'en'] as const) {
      await page.goto(`${target().web}/${locale}/contact`);
      const email = page.getByTestId('contact-email');
      await expect(email).toHaveValue(user.email);
      await expect(email).toHaveAttribute('readonly', '');
      await sendMessage(page, locale, { name: `Release ${RUN} in-${locale}`, topic: 'problem' });
      await expect(page.getByTestId('contact-success')).toContainText(user.email);
    }
  });

  test('an admin sees the messages, replies by email and deletes them', async ({ page, context }) => {
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    test.setTimeout(6 * 60000);
    await signInAsAdmin(page, context);
    page.on('dialog', (dialog) => void dialog.accept());

    // Self-healing: earlier runs that died before their cleanup left messages behind.
    // Delete this suite's own leftovers (sink senders, "Release rc…" names) older than an hour,
    // and this run's from an attempt that failed before it deleted them.
    await sweepLeftovers(page);

    const inbox = `${target().adminWeb}/contact?q=${RUN}`;
    await page.goto(inbox);
    const nav = page.getByRole('navigation').getByRole('link', { name: /Contact messages|رسائل التواصل/ });
    await expect(nav).toBeVisible();
    await expect(page.getByTestId('contact-nav-badge')).toBeVisible();
    const rows = page.getByTestId('contact-row');
    await expect(rows).toHaveCount(4, { timeout: 30000 });
    const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-message-id') as string));

    try {
      // The signed-in Arabic message: opening it reads it
      await page.getByRole('link', { name: new RegExp(`${RUN} in-ar`) }).click();
      await expect(page.getByTestId('contact-message')).toHaveAttribute('data-status', 'open');
      await expect(page.getByTestId('contact-message-body')).toHaveText(MESSAGE.ar);
      await expect(page.getByTestId('contact-user-link')).toHaveAttribute('href', /^\/users\/.+/);
      await expect(page.getByTestId('contact-page-url')).toContainText('/ar/explore');
      // The queue delivered the acknowledgement and the support-inbox notification to the sink
      // (the page re-reads itself while anything is queued)
      await expect(page.getByTestId('contact-ack-status')).toHaveAttribute('data-status', 'sunk', { timeout: 90000 });
      await expect(page.getByTestId('contact-notify-status')).toHaveAttribute('data-status', 'sunk', { timeout: 90000 });
      await expect(page.getByTestId('contact-send-failed')).toHaveCount(0);

      await page.getByTestId('contact-assign-me').click();
      await expect(page.getByTestId('contact-unassign')).toBeVisible();
      await page.getByTestId('contact-note-body').fill(`Internal note ${RUN}`);
      await page.getByTestId('contact-note-add').click();
      await expect(page.locator('[data-testid="contact-note"][data-kind="note"]')).toContainText(`Internal note ${RUN}`);

      await page.getByTestId('contact-reply-body').fill(`وعليكم السلام، ${RUN}: حدّث التطبيق وأعد المحاولة.`);
      await page.getByTestId('contact-reply-send').click();
      const replyNote = page.locator('[data-testid="contact-note"][data-kind="reply"]');
      // Queued at once, then delivered to the E2E sink by the queue consumer (production would say "sent")
      await expect(replyNote).toHaveAttribute('data-email-status', /queued|sunk/);
      await expect(replyNote).toHaveAttribute('data-email-status', 'sunk', { timeout: 90000 });
      await expect(page.getByTestId('contact-message')).toHaveAttribute('data-status', 'replied', { timeout: 30000 });

      // A signed-out one is marked as spam, and spam cannot be replied to
      await page.goto(inbox);
      await page.getByRole('link', { name: new RegExp(`${RUN} out-en`) }).click();
      await expect(page.getByTestId('contact-sender')).not.toContainText(/View user|عرض المستخدم/);
      await page.getByTestId('contact-spam').click();
      await expect(page.getByTestId('contact-message')).toHaveAttribute('data-status', 'spam');
      await expect(page.getByTestId('contact-reply-body')).toBeDisabled();

      // Filters: status=spam finds exactly that one
      await page.goto(`${inbox}&status=spam`);
      await expect(rows).toHaveCount(1);
    } finally {
      for (const id of ids) {
        await page.goto(`${target().adminWeb}/contact/${id}`);
        await page.getByTestId('contact-delete').click();
        await confirmInApp(page, adminConfirm('contact-delete-confirm'));
        await expect(page).toHaveURL(new RegExp(`${target().adminWeb}/contact(\\?|$)`), { timeout: 30000 });
      }
      // A delete keeps the message restorable for 30 days: these are test messages, so delete them
      // permanently (Recently deleted), which queues them for the next hourly cleanup
      await purgeDeleted(page, ids);
    }
    await page.goto(inbox);
    await expect(page.getByTestId('contact-empty')).toBeVisible();
  });
});

/** "Delete permanently now" on each deleted message (Recently deleted → Contact messages). */
async function purgeDeleted(page: Page, ids: string[]): Promise<void> {
  await page.goto(`${target().adminWeb}/recently-deleted/contact-message`);
  for (const id of ids) {
    const row = page.locator(`[data-testid="trash-row"][data-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: 30000 });
    if ((await row.getAttribute('data-queued')) === 'true') continue;
    await row.getByTestId(`trash-purge-${id}`).click();
    await page.getByTestId(`trash-purge-${id}-typed`).fill(id);
    await page.getByTestId(`trash-purge-${id}-confirm`).click();
    await expect(row).toHaveAttribute('data-queued', 'true', { timeout: 30000 });
  }
}

/** Deletes old "Release rc…" messages from E2E sink senders (at most 20 per run). */
async function sweepLeftovers(page: Page): Promise<void> {
  await page.goto(`${target().adminWeb}/contact?q=${encodeURIComponent('Release rc')}`);
  await expect(page.getByTestId('contact-total')).toBeVisible();
  // Also this CI run's messages from an earlier attempt of this group (a retry runs the whole serial
  // group again with a new RUN marker; the failed attempt's signed-out messages, sent from sink
  // addresses no run account owns, were left for the leftover check to fail the job). Never the
  // current attempt's (they carry RUN) and never another run's (its own id).
  const id = runId();
  const stale = await page.getByTestId('contact-row').evaluateAll(
    (rows, { before, ownRun, current }) =>
      rows
        .filter((row) => {
          const email = row.querySelector('td span[dir="ltr"]')?.textContent?.trim() ?? '';
          if (!/@e2e\.alummahnow\.net$/.test(email)) return false;
          if (ownRun && email.startsWith(ownRun) && !(row.textContent ?? '').includes(current)) return true;
          return Date.parse(row.querySelector('time')?.getAttribute('datetime') ?? '') < before;
        })
        .map((row) => row.getAttribute('data-message-id') as string),
    { before: Date.now() - 3600_000, ownRun: id ? `e2e+${id}-` : '', current: RUN },
  );
  for (const id of stale.slice(0, 20)) {
    await page.goto(`${target().adminWeb}/contact/${id}`);
    await page.getByTestId('contact-delete').click();
    await confirmInApp(page, adminConfirm('contact-delete-confirm'));
    await expect(page).toHaveURL(new RegExp(`${target().adminWeb}/contact(\\?|$)`), { timeout: 30000 });
  }
  if (stale.length) await purgeDeleted(page, stale.slice(0, 20));
}

async function signInAsAdmin(page: Page, context: import('@playwright/test').BrowserContext): Promise<void> {
  const email = sinkEmail('rel-contact-admin');
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await completeRegistration(page, email);
  await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
  await promoteToAdmin(email);
  // New tokens carry the role: drop every session and sign in from scratch
  await context.clearCookies();
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await submitPasswordSignIn(page, email);
  await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
}
