/**
 * Newsletter (AlUmmahNowUI#6): the API needs newsletter:manage; an admin writes a draft in English
 * and Arabic, saves, reopens and deletes it (in-app dialog); Send stays off until both languages are
 * filled in and someone has confirmed; a sign-up made through www's internal endpoint shows on the
 * Subscribers tab as waiting for confirmation and is erased (audited). en and ar (rtl), axe clean.
 * Its own draft and sign-up only, removed afterwards even when a step fails. Sending itself is
 * covered by admin-api test/newsletter.test.ts (queue, Resend stub).
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { ADMIN_API_URL, LOCAL_STACK, RUN_TAG } from './support/env';
import { expectDirection, expectNoAxeViolations, setPreferences, waitForHydration } from './support/ui';

const SUFFIX = `${RUN_TAG}-${Date.now().toString(36)}`;
const SUBJECT_EN = `E2E newsletter ${SUFFIX}`;
const SUBJECT_AR = `اختبار النشرة ${SUFFIX}`;
/** E2E addresses are never emailed outside production (sunk) */
const EMAIL = `newsletter-${SUFFIX}@e2e.alummahnow.net`.toLowerCase();
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'local-stack-internal-key';

interface Issue { id: string; subject_en: string; status: string }
interface Subscriber { id: string; email: string; status: string }

async function cleanup() {
  const issues = await adminApi<{ items: Issue[] }>('/api/newsletter/issues?limit=100');
  for (const i of issues.body.result?.items ?? []) if (i.subject_en === SUBJECT_EN && i.status === 'draft') await adminApi(`/api/newsletter/issues/${i.id}`, { method: 'DELETE' });
  const subs = await adminApi<{ items: Subscriber[] }>(`/api/newsletter/subscribers?q=${encodeURIComponent(EMAIL)}`);
  for (const s of subs.body.result?.items ?? []) if (s.email === EMAIL) await adminApi(`/api/newsletter/subscribers/${s.id}`, { method: 'DELETE' });
}

test.describe('newsletter', () => {
  test.beforeEach(async () => {
    const probe = await adminApi('/api/newsletter/issues');
    test.skip(probe.status === 404, 'admin-api on this target predates /api/newsletter');
  });
  test.afterEach(cleanup);

  test('NEWSLETTER-01 the API needs an admin: invalid token 401, moderator 403', async () => {
    expect((await adminApi('/api/newsletter/issues', { token: 'invalid' })).status).toBe(401);
    expect((await adminApi('/api/newsletter/issues', { token: readTokens().moderator })).status).toBe(403);
  });

  test('NEWSLETTER-02 write a draft in en + ar, save, reopen, delete; Send waits for both languages', async ({ page }) => {
    await page.goto('/newsletter');
    await expect(page.getByRole('heading', { level: 1, name: 'Newsletter' })).toBeVisible();
    const editor = page.getByTestId('newsletter-editor');
    // Typing before hydration is lost when React takes over the controlled fields (#1459)
    await waitForHydration(editor.getByLabel('Subject (English)'));
    await editor.getByLabel('Subject (English)').fill(SUBJECT_EN);
    await expect(page.getByTestId('newsletter-incomplete')).toBeVisible();
    await expect(page.getByTestId('newsletter-send')).toBeDisabled();
    await editor.getByLabel('Subject (Arabic)').fill(SUBJECT_AR);
    await editor.getByLabel('Text (English)').fill('First paragraph.\n\nhttps://www.alummahnow.net/en/');
    await editor.getByLabel('Text (Arabic)').fill('الفقرة الأولى.');
    await expect(page.getByTestId('newsletter-incomplete')).toHaveCount(0);
    await expect(editor.getByLabel('Text (Arabic)')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId('newsletter-save').click();
    await expect(page).toHaveURL(/\/newsletter\?issue=/);
    await expect(page.getByRole('heading', { level: 2, name: 'Edit draft' })).toBeVisible();
    await expect(page.getByTestId('newsletter-subject-ar')).toHaveValue(SUBJECT_AR);
    await expectNoAxeViolations(page, 'newsletter draft (en)');

    // Send asks first and names the count; with no confirmed subscribers it stays off
    const confirmed = await adminApi<{ subscribers: { confirmed: number } }>('/api/newsletter/issues');
    if ((confirmed.body.result?.subscribers.confirmed ?? 0) === 0) await expect(page.getByTestId('newsletter-no-subscribers')).toBeVisible();

    await page.getByTestId('newsletter-back').click();
    await expect(page.getByTestId('newsletter-issue-row').filter({ hasText: SUBJECT_EN })).toHaveAttribute('data-status', 'draft');
    await page.getByRole('link', { name: SUBJECT_EN }).click();
    await page.getByTestId('newsletter-delete').click();
    await page.getByTestId('newsletter-delete-confirm').click();
    await expect(page).toHaveURL(/\/newsletter$/);
    await expect(page.getByRole('link', { name: SUBJECT_EN })).toHaveCount(0);
  });

  test('NEWSLETTER-03 a www sign-up waits for confirmation on the Subscribers tab (ar, rtl) and can be erased', async ({ page, request }) => {
    test.skip(!LOCAL_STACK, 'needs the stack’s internal API key');
    const res = await request.post(`${ADMIN_API_URL}/internal/newsletter/subscribe`, {
      headers: { 'X-API-Key': INTERNAL_API_KEY, 'X-Client-IP': '203.0.113.9' },
      data: { email: EMAIL, locale: 'ar', website: '', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' },
    });
    expect(res.status()).toBe(202);

    await page.goto('/newsletter');
    await setPreferences(page, { locale: 'ar' });
    await page.goto(`/newsletter?tab=subscribers&q=${encodeURIComponent(EMAIL)}`);
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'النشرة البريدية' })).toBeVisible();
    await expect(page.getByTestId('newsletter-tab-subscribers')).toHaveAttribute('aria-current', 'page');
    const row = page.getByTestId('newsletter-subscriber-row').filter({ hasText: EMAIL });
    await expect(row).toHaveAttribute('data-status', 'pending');
    await expect(row).toContainText('بانتظار التأكيد');
    await expect(row).toContainText('العربية');
    await expectNoAxeViolations(page, 'newsletter subscribers (ar)');

    await row.getByRole('button', { name: 'محو' }).click();
    await page.locator('[data-testid$="-confirm"]').filter({ hasText: 'محو' }).click();
    await expect(page.getByTestId('newsletter-subscriber-row').filter({ hasText: EMAIL })).toHaveCount(0);
  });
});
