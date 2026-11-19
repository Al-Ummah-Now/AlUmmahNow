/**
 * Remote config (issue #413), on the local stack:
 * - admin-api /api/app-config needs settings:manage (invalid token 401, moderator 403);
 * - a rule with a problem shows it next to its field and nothing is saved;
 * - a new flag rule saves through admin-api, survives a reload, lists who saved it in the history,
 *   and "Try it" (the drafts evaluated by api-videos) reports the flag on for the build it targets
 *   and off for another platform;
 * - a document saved elsewhere meanwhile is never overwritten: Save answers with a conflict and
 *   "Load the latest" shows the other change.
 *
 * The documents are global, so the spec runs in the shared-state project and puts `flags` back
 * exactly as it found it.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { ADMIN_WEB_URL, RUN_TAG, storageStatePath } from './support/env';
import { pickOption } from './support/ui';

/** Local stack only (placement.ts): on a deployed target this would change what every app build gets. */
const LOCAL_STACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ADMIN_WEB_URL);
const superToken = () => readTokens().superadmin;

let original: unknown = null;
const tag = `${RUN_TAG}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
const flagKey = `e2e.flag-${tag}`.slice(0, 64);

async function flags(): Promise<unknown> {
  const { status, body } = await adminApi<{ value: unknown }>('/api/app-config/flags', { token: superToken() });
  expect(status, 'GET /api/app-config/flags').toBe(200);
  return body.result!.value;
}

async function putFlags(value: unknown) {
  return adminApi('/api/app-config/flags', { method: 'PUT', token: superToken(), body: JSON.stringify({ value }) });
}

test.use({ storageState: storageStatePath('superadmin') });

test.describe('remote config', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK, 'local stack only: changes the remote config every app build reads');
    original = await flags();
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK) return;
    // A namespace that never had the document reads as null; an empty rule list behaves the same
    const { status } = await putFlags(original ?? []);
    expect(status, 'flags restored').toBe(200);
  });

  test('APPCFG-01 the API needs settings:manage', async () => {
    expect((await adminApi('/api/app-config/flags', { token: 'invalid' })).status).toBe(401);
    expect((await adminApi('/api/app-config/flags', { token: readTokens().moderator })).status).toBe(403);
    expect((await adminApi('/api/app-config/nope', { token: superToken() })).status).toBe(404);
  });

  test('APPCFG-02 a problem shows next to its field and nothing is saved', async ({ page }) => {
    await page.goto('/app-config');
    await expect(page.getByTestId('app-config-panel')).toHaveAttribute('data-document', 'flags');
    await page.getByTestId('app-config-add-flags').click();
    const rule = page.getByTestId('app-config-rule').last();
    await rule.getByTestId('app-config-rule-key').fill('Not A Key');
    await rule.getByTestId('app-config-rule-rollout').fill('150');
    await page.getByTestId('app-config-save').click();
    await expect(page.getByTestId('app-config-notice')).toHaveAttribute('data-tone', 'error');
    await expect(rule.getByTestId('app-config-problem')).toHaveCount(2);
    await expect(rule.getByTestId('app-config-rule-key')).toHaveAttribute('aria-invalid', 'true');
    expect(await flags(), 'nothing written').toEqual(original);
  });

  test('APPCFG-03 a new flag saves, is audited, and "Try it" evaluates it', async ({ page }) => {
    await page.goto('/app-config');
    await page.getByTestId('app-config-add-flags').click();
    const rule = page.getByTestId('app-config-rule').last();
    await rule.getByTestId('app-config-rule-key').fill(flagKey);
    await rule.getByTestId('app-config-rule-platforms-ios').check();
    await rule.getByTestId('app-config-rule-minVersion').fill('2.0.0');
    await rule.getByTestId('app-config-rule-value').fill('true');
    await expect(page.getByTestId('app-config-preview-json')).toContainText(flagKey);

    // Try it before saving: the drafts decide, not what is stored
    const dry = page.getByTestId('app-config-dry-run');
    await pickOption(dry.getByTestId('app-config-dry-platform'), 'ios');
    await dry.getByTestId('app-config-dry-version').fill('2.1.0');
    await dry.getByTestId('app-config-dry-run-submit').click();
    await expect(dry.locator(`[data-testid="app-config-dry-flags"] [data-key="${flagKey}"] dd`)).toHaveAttribute('data-value', 'true');
    await pickOption(dry.getByTestId('app-config-dry-platform'), 'android');
    await dry.getByTestId('app-config-dry-run-submit').click();
    await expect(dry.locator(`[data-testid="app-config-dry-flags"] [data-key="${flagKey}"] dd`)).toHaveAttribute('data-value', 'false');

    await page.getByTestId('app-config-save').click();
    await expect(page.getByTestId('app-config-notice')).toHaveAttribute('data-tone', 'ok');
    const stored = (await flags()) as { key: string; platforms?: string[]; minVersion?: string; value?: unknown }[];
    expect(stored.find((r) => r.key === flagKey)).toMatchObject({ key: flagKey, enabled: true, platforms: ['ios'], minVersion: '2.0.0', value: true });

    await page.reload();
    await expect(page.locator(`[data-testid="app-config-rule"][data-key="${flagKey}"]`)).toHaveCount(1);
    const history = page.getByTestId('app-config-history-entry').first();
    await expect(history).toBeVisible();
    // Names instead of ids (#745): the link names the admin, the id is only its title
    await expect(history.locator('a')).not.toHaveText(/^usr_|^[0-9a-f-]{36}$/);
  });

  test('APPCFG-04 a change saved elsewhere is never overwritten', async ({ page }) => {
    await page.goto('/app-config');
    const mine = page.locator(`[data-testid="app-config-rule"][data-key="${flagKey}"]`);
    await expect(mine).toHaveCount(1);
    // Someone else turns the flag off meanwhile
    const current = (await flags()) as { key: string; enabled: boolean }[];
    expect((await putFlags(current.map((r) => (r.key === flagKey ? { ...r, enabled: false } : r)))).status).toBe(200);

    await page.getByTestId('app-config-add-flags').click();
    await page.getByTestId('app-config-rule').last().getByTestId('app-config-rule-key').fill(`${flagKey}-b`.slice(0, 64));
    await page.getByTestId('app-config-save').click();
    await expect(page.getByTestId('app-config-notice')).toHaveAttribute('data-tone', 'conflict');
    expect(((await flags()) as { key: string }[]).some((r) => r.key === `${flagKey}-b`.slice(0, 64)), 'the stale save wrote nothing').toBe(false);

    await page.getByTestId('app-config-load-latest').click();
    await expect(page.getByTestId('app-config-notice')).toHaveCount(0);
    await expect(page.getByTestId('app-config-rule')).toHaveCount(current.length);
    if (!(await mine.getByTestId('app-config-rule-enabled').isVisible())) await mine.getByTestId('app-config-rule-toggle').click();
    await expect(mine.getByTestId('app-config-rule-enabled')).not.toBeChecked();
  });
});
