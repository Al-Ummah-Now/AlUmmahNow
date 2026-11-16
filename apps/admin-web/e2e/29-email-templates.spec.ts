/**
 * Settings › Emails › Creator invite (wiki "Email templates"): the API needs emails:manage; an admin
 * edits the wording in en + ar (placeholder chip, a broken placeholder blocks Save), the live preview
 * follows (language, dark mail app, phone width), "Send test to me" sends the Arabic version, Save
 * makes a new version with Undo, and History restores an earlier version. en and ar (rtl), axe clean.
 *
 * The template is one shared row, so this spec runs on the local stack only, one test at a time,
 * and puts the row and its history back exactly as they were (stack SQL) even when a step fails.
 * Its wording carries no run marker; the audit rows it makes are removed by the run teardown.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK } from './support/env';
import { stackSql } from './support/local-stack';
import { expectDirection, expectNoAxeViolations, setPreferences, waitForHydration } from './support/ui';

const REPORTS_D1 = 'al-ummah-now-reports';
const BUTTON_EN = 'Join the site now';
const BUTTON_AR = 'انضم الآن';

interface Snapshot { version: number; content: string; updated_at: string; updated_by: string }
let snapshot: Snapshot | null = null;

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function restoreSnapshot() {
  if (!snapshot) return;
  await stackSql(
    REPORTS_D1,
    `UPDATE email_templates SET version = ${snapshot.version}, content = ${sqlText(snapshot.content)}, updated_at = ${sqlText(snapshot.updated_at)}, updated_by = ${sqlText(snapshot.updated_by)} WHERE key = 'creator_invite'`,
  );
  await stackSql(REPORTS_D1, `DELETE FROM email_template_versions WHERE key = 'creator_invite' AND version > ${snapshot.version}`);
}

test.describe('email templates', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!LOCAL_STACK, 'changes a shared setting: local stack only');

  test.beforeAll(async () => {
    const rows = await stackSql<Snapshot>(REPORTS_D1, "SELECT version, content, updated_at, updated_by FROM email_templates WHERE key = 'creator_invite'");
    snapshot = rows[0] ?? null;
  });
  test.afterEach(restoreSnapshot);

  test('EMAILS-01 the API needs Super Admin or Admin: invalid token 401, moderator 403', async () => {
    expect((await adminApi('/api/email-templates/creator_invite', { token: 'invalid' })).status).toBe(401);
    expect((await adminApi('/api/email-templates/creator_invite', { token: readTokens().moderator })).status).toBe(403);
    const ok = await adminApi<{ version: number }>('/api/email-templates/creator_invite');
    expect(ok.status).toBe(200);
  });

  test('EMAILS-02 edit both languages, placeholders checked, preview follows, test sent, save with Undo', async ({ page }) => {
    await page.goto('/settings/emails');
    await expect(page.getByRole('heading', { level: 1, name: 'Emails' })).toBeVisible();
    await page.getByTestId('emails-edit-creator_invite').click();
    await expect(page).toHaveURL(/\/settings\/emails\/creator-invite$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Creator invite' })).toBeVisible();

    const button = page.getByTestId('email-field-button-en');
    await waitForHydration(button);
    await button.fill(BUTTON_EN);
    await page.getByTestId('email-field-button-ar').fill(BUTTON_AR);
    await expect(page.getByTestId('email-field-button-ar')).toHaveAttribute('dir', 'rtl');

    // A dropped placeholder blocks Save; the chip puts it back at the caret
    const greeting = page.getByTestId('email-field-greeting-en');
    await greeting.fill('Hello there,');
    await expect(page.getByTestId('email-template-issues')).toBeVisible();
    await expect(page.getByTestId('email-template-save')).toBeDisabled();
    await greeting.click();
    await greeting.press('End');
    await greeting.press('ArrowLeft');
    await page.getByTestId('email-field-greeting-chip-name').click();
    await expect(greeting).toHaveValue('Hello there{name},');
    await greeting.fill('Hello {name},');
    await expect(page.getByTestId('email-template-issues')).toHaveCount(0);

    // Live preview: the unsaved English button, then Arabic in a dark mail app at phone width
    const frame = page.frameLocator('[data-testid="email-preview-frame"]');
    await page.getByTestId('email-preview-lang-en').click();
    await expect(frame.getByText(BUTTON_EN)).toBeVisible();
    await expect(page.getByTestId('email-preview-subject')).toHaveText("You're invited to Al Ummah Now");
    await page.getByTestId('email-preview-lang-ar').click();
    await page.getByTestId('email-preview-mode-dark').click();
    await page.getByTestId('email-preview-width-phone').click();
    await expect(frame.getByText(BUTTON_AR)).toBeVisible();
    await expect(frame.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('email-preview-frame')).toHaveAttribute('data-mode', 'dark');
    await expect(page.getByTestId('email-preview-frame')).toHaveCSS('width', '375px');

    // Send test to me: the Arabic version, marked as a test, audited
    await page.getByTestId('email-test-send').click();
    await expect(page.getByTestId('email-test-status')).toContainText('Test sent to');
    await expectNoAxeViolations(page, 'creator invite editor (en)');

    // Save: a new version, then Undo goes back to the version before
    const before = (await adminApi<{ version: number }>('/api/email-templates/creator_invite')).body.result!.version;
    await page.getByTestId('email-template-save').click();
    await expect(page.getByTestId('email-template-version')).toContainText(`Version ${before + 1}`);
    const saved = await adminApi<{ version: number; content: { copy: { en: Record<string, string>; ar: Record<string, string> } } }>('/api/email-templates/creator_invite');
    expect(saved.body.result!.content.copy.en.button).toBe(BUTTON_EN);
    expect(saved.body.result!.content.copy.ar.button).toBe(BUTTON_AR);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('email-template-version')).toContainText(`Version ${before + 2}`);
    await expect(page.getByTestId('email-field-button-en')).not.toHaveValue(BUTTON_EN);

    const audit = await adminApi<{ items: { action: string }[] }>('/api/audit?limit=20');
    const actions = (audit.body.result?.items ?? []).map((i) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['email_template.saved', 'email_template.undone', 'email_template.test_sent']));
  });

  test('EMAILS-03 History restores an earlier version (ar, rtl), with Undo', async ({ page }) => {
    const current = (await adminApi<{ version: number; content: { copy: { en: Record<string, string>; ar: Record<string, string> }; defaultVideos: unknown } }>('/api/email-templates/creator_invite')).body.result!;
    const changed = structuredClone(current.content);
    changed.copy.ar.button = BUTTON_AR;
    const save = await adminApi<{ version: number }>('/api/email-templates/creator_invite', { method: 'PUT', body: JSON.stringify({ baseVersion: current.version, content: changed }) });
    expect(save.status).toBe(200);

    await setPreferences(page, { locale: 'ar' });
    await page.goto('/settings/emails/creator-invite');
    await expectDirection(page, 'ar');
    await waitForHydration(page.getByTestId('email-field-button-ar'));
    await expect(page.getByTestId('email-field-button-ar')).toHaveValue(BUTTON_AR);
    await page.getByTestId(`email-history-restore-${current.version}`).click();
    await expect(page.getByTestId('email-field-button-ar')).toHaveValue(current.content.copy.ar.button!);
    await expect(page.getByTestId(`email-history-${current.version + 2}`)).toBeVisible();
    await expectNoAxeViolations(page, 'creator invite editor (ar)');
    const after = (await adminApi<{ version: number; content: typeof current.content }>('/api/email-templates/creator_invite')).body.result!;
    expect(after.version).toBe(current.version + 2);
    expect(after.content.copy.ar.button).toBe(current.content.copy.ar.button);
  });
});
