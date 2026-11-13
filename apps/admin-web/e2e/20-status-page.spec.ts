/**
 * Status page (docs/status-page/README.md): an admin posts an incident on the admin Status page
 * (English + Arabic), it shows on the public status page (apps/status, the local stack's
 * :3095) in English (ltr) and Arabic (rtl) and in its JSON, an update resolves it, and Delete
 * (in-app dialog) hides it. Local placement: the status Worker and admin-api share the stack's D1.
 * Its own incident only, deleted and purged afterwards even when a step fails.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK, RUN_TAG } from './support/env';

const STATUS_URL = process.env.STATUS_URL || 'http://localhost:3095';
const TITLE_EN = `E2E status ${RUN_TAG}-${Date.now().toString(36)}`;
const TITLE_AR = `اختبار الحالة ${RUN_TAG}`;

interface Incident { id: string; titleEn: string; status: string; deletedAt: string | null }
interface Overview { open: Incident[]; recent: Incident[]; deleted: Incident[] }

/** Deletes then purges every incident this test created (by title). */
async function cleanup() {
  const o = await adminApi<Overview>('/api/status/overview');
  if (o.status !== 200) return;
  const mine = [...o.body.result!.open, ...o.body.result!.recent, ...o.body.result!.deleted].filter((i) => i.titleEn === TITLE_EN);
  for (const i of mine) {
    if (!i.deletedAt) await adminApi(`/api/status/incidents/${i.id}`, { method: 'DELETE' });
    await adminApi(`/api/status/incidents/${i.id}/purge`, { method: 'POST' });
  }
}

/** The public page, past its 30 s edge cache (the cache key includes the query). */
const fresh = (path: string) => `${STATUS_URL}${path}${path.includes('?') ? '&' : '?'}e2e=${Date.now()}`;

