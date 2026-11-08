import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE, readAccount } from './test-utils/auth-state';
import { createTestFile } from './test-utils/upload';
import { openAccountMenu } from './test-utils/navigation';

/**
 * Profile pages: /profile, /profile/create, /profile/edit.
 *
 * Edits run as the no-channel user and are always reverted: the original
 * profile is read through the API before the test and written back after.
 */

const API_URL = process.env.API_URL || 'https://videos.api.qa.alummahnow.net';

type ApiProfile = Record<string, unknown> & {
  displayName?: string;
  displayNameLocalized?: Record<string, string>;
  bio?: string;
  bioLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
};

function authHeaders() {
  return { Authorization: `Bearer ${readAccount('none').accessToken}`, 'Content-Type': 'application/json' };
}

async function getProfile(): Promise<ApiProfile> {
  const res = await fetch(`${API_URL}/api/profile`, { headers: authHeaders() });
  expect(res.ok).toBe(true);
  const body = (await res.json()) as ApiProfile & { result?: { profile?: ApiProfile }; profile?: ApiProfile };
  const profile = body.result?.profile ?? body.profile ?? (body.id ? body : undefined);
  expect(profile).toBeTruthy();
  return profile!;
}

/** Writes back the editable fields of a profile snapshot */
async function restoreProfile(original: ApiProfile) {
  // The API merges the body into the stored profile, so fields that were
  // unset originally are cleared explicitly ('' / {}) instead of omitted
  const strings = ['firstName', 'lastName', 'displayName', 'bio', 'avatarUrl', 'coverUrl', 'timezone'];
  const records = ['firstNameLocalized', 'lastNameLocalized', 'displayNameLocalized', 'bioLocalized'];
  const body: Record<string, unknown> = {};
  for (const f of strings) body[f] = original[f] ?? '';
  for (const f of records) body[f] = original[f] ?? {};
  const res = await fetch(`${API_URL}/api/profile`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  expect(res.ok, `restore profile: ${res.status}`).toBe(true);
}

/** Waits for the edit form to be filled from the stored profile */
async function openEditForm(page: Page, stored: ApiProfile, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/profile/edit`);
  const firstName = page.locator('input[name="firstNameEn"]');
  await expect(firstName).toBeVisible();
  const local = (v: unknown) => (v as Record<string, string> | undefined)?.en;
  await expect(firstName).toHaveValue(local(stored.firstNameLocalized) || (stored.firstName as string) || '');
  await expect(page.locator('input[name="displayNameEn"]')).toHaveValue(local(stored.displayNameLocalized) || stored.displayName || '');
  // The timezone is only set once the profile has loaded
  await expect(page.locator('#profile-timezone')).toHaveValue((stored.timezone as string) || /.+/);
  return firstName;
}

test.describe('Profile - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  for (const path of ['profile', 'profile/edit']) {
    test(`PROF-001 /${path} asks anonymous visitors to sign in`, async ({ page }) => {
      await page.goto(`/en/${path}`);
      const prompt = page.getByTestId('sign-in-prompt');
      await expect(prompt.getByRole('heading', { level: 1, name: 'Sign in to see your profile' })).toBeVisible();
      await expect(prompt.getByRole('button', { name: 'Sign In' })).toBeVisible();
      // No editable profile for nobody
      await expect(page.getByTestId('profile-edit-button')).toHaveCount(0);
      await expect(page.locator('input[name="firstNameEn"]')).toHaveCount(0);
    });
  }

  test('PROF-002 Arabic sign-in prompt is RTL', async ({ page }) => {
    await page.goto('/ar/profile');
    const prompt = page.getByTestId('sign-in-prompt');
    await expect(prompt).toHaveAttribute('dir', 'rtl');
    await expect(prompt.getByRole('heading', { name: 'سجّل الدخول لعرض ملفك الشخصي' })).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'تسجيل الدخول' })).toBeVisible();
  });

  test('PROF-003 the sign-in button starts the OAuth flow', async ({ page }) => {
    await page.goto('/en/profile/create');
    await page.getByRole('button', { name: 'Sign In' }).last().click();
    await expect(page).toHaveURL(/auth\.qa\.alummahnow\.net|\/authorize/, { timeout: 30000 });
  });
});

test.describe('Profile - view', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('PROF-010 shows the name, photos and channel section', async ({ page }) => {
    await page.goto('/en/profile');
    await expect(page.getByTestId('profile-heading')).not.toBeEmpty();
    await expect(page.locator('.cover-photo')).toBeVisible();
    await expect(page.locator('.profile-photo')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My Channels' })).toBeVisible();
    await expect(page.getByText(readAccount('single').channels[0].name!).first()).toBeVisible();
  });

  test('PROF-011 Edit opens the edit form', async ({ page }) => {
    await page.goto('/en/profile');
    await page.getByTestId('profile-edit-button').click();
    await expect(page).toHaveURL(/\/en\/profile\/edit$/);
    await expect(page.locator('input[name="firstNameEn"]')).toBeVisible();
  });

  test('PROF-012 Arabic profile places the edit button on the left (RTL)', async ({ page }) => {
    await page.goto('/ar/profile');
    const edit = page.getByTestId('profile-edit-button');
    await expect(edit).toHaveText(/تعديل/);
    const cover = await page.locator('.cover-photo').boundingBox();
    const box = await edit.boundingBox();
    expect(box!.x - cover!.x).toBeLessThan(cover!.width / 2);
  });
});

test.describe('Profile - create', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('PROF-020 a user who already has a profile is sent home from /profile/create', async ({ page }) => {
    await page.goto('/en/profile/create');
    await expect(page).toHaveURL(/\/en\/?$/);
    await expect(page.locator('input[name="firstNameEn"]')).toHaveCount(0);
  });

  test('PROF-021 Arabic create page also redirects to the Arabic home', async ({ page }) => {
    await page.goto('/ar/profile/create');
    await expect(page).toHaveURL(/\/ar\/?$/);
  });
});

test.describe('Profile - edit', () => {
  test.use({ storageState: AUTH_STATE.none });
  // One test at a time edits this user's profile
  test.describe.configure({ mode: 'serial' });

  let original: ApiProfile;
  test.beforeEach(async () => {
    original = await getProfile();
  });
  test.afterEach(async () => {
    if (original) await restoreProfile(original);
  });

  test('PROF-030 form is prefilled; email is read-only', async ({ page }) => {
    await openEditForm(page, original);
    const email = page.locator('input[name="email"]');
    await expect(email).toHaveValue(readAccount('none').email);
    await expect(email).toHaveAttribute('readonly', '');
  });

  test('PROF-031 saves display name and bio in both languages (then reverts)', async ({ page }) => {
    const suffix = Math.random().toString(36).slice(2, 8);
    await openEditForm(page, original);
    await page.locator('input[name="displayNameEn"]').fill(`E2E Temp Name ${suffix}`);
    await page.locator('textarea[name="bioEn"]').fill(`E2E Temp bio ${suffix}`);
    await page.getByRole('button', { name: /^(Arabic|العربية)$/ }).click();
    await page.locator('input[name="displayNameAr"]').fill(`اسم مؤقت ${suffix}`);
    await expect(page.locator('textarea[name="bioAr"]')).toHaveAttribute('dir', 'rtl');
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('form button[type="submit"]')).toHaveText(/Saved!/);

    const saved = await getProfile();
    expect(saved.displayNameLocalized?.en).toBe(`E2E Temp Name ${suffix}`);
    expect(saved.displayNameLocalized?.ar).toBe(`اسم مؤقت ${suffix}`);
    expect(saved.bioLocalized?.en).toBe(`E2E Temp bio ${suffix}`);

    // The header account card shows the new display name
    await page.goto('/en');
    const menu = await openAccountMenu(page);
    await expect(menu.getByTestId('nav-active-context')).toContainText(`E2E Temp Name ${suffix}`);
  });

  test('PROF-032 Cancel leaves without saving', async ({ page }) => {
    await openEditForm(page, original);
    await page.locator('input[name="displayNameEn"]').fill('E2E Temp unsaved');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/en\/?$/);
    const after = await getProfile();
    expect(after.displayName).toBe(original.displayName);
  });

  test('PROF-033 photo controls open an image picker (keyboard too)', async ({ page }) => {
    await openEditForm(page, original);
    const avatar = page.getByTestId('profile-avatar-upload');
    const cover = page.getByTestId('profile-cover-upload');
    await expect(avatar).toHaveAccessibleName('Click to change avatar');
    await expect(cover).toHaveAccessibleName('Click to change cover');
    await expect(page.locator('#profilePhotoInput')).toHaveAttribute('accept', 'image/*');
    await expect(page.locator('#coverPhotoInput')).toHaveAttribute('accept', 'image/*');

    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), cover.click()]);
    expect(chooser.isMultiple()).toBe(false);
    await avatar.focus();
    const [keyboardChooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
    expect(keyboardChooser).toBeTruthy();
  });

  test('PROF-034 uploading a profile photo updates the avatar (then reverts)', async ({ page }) => {
    await openEditForm(page, original);
    const image = await createTestFile('e2e-avatar.png', 1);
    // A real PNG is needed: write a 1x1 image over the zero-filled file
    const fs = await import('fs');
    fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    await page.locator('#profilePhotoInput').setInputFiles(image);
    // The picked photo is positioned in the crop dialog first; Apply uploads it
    const crop = page.getByTestId('image-crop-dialog-avatar');
    await expect(crop).toBeVisible();
    await expect(crop.getByTestId('image-crop-apply')).toBeEnabled();
    await crop.getByTestId('image-crop-apply').click();
    await expect(crop).toBeHidden();

    await expect.poll(async () => (await getProfile()).avatarUrl, { timeout: 60000 }).not.toBe(original.avatarUrl);
    const updated = (await getProfile()).avatarUrl!;
    await expect(page.getByTestId('profile-avatar-upload')).toHaveAttribute('style', new RegExp(updated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('PROF-035 Arabic edit page is RTL with Arabic labels', async ({ page }) => {
    await openEditForm(page, original, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'تعديل الملف الشخصي' })).toBeVisible();
    // The cover badge sits on the left in RTL (logical "end")
    const cover = await page.getByTestId('profile-cover-upload').boundingBox();
    const badge = await page.getByTestId('profile-cover-upload').locator('> div').first().boundingBox();
    expect(badge!.x - cover!.x).toBeLessThan(cover!.width / 2);
  });
});

test.describe('Profile - dark theme', () => {
  test.use({ storageState: AUTH_STATE.single, colorScheme: 'dark' });

  test('PROF-040 edit form inputs are readable in dark mode', async ({ page }) => {
    await openEditFormFor(page);
    const input = page.locator('input[name="firstNameEn"]');
    const { color, bg } = await input.evaluate((el) => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    expect(color).not.toBe(bg);
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  });
});

async function openEditFormFor(page: Page) {
  await page.goto('/en/profile/edit');
  await expect(page.locator('input[name="firstNameEn"]')).toBeVisible();
}
