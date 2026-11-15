/**
 * Status page subscriptions (docs/status-page/README.md "Subscriptions"), end to end on the
 * local stack: a visitor subscribes on the public page (Arabic emails), gets the confirmation
 * email (the stack's Resend fake), confirms with the button; an admin adds a webhook on the admin
 * Status page (the secret is shown once); a posted incident reaches the subscriber in Arabic with
 * the unsubscribe headers and reaches the webhook signed; the admin sees the deliveries; the
 * visitor unsubscribes from the email's link; the admin deletes the webhook. axe on every public
 * page, en and ar. Its own address, webhook and incident only, all removed afterwards.
 */
import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { LOCAL_STACK, RUN_TAG, STACK_CONTROL_URL } from './support/env';

const STATUS_URL = process.env.STATUS_URL || 'http://localhost:3095';
const STAMP = `${RUN_TAG}-${Date.now().toString(36)}`.toLowerCase();
const ADDRESS = `status-sub-${STAMP}@example.com`;
const HOOK_NAME = `E2E hook ${STAMP}`;
const HOOK_URL = `https://webhooks.local-stack.test/${STAMP}`;
const TITLE_EN = `E2E subscription ${STAMP}`;
const TITLE_AR = `اختبار الاشتراك ${STAMP}`;

interface Mail { to: string[]; subject: string; text: string; headers?: Record<string, string> }
interface Hook { url: string; headers: Record<string, string>; body: string }
interface Incident { id: string; titleEn: string; deletedAt: string | null }

async function mails(): Promise<Mail[]> {
  return (await (await fetch(`${STACK_CONTROL_URL}/__fake/resend/emails`)).json()) as Mail[];
}
async function hooks(): Promise<Hook[]> {
  return (await (await fetch(`${STACK_CONTROL_URL}/__fake/webhooks`)).json()) as Hook[];
}
/** The newest email to ADDRESS whose subject matches. */
async function waitForMail(match: RegExp): Promise<Mail> {
  let found: Mail | undefined;
  await expect.poll(async () => (found = (await mails()).reverse().find((m) => m.to?.[0] === ADDRESS && match.test(m.subject))) !== undefined, { timeout: 30_000 }).toBe(true);
  return found!;
}

async function cleanup() {
  const o = await adminApi<{ open: Incident[]; recent: Incident[]; deleted: Incident[] }>('/api/status/overview');
  if (o.status === 200) {
    for (const i of [...o.body.result!.open, ...o.body.result!.recent, ...o.body.result!.deleted].filter((x) => x.titleEn === TITLE_EN)) {
      if (!i.deletedAt) await adminApi(`/api/status/incidents/${i.id}`, { method: 'DELETE' });
      await adminApi(`/api/status/incidents/${i.id}/purge`, { method: 'POST' });
    }
  }
  const subs = await adminApi<{ webhooks: { id: string; name: string }[] }>('/api/status/subscriptions');
  for (const w of subs.body.result?.webhooks.filter((x) => x.name === HOOK_NAME) ?? []) await adminApi(`/api/status/webhooks/${w.id}`, { method: 'DELETE' });
  await adminApi('/api/status/subscribers/remove', { method: 'POST', body: JSON.stringify({ email: ADDRESS }) });
}

/**
 * axe on everything this feature renders. The shared status header (`header.top`) is left out:
 * it belongs to the shared header work (#1357), and its language link already fails
 * label-content-name-mismatch on main.
 */
async function axe(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('header.top').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), `axe violations on ${what}`).toEqual([]);
}