test.describe('status page', () => {
  test.beforeEach(async () => {
    const probe = await adminApi('/api/status/overview');
    test.skip(probe.status === 404, 'admin-api on this target predates /api/status');
    test.skip(!LOCAL_STACK, 'the public status Worker runs on the local stack only');
  });
  test.afterEach(cleanup);

  test('STATUS-01 the API needs an admin: invalid token 401, moderator 403', async () => {
    expect((await adminApi('/api/status/overview', { token: 'invalid' })).status).toBe(401);
    expect((await adminApi('/api/status/overview', { token: readTokens().moderator })).status).toBe(403);
  });

  test('STATUS-02 post an incident, see it on the public page in en and ar, resolve, delete', async ({ page }) => {
    await page.goto('/status');
    await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible();
    await expect(page.getByTestId('status-public-link')).toHaveAttribute('href', 'http://localhost:3095');
    // The admin lists every component; internal ones (staff tools, back ends) only here
    await expect(page.getByTestId('status-checks-internal').locator('[data-component="cms"]')).toHaveAttribute('data-public', 'false');
    await expect(page.getByTestId('status-checks-public').locator('[data-component="playback"]')).toHaveAttribute('data-public', 'true');

    const form = page.getByTestId('status-new-form');
    await form.getByTestId('status-title-en').fill(TITLE_EN);
    await form.getByTestId('status-title-ar').fill(TITLE_AR);
    await form.getByTestId('status-body-en').fill('Some videos are slow to start.');
    await form.getByTestId('status-body-ar').fill('بعض المرئيات بطيئة في البدء.');
    await form.getByTestId('status-impact').selectOption('partial');
    await form.getByTestId('status-component-playback').check();
    await form.getByTestId('status-new-submit').click();
    await expect(page.getByTestId('status-new-feedback')).toContainText('Incident posted');
    const card = page.getByTestId('status-incident').filter({ hasText: TITLE_EN });
    await expect(card).toHaveAttribute('data-status', 'investigating');

    // Public page, English: the incident and the component it affects
    const pub = await page.context().newPage();
    await pub.goto(fresh('/'));
    await expect(pub.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(pub.getByRole('heading', { name: 'Active incidents' })).toBeVisible();
    await expect(pub.getByRole('link', { name: TITLE_EN })).toBeVisible();
    await expect(pub.locator('[data-component="playback"]')).toHaveAttribute('data-state', 'partial');
    await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Some systems are having problems');
    // No internal component on the public page (owner, 2026-11-13)
    for (const id of ['api', 'cms', 'admin', 'admin-api', 'auth-admin', 'email']) await expect(pub.locator(`[data-component="${id}"]`)).toHaveCount(0);

    // Arabic, right to left
    await pub.goto(fresh('/ar'));
    await expect(pub.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(pub.getByRole('link', { name: TITLE_AR })).toBeVisible();
    await expect(pub.getByText('انقطاع جزئي').first()).toBeVisible();

    const json = await (await pub.request.get(fresh('/api/status.json'))).json();
    const listed = json.incidents.active.find((i: { title: { en: string } }) => i.title.en === TITLE_EN);
    expect(listed.title.ar).toBe(TITLE_AR);
    expect(listed.components).toEqual(['playback']);

    // Resolve: the incident moves to past incidents and the component is operational again
    await card.getByTestId('status-update-status').selectOption('resolved');
    await card.getByTestId('status-update-body-en').fill('Fixed.');
    await card.getByTestId('status-update-body-ar').fill('تم الإصلاح.');
    await card.getByTestId('status-update-submit').click();
    await expect(page.getByTestId('status-recent').getByTestId('status-incident').filter({ hasText: TITLE_EN })).toHaveAttribute('data-status', 'resolved');
    await pub.goto(fresh('/'));
    await expect(pub.locator('[data-component="playback"]')).not.toHaveAttribute('data-state', 'partial');
    await expect(pub.getByRole('region', { name: 'Past incidents' }).getByRole('link', { name: TITLE_EN })).toBeVisible();

    // Delete through the in-app dialog: gone from the public page, listed under Deleted
    const resolvedCard = page.getByTestId('status-recent').getByTestId('status-incident').filter({ hasText: TITLE_EN });
    const id = await resolvedCard.getAttribute('data-id');
    await page.getByTestId(`status-delete-${id}`).click();
    await page.getByTestId(`status-delete-${id}-confirm`).click();
    await expect(page.getByTestId('status-deleted-row').filter({ hasText: TITLE_EN })).toBeVisible();
    await pub.goto(fresh('/'));
    await expect(pub.getByRole('link', { name: TITLE_EN })).toHaveCount(0);
    await pub.close();
  });

  test('STATUS-03 an incident on internal components only stays in the admin', async ({ page }) => {
    const created = await adminApi<Incident>('/api/status/incidents', {
      method: 'POST',
      body: JSON.stringify({ kind: 'incident', titleEn: TITLE_EN, titleAr: TITLE_AR, impact: 'major', components: ['cms', 'admin-api'], bodyEn: 'Staff tools are down.', bodyAr: 'أدوات الفريق متوقفة.' }),
    });
    expect(created.status).toBe(201);
    await page.goto('/status');
    await expect(page.getByTestId('status-open').getByTestId('status-incident').filter({ hasText: TITLE_EN })).toBeVisible();

    const pub = await page.context().newPage();
    await pub.goto(fresh('/'));
    await expect(pub.getByText(TITLE_EN)).toHaveCount(0);
    await expect(pub.getByRole('heading', { name: 'Active incidents' })).toHaveCount(0);
    const json = await (await pub.request.get(fresh('/api/status.json'))).json();
    expect(JSON.stringify(json)).not.toContain(TITLE_EN);
    expect((await pub.request.get(fresh(`/incidents/${created.body.result!.id}`))).status()).toBe(404);
    const feed = await (await pub.request.get(fresh('/feed.atom'))).text();
    expect(feed).not.toContain(TITLE_EN);
    await pub.close();
  });
});
