/**
 * Release regression: Contact us. Visitors send messages from the videos site
 * signed out and signed in, in English and Arabic; an admin finds them in the
 * admin-web inbox, replies by email and deletes them again (self-cleaning).
 *
 * Mail goes through admin-api's contact mail queue. Every sender is an
 * @e2e.alummahnow.net sink address: outside production the queue consumer
 * records their mail as "sunk" instead of sending it (lib/contact-mail-queue.ts),
 * the same idea as the auth server's code sink. The test reads that delivery
 * state back from the admin inbox, so the support inbox never gets test mail.
 */
import { test, expect, type Page } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';
import { completeRegistration, createProfile, signUpOnWeb, type Locale } from './web-session';
import { fillSecret } from './secret-fill';

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
  const res = await fetch(`${target().web}/en/contact`, { redirect: 'manual' });
  // Pull requests run against QA, which gets the page only once this change is on main
  test.skip(res.status === 404 && process.env.GITHUB_EVENT_NAME === 'pull_request', 'Contact us is not deployed on QA yet');
  expect(res.status, 'GET /en/contact').toBe(200);
});

async function sendMessage(page: Page, locale: Locale, opts: { name: string; email?: string; topic: string }): Promise<void> {
  await page.goto(`${target().web}/${locale}/contact?from=${encodeURIComponent(`/${locale}/explore`)}`);
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
        await expect(page).toHaveURL(new RegExp(`${target().adminWeb}/contact(\\?|$)`), { timeout: 30000 });
      }
    }
    await page.goto(inbox);
    await expect(page.getByTestId('contact-empty')).toBeVisible();
  });
});

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
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  await page.click('button[data-component="button"]');
  await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
}
