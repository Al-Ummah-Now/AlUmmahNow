import type { Page } from '@playwright/test';
import { test, expect, helpers } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';
import { gotoUpload, selectVideo, uploadUi } from './test-utils/upload';
import { chooseThemedOption } from './test-utils/themed-select';
import {
  ARABIC,
  createTemplate,
  deleteTemplateQuietly,
  deleteTemplatesNamed,
  expectDarkSurface,
  listTemplates,
  tempName,
  type TemplateRecord,
} from './test-utils/upload-studio';

/**
 * Upload templates: the settings page /[locale]/settings/upload-defaults
 * (TemplateEditorModal, VariableGuide, card menu) and the TemplateSelector on
 * the upload form. Runs as the multi-channel user so a default template set by
 * a test can never change the single-channel user's upload specs. Every
 * template is created with a unique "E2E Temp" name and deleted afterwards.
 */

test.use({ storageState: AUTH_STATE.multi });

const USER = 'multi' as const;
let name = '';

test.beforeEach(() => {
  name = tempName('tpl');
});

test.afterEach(async () => {
  await deleteTemplatesNamed(USER, name);
});

async function openSettings(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/settings/upload-defaults`);
  await expect(page.getByTestId('upload-defaults-page')).toBeVisible();
  await expect(page.getByTestId('templates-loading')).toHaveCount(0);
}

const card = (page: Page, t: TemplateRecord | string) =>
  typeof t === 'string'
    ? page.getByTestId('template-card').filter({ has: page.getByTestId('template-name').getByText(t, { exact: true }) })
    : page.locator(`[data-testid="template-card"][data-template-id="${t.id}"]`);

/** Opens a card's actions menu from the keyboard (the card's hover transition can keep a pointer click "unstable") */
async function openMenu(c: ReturnType<typeof card>) {
  const button = c.getByTestId('template-menu');
  await expect(button).toBeVisible();
  await button.focus();
  await button.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

async function seedTemplate(extra: Partial<Parameters<typeof createTemplate>[1]> = {}) {
  return createTemplate(USER, {
    name,
    nameLocalized: { en: name, ar: 'قالب اختبار' },
    template: { title: 'Lecture {{year}}', description: 'Weekly lecture', tags: ['e2e', 'lecture'], category: 'islamic_lectures', visibility: 'private', language: 'en' },
    ...extra,
  });
}

test.describe('Upload templates - settings page', () => {
  test('TPL-001 lists the user\'s saved templates with their details', async ({ page }) => {
    const template = await seedTemplate();
    await openSettings(page);

    const c = card(page, template);
    await expect(c).toBeVisible();
    await expect(page.getByTestId('templates-empty')).toHaveCount(0);
    await expect(c.getByTestId('template-name')).toHaveText(name);
    await expect(c.getByTestId('template-category')).toHaveText('Islamic Lectures');
    await expect(c).toContainText('lecture');
    await expect(c).toHaveAttribute('data-default', 'false');
    await expect(c.getByTestId('template-menu')).toHaveAccessibleName('More actions');
  });

  test('TPL-002 creates a template from the editor dialog', async ({ page }) => {
    await openSettings(page);
    await page.getByTestId('template-create').click();

    const dialog = page.getByRole('dialog', { name: 'Create New Template' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Template Name (English)').fill(name);
    await dialog.getByLabel('Template Name (Arabic)').fill('قالب جديد');
    await dialog.getByLabel('Title (English)').fill('Friday khutbah {{date}}');
    await dialog.getByLabel('Tags').fill('khutbah, friday');
    await chooseThemedOption(dialog.getByLabel('Category'), 'khutbah');
    await chooseThemedOption(dialog.getByLabel('Visibility'), 'private');
    await dialog.getByTestId('template-editor-save').click();

    await expect(dialog).toBeHidden();
    await expect(card(page, name)).toBeVisible();
    const stored = (await listTemplates(USER)).find((t) => t.name === name);
    expect(stored?.template).toMatchObject({ title: 'Friday khutbah {{date}}', tags: ['khutbah', 'friday'], category: 'khutbah', visibility: 'private' });
  });

  test('TPL-003 validates required fields and inserts variables without submitting', async ({ page }) => {
    await openSettings(page);
    await page.getByTestId('template-create').click();
    const dialog = page.getByTestId('template-editor');

    await dialog.getByTestId('template-editor-save').click();
    await expect(dialog.getByTestId('template-editor-error')).toHaveText('Template name is required');

    await dialog.getByTestId('template-name-en').fill(name);
    await dialog.getByTestId('template-editor-save').click();
    await expect(dialog.getByTestId('template-editor-error')).toHaveText('Title is required');

    // Expanding the variable guide and inserting a variable must not submit the form
    await dialog.getByTestId('template-title-en').fill('Episode ');
    await dialog.getByTestId('variable-guide-toggle').click();
    await expect(dialog.getByTestId('variable-guide-toggle')).toHaveAttribute('aria-expanded', 'true');
    await dialog.locator('[data-testid="variable-guide-insert"][data-variable="{{episode}}"]').click();
    await expect(dialog.getByTestId('template-title-en')).toHaveValue('Episode {{episode}}');
    await expect(dialog).toBeVisible();
    expect((await listTemplates(USER)).some((t) => t.name === name)).toBe(false);

    // Escape closes the dialog without saving
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect((await listTemplates(USER)).some((t) => t.name === name)).toBe(false);
  });

  test('TPL-004 edits an existing template', async ({ page }) => {
    const template = await seedTemplate();
    await openSettings(page);

    await card(page, template).getByTestId('template-edit').click();
    const dialog = page.getByRole('dialog', { name: 'Edit Template' });
    await expect(dialog.getByTestId('template-name-en')).toHaveValue(name);
    await expect(dialog.getByTestId('template-tags')).toHaveValue('e2e, lecture');
    await expect(dialog.getByTestId('template-visibility')).toHaveValue('private');
    await dialog.getByTestId('template-title-en').fill('Edited lecture {{year}}');
    await dialog.getByTestId('template-editor-save').click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => (await listTemplates(USER)).find((t) => t.id === template.id)?.template.title).toBe('Edited lecture {{year}}');
  });

  test('TPL-005 sets a default template and deletes templates from the card menu', async ({ page }) => {
    const template = await seedTemplate();
    try {
      await openSettings(page);
      const c = card(page, template);
      await openMenu(c);
      await expect(c.getByTestId('template-menu')).toHaveAttribute('aria-expanded', 'true');
      await c.getByRole('menuitem', { name: 'Set as Default' }).click();
      await expect(c).toHaveAttribute('data-default', 'true');
      await expect(c.getByTestId('template-default-badge')).toBeVisible();
      await expect.poll(async () => (await listTemplates(USER)).find((t) => t.id === template.id)?.isDefault).toBe(true);

      // Dismissing the confirmation keeps it
      await openMenu(c);
      await c.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByTestId('template-delete-dialog-cancel').click();
      await expect(c).toBeVisible();

      await openMenu(c);
      await c.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByTestId('template-delete-dialog-confirm').click();
      await expect(c).toHaveCount(0);
      expect((await listTemplates(USER)).some((t) => t.id === template.id)).toBe(false);
    } finally {
      await deleteTemplateQuietly(USER, template.id);
    }
  });

  test('TPL-006 renders the settings page right-to-left with Arabic names (ar)', async ({ page }) => {
    const template = await seedTemplate();
    await openSettings(page, 'ar');

    await expect(page.getByTestId('upload-defaults-page')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ARABIC);
    await expect(card(page, template).getByTestId('template-name')).toHaveText('قالب اختبار');
    await page.getByTestId('template-create').click();
    const dialog = page.getByTestId('template-editor');
    await expect(dialog).toHaveAttribute('dir', 'rtl');
    await expect(dialog.getByTestId('template-name-en')).toHaveAccessibleName(ARABIC);
    await dialog.getByTestId('template-editor-close').click();
    await expect(dialog).toBeHidden();
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('TPL-007 renders template cards and the editor in the dark scheme', async ({ page }) => {
      const template = await seedTemplate();
      await openSettings(page);
      const c = card(page, template);
      await expectDarkSurface(page, c, c.getByTestId('template-name'));
      await page.getByTestId('template-create').click();
      const dialog = page.getByTestId('template-editor');
      await expectDarkSurface(page, dialog, dialog.getByRole('heading', { level: 2 }));
    });
  });
});

test.describe('Upload templates - upload form', () => {
  test('TPL-008 applies a selected template to the upload form', async ({ page }) => {
    const template = await seedTemplate();
    await gotoUpload(page, 'en');
    await selectVideo(page, await helpers.createTestVideo('tpl-008.mp4', 16));
    const ui = uploadUi(page);

    await page.getByTestId('upload-template-select').selectOption(template.id);
    await expect(page.getByTestId('upload-template-applied')).toBeVisible();
    await expect(ui.titleEn).toHaveValue(`Lecture ${new Date().getFullYear()}`);
    await expect(ui.descriptionEn).toHaveValue('Weekly lecture');
    await expect(page.getByTestId('category-select')).toHaveValue('islamic_lectures');
    await expect(ui.isPublic).not.toBeChecked();

    // Back to manual entry keeps the typed values but clears the hint
    await page.getByTestId('upload-template-select').selectOption('');
    await expect(page.getByTestId('upload-template-applied')).toHaveCount(0);
  });

  test('TPL-009 asks for episode values before applying a series template', async ({ page }) => {
    const template = await seedTemplate({ template: { title: 'Seerah episode {{episode}}', visibility: 'public', language: 'en' } });
    await gotoUpload(page, 'en');
    await selectVideo(page, await helpers.createTestVideo('tpl-009.mp4', 16));

    await page.getByTestId('upload-template-select').selectOption(template.id);
    const dialog = page.getByRole('dialog', { name: 'Enter Variable Values' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Episode Number').fill('12');
    await dialog.getByTestId('template-variables-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(uploadUi(page).titleEn).toHaveValue('Seerah episode 12');
  });

  test('TPL-010 pre-selects and applies the default template (ar)', async ({ page }) => {
    const template = await seedTemplate({ isDefault: true });
    try {
      await expect.poll(async () => (await listTemplates(USER)).find((t) => t.id === template.id)?.isDefault).toBe(true);
      await gotoUpload(page, 'ar');
      await selectVideo(page, await helpers.createTestVideo('tpl-010.mp4', 16));

      const select = page.getByTestId('upload-template-select');
      await expect(select).toHaveValue(template.id);
      await expect(select.locator(`option[value="${template.id}"]`)).toContainText('(افتراضي)');
      await expect(select.locator(`option[value="${template.id}"]`)).toContainText('قالب اختبار');
      await uploadUi(page).langTabEn.click();
      await expect(uploadUi(page).titleEn).toHaveValue(`Lecture ${new Date().getFullYear()}`);
    } finally {
      await deleteTemplateQuietly(USER, template.id);
    }
  });
});
