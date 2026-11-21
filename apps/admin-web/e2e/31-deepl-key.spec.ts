/**
 * The DeepL API key on Caption settings (AUN-CAPTIONS DEEPL-KEY): super admins set, test and remove
 * it; admins see its state; the key is sealed in admin-api and never shown again; the Costs page
 * shows the DeepL line.
 *
 * Local placement only: the stack's fake DeepL (scripts/local-stack/fake-external.ts) answers
 * /v2/usage, so no test ever calls DeepL or spends a character. The key is global state, so the spec
 * runs in the shared-state project; it starts only when no key is set (a key cannot be read back to
 * restore it) and removes its own key at the end, pass or fail.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK, storageStatePath } from './support/env';
import { expectDirection, expectNoAxeViolations, horizontalOverflow, setPreferences } from './support/ui';

interface DeeplKeyView { set: boolean; last4: string | null; plan: 'free' | 'pro' | null; source: string | null; test: { ok: boolean; code: string } | null }

// Shaped like real DeepL keys; the fake answers by the markers (FAKE_DEEPL_REFUSED in fake-external.ts)
const FREE_KEY = `${crypto.randomUUID()}:fx`;
const REFUSED_KEY = `e2erefused-${crypto.randomUUID()}`;
// Shown as the key's own last four: the ":fx" suffix is the plan, not part of what identifies the key
const FREE_LAST4 = FREE_KEY.slice(0, -3).slice(-4);
const superToken = () => readTokens().superadmin;

async function keyState(token = superToken()) {
  const res = await adminApi<{ deeplKey: DeeplKeyView }>('/api/content/captions/deepl-key', { token });
  return { status: res.status, view: res.body.result?.deeplKey };
}

async function removeKey() {
  const state = await keyState();
  if (state.view?.set) expect((await adminApi('/api/content/captions/deepl-key', { method: 'DELETE', token: superToken() })).status, 'own DeepL key removed').toBe(200);
}

let startedEmpty = false;

// One key for the whole file: the admin's view (DEEPL-08) must not overlap the super admin's changes
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!LOCAL_STACK) return;
  const state = await keyState();
  startedEmpty = state.status === 200 && state.view?.set === false;
});

test.afterAll(async () => {
  if (LOCAL_STACK && startedEmpty) await removeKey();
});

function skipUnlessReady() {
  test.skip(!LOCAL_STACK, 'needs the local stack’s fake DeepL (never the real one)');
  test.skip(!startedEmpty, 'a DeepL key is already set here and could not be restored afterwards');
}

test.describe('DeepL key (super admin)', () => {
  test.use({ storageState: storageStatePath('superadmin') });

  test('DEEPL-01 only super admins change the key; admins read its state', async () => {
    skipUnlessReady();
    const admin = readTokens().admin;
    expect((await keyState(admin)).status).toBe(200);
    expect((await adminApi('/api/content/captions/deepl-key', { method: 'PUT', token: admin, body: JSON.stringify({ value: FREE_KEY }) })).status).toBe(403);
    expect((await adminApi('/api/content/captions/deepl-key/test', { method: 'POST', token: admin })).status).toBe(403);
    expect((await adminApi('/api/content/captions/deepl-key', { method: 'DELETE', token: admin })).status).toBe(403);
    expect((await keyState()).view?.set).toBe(false);
  });

  test('DEEPL-02 with no key the DeepL option links to the field; a malformed key never leaves the browser', async ({ page }) => {
    skipUnlessReady();
    await page.goto('/captions-settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Captions & translation' })).toBeVisible();
    const link = page.getByTestId('deepl-no-key-link');
    await expect(link).toHaveText('DeepL API key');
    await link.click();
    await expect(page).toHaveURL(/#deepl-key$/);
    await expect(page.getByTestId('deepl-key')).toHaveAttribute('data-state', 'unset');
    await expect(page.getByTestId('deepl-key-status')).toHaveText('Not set');
    await expect(page.getByTestId('deepl-key-test')).toBeDisabled();
    await expect(page.getByTestId('deepl-key-remove')).toBeDisabled();
    const input = page.getByTestId('deepl-key-input');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await expect(input).toHaveValue('');

    const bad = 'not a deepl key at all, really';
    const sent: string[] = [];
    page.on('request', (r) => {
      if (`${r.url()}\n${r.postData() ?? ''}`.includes(bad)) sent.push(`${r.method()} ${r.url()}`);
    });
    await input.fill(bad);
    await page.getByTestId('deepl-key-save').click();
    await expect(page.getByTestId('deepl-key-error')).toHaveText('A key has no spaces or line breaks.');
    expect(sent, 'no malformed key left the browser').toEqual([]);
  });

  test('DEEPL-03 a Free key is saved sealed, tested with /v2/usage and shown only as its last four characters', async ({ page }) => {
    skipUnlessReady();
    await page.goto('/captions-settings#deepl-key');
    const responses: string[] = [];
    page.on('response', async (r) => {
      if (r.request().method() !== 'GET' && !r.url().includes('/_next/static')) responses.push(await r.text().catch(() => ''));
    });
    await page.getByTestId('deepl-key-input').fill(FREE_KEY);
    await page.getByTestId('deepl-key-save').click();
    await expect(page.getByTestId('deepl-key-feedback-ok')).toHaveText('Key saved. DeepL accepts it.');
    await expect(page.getByTestId('deepl-key-input')).toHaveValue('');
    await expect(page.getByTestId('deepl-key')).toHaveAttribute('data-state', 'set');
    await expect(page.getByTestId('deepl-key-status')).toHaveText(`Set, ending in ${FREE_LAST4}`);
    await expect(page.getByTestId('deepl-key-plan')).toHaveText('DeepL API Free');
    const result = page.getByTestId('deepl-key-test-result');
    await expect(result).toHaveAttribute('data-ok', 'true');
    await expect(result).toContainText('DeepL accepts the key. 1,234 of 500,000 characters used this billing period.');
    await expect(page.getByTestId('deepl-key-set-by')).toContainText('set it on');
    // With a key the hint is the usual one, and the key is nowhere in what the browser received
    await expect(page.getByTestId('deepl-no-key-link')).toHaveCount(0);
    expect(responses.some((body) => body.includes(FREE_KEY)), 'the key never comes back').toBe(false);
    expect(await page.content()).not.toContain(FREE_KEY);

    const view = (await keyState()).view!;
    expect(view).toMatchObject({ set: true, last4: FREE_LAST4, plan: 'free', source: 'admin', test: { ok: true, code: 'ok' } });
    expect(JSON.stringify((await adminApi('/api/content/captions/settings', { token: superToken() })).body)).not.toContain(FREE_KEY);

    await page.reload();
    await page.getByTestId('deepl-key-test').click();
    await expect(page.getByTestId('deepl-key-feedback-ok')).toHaveText('Tested.');
    await expect(page.getByTestId('deepl-key-test-result')).toHaveAttribute('data-code', 'ok');
  });

  test('DEEPL-04 a key DeepL refuses is kept but shows the refusal', async ({ page }) => {
    skipUnlessReady();
    await page.goto('/captions-settings#deepl-key');
    await page.getByTestId('deepl-key-input').fill(REFUSED_KEY);
    await page.getByTestId('deepl-key-save').click();
    await expect(page.getByTestId('deepl-key-feedback-ok')).toHaveText('Key saved, but the test failed. See the result above.');
    await expect(page.getByTestId('deepl-key-plan')).toHaveText('DeepL API Pro');
    // Never a healthy "Set": the pill says DeepL refused it
    await expect(page.getByTestId('deepl-key')).toHaveAttribute('data-state', 'refused');
    await expect(page.getByTestId('deepl-key-status')).toHaveText(`Refused by DeepL, ending in ${REFUSED_KEY.slice(-4)}`);
    const result = page.getByTestId('deepl-key-test-result');
    await expect(result).toHaveAttribute('data-ok', 'false');
    await expect(result).toHaveAttribute('data-code', 'invalid');
    await expect(result).toContainText('DeepL refused the key. It is wrong or was revoked.');
  });

  test('DEEPL-05 the Costs page shows the DeepL line and links to the key', async ({ page }) => {
    skipUnlessReady();
    await page.goto('/costs');
    const panel = page.getByTestId('costs-deepl');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('costs-deepl-plan')).toHaveText('DeepL API Pro');
    await expect(page.getByTestId('costs-deepl-characters')).toHaveText(/^\d/);
    await expect(page.getByTestId('costs-deepl-cost')).toHaveText(/^\$\d+\.\d{2}$/);
    await page.getByTestId('costs-deepl-manage').click();
    await expect(page).toHaveURL(/\/captions-settings#deepl-key$/);
  });

  test('DEEPL-06 Arabic is right to left, fits a phone, and passes axe in both languages', async ({ page }) => {
    skipUnlessReady();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/captions-settings');
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/captions-settings#deepl-key');
    await expectDirection(page, 'ar');
    await expect(page.getByTestId('deepl-key').getByRole('heading', { level: 2 })).toHaveText('مفتاح DeepL API');
    await expect(page.getByTestId('deepl-key-plan')).toHaveText('DeepL API Pro');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page, '/captions-settings (ar)');
    await setPreferences(page, { locale: 'en' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/captions-settings#deepl-key');
    await expectDirection(page, 'en');
    await expectNoAxeViolations(page, '/captions-settings');
  });

  test('DEEPL-07 Remove asks first, then the key is gone and the option links to the field again', async ({ page }) => {
    skipUnlessReady();
    await page.goto('/captions-settings#deepl-key');
    await page.getByTestId('deepl-key-remove').click();
    await expect(page.getByRole('dialog')).toContainText('Remove the DeepL key?');
    await page.getByTestId('deepl-key-remove-confirm').click();
    await expect(page.getByTestId('deepl-key-feedback-ok')).toHaveText('Key removed.');
    await expect(page.getByTestId('deepl-key')).toHaveAttribute('data-state', 'unset');
    await expect(page.getByTestId('deepl-no-key-link')).toBeVisible();
    expect((await keyState()).view?.set).toBe(false);
  });
});

test.describe('DeepL key (admin)', () => {
  test.use({ storageState: storageStatePath('admin') });

  test('DEEPL-08 an admin sees the key’s state but no field to change it', async ({ page }) => {
    skipUnlessReady();
    await page.goto('/captions-settings#deepl-key');
    await expect(page.getByTestId('deepl-key-status')).toHaveText('Not set');
    await expect(page.getByTestId('deepl-key-read-only')).toHaveText('Only super admins can set or change the DeepL key.');
    await expect(page.getByTestId('deepl-key-input')).toHaveCount(0);
    await expect(page.getByTestId('deepl-key-save')).toHaveCount(0);
  });
});