test.describe('status page subscriptions', () => {
  test.beforeEach(async () => {
    test.skip(!LOCAL_STACK, 'the public status Worker, the Resend fake and the webhook receiver run on the local stack only');
    const probe = await adminApi('/api/status/subscriptions');
    test.skip(probe.status === 404, 'admin-api on this target predates status subscriptions');
  });
  test.afterEach(cleanup);

  test('STATUS-SUB-01 subscribe, confirm, get the incident by email and webhook, unsubscribe', async ({ page }) => {
    test.setTimeout(150_000);
    const pub = await page.context().newPage();

    // Subscribe on the English page, choosing Arabic emails; the Arabic form is right to left
    await pub.goto(`${STATUS_URL}/ar/subscribe`);
    await expect(pub.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(pub.getByRole('heading', { level: 1 })).toHaveText('تابع حالة الخدمات بالبريد الإلكتروني');
    await axe(pub, 'subscribe (ar)');
    await pub.goto(`${STATUS_URL}/subscribe`);
    await axe(pub, 'subscribe (en)');
    await pub.getByLabel('Email address').fill('not-an-address');
    await pub.getByRole('button', { name: 'Subscribe' }).click();
    await expect(pub.getByRole('alert')).toContainText('Enter a valid email address');
    await pub.getByLabel('Email address').fill(ADDRESS);
    await pub.getByLabel('العربية').check();
    await pub.getByRole('button', { name: 'Subscribe' }).click();
    await expect(pub).toHaveURL(/\/subscribe\/sent$/);
    await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Check your inbox');

    // The confirmation email, in Arabic, links to the Arabic confirm page; opening it changes nothing
    const confirmMail = await waitForMail(/أكّد اشتراكك/);
    const confirmUrl = /http:\/\/localhost:3095\/ar\/subscribe\/confirm\?t=[\w-]+/.exec(confirmMail.text)?.[0];
    expect(confirmUrl, 'confirm link in the email').toBeTruthy();
    await pub.goto(confirmUrl!);
    await expect(pub.locator('html')).toHaveAttribute('dir', 'rtl');
    await axe(pub, 'confirm (ar)');
    await pub.getByRole('button', { name: 'تأكيد الاشتراك' }).click();
    await expect(pub.getByRole('heading', { level: 1 })).toHaveText('تم اشتراكك');

    // The admin adds a webhook: the signing secret is shown once
    await page.goto('/status');
    const card = page.getByTestId('status-subscriptions');
    await expect(card.getByTestId('status-subs-active')).toBeVisible();
    await card.getByTestId('status-webhook-name').fill(HOOK_NAME);
    await card.getByTestId('status-webhook-url').fill(HOOK_URL);
    await card.getByTestId('status-webhook-add').click();
    const secret = (await card.getByTestId('status-webhook-secret-value').textContent())!.trim();
    expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    await expect(card.getByTestId('status-webhook-row').filter({ hasText: HOOK_NAME })).toBeVisible();

    // An incident on a public component reaches both (search: no other spec posts on it, so parallel
    // specs that check a component's state, like STATUS-02 on playback, never see this incident)
    const created = await adminApi<Incident>('/api/status/incidents', {
      method: 'POST',
      body: JSON.stringify({ kind: 'incident', titleEn: TITLE_EN, titleAr: TITLE_AR, impact: 'partial', components: ['search', 'api'], bodyEn: 'Some videos are slow to start.', bodyAr: 'بعض المرئيات بطيئة في البدء.' }),
    });
    expect(created.status).toBe(201);
    const incidentMail = await waitForMail(new RegExp(TITLE_AR));
    expect(incidentMail.subject).toContain('قيد التحقيق');
    expect(incidentMail.text).toContain('بعض المرئيات بطيئة في البدء.');
    expect(incidentMail.text).not.toContain('واجهة المرئيات البرمجية');
    const unsubscribeUrl = /^<(http:\/\/localhost:3095\/ar\/unsubscribe\?t=[\w-]+)>$/.exec(incidentMail.headers?.['List-Unsubscribe'] ?? '')?.[1];
    expect(unsubscribeUrl, 'List-Unsubscribe header').toBeTruthy();
    expect(incidentMail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    // This incident's delivery: incidents other specs post while the webhook exists reach it too
    const incidentId = created.body.result!.id;
    const ours = (h: Hook) => h.url === HOOK_URL && (JSON.parse(h.body) as { incident?: { id?: string } }).incident?.id === incidentId;
    let delivery: Hook | undefined;
    await expect.poll(async () => (delivery = (await hooks()).find(ours)) !== undefined, { timeout: 30_000 }).toBe(true);
    const payload = JSON.parse(delivery!.body);
    expect(payload.type).toBe('incident.created');
    expect(payload.incident.id).toBe(incidentId);
    expect(payload.incident.components).toEqual(['search']);
    const expected = `sha256=${createHmac('sha256', secret).update(`${delivery!.headers['x-aun-timestamp']}.${delivery!.body}`).digest('hex')}`;
    expect(delivery!.headers['x-aun-signature']).toBe(expected);

    // The admin sees the notification delivered to both
    await expect
      .poll(async () => {
        await page.goto('/status');
        return Number(await page.getByTestId('status-notification-row').filter({ hasText: TITLE_EN }).first().getAttribute('data-sent'));
      }, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('status-webhook-row').filter({ hasText: HOOK_NAME }).getByTestId('status-webhook-last')).toHaveText('Delivered');

    // Unsubscribe from the email's link: the page asks, the button deletes; the links stop working
    await pub.goto(unsubscribeUrl!);
    await axe(pub, 'unsubscribe (ar)');
    await pub.getByRole('button', { name: 'إلغاء الاشتراك' }).click();
    await expect(pub.getByRole('heading', { level: 1 })).toHaveText('أُلغي اشتراكك');
    await pub.goto(confirmUrl!);
    await expect(pub.getByRole('heading', { level: 1 })).toHaveText('انتهت صلاحية هذا الرابط');
    await pub.close();

    // Delete the webhook through the in-app dialog
    const row = page.getByTestId('status-webhook-row').filter({ hasText: HOOK_NAME });
    const id = await row.getAttribute('data-id');
    await page.getByTestId(`status-webhook-delete-${id}`).click();
    await page.getByTestId(`status-webhook-delete-${id}-confirm`).click();
    await expect(page.getByTestId('status-webhook-row').filter({ hasText: HOOK_NAME })).toHaveCount(0);
  });

  test('STATUS-SUB-02 the main page links to email updates; a cross-site post is refused', async ({ page }) => {
    await page.goto(`${STATUS_URL}/?e2e=${Date.now()}`);
    await page.getByTestId('subscribe-cta').getByRole('link', { name: 'Get email updates' }).click();
    await expect(page).toHaveURL(`${STATUS_URL}/subscribe`);
    const res = await page.request.post(`${STATUS_URL}/subscribe`, { form: { email: ADDRESS, locale: 'en' }, headers: { origin: 'https://elsewhere.example' }, maxRedirects: 0 });
    expect(res.status()).toBe(403);
  });
});
