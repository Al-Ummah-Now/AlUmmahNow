import { test, expect } from './support/fixtures';
import { accountControl, chooseLanguage, expectDirection, horizontalOverflow, openMainNav, setPreferences, optionTexts } from './support/ui';
import { storageStatePath } from './support/env';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

const AR_PAGES = [
  { path: '/dashboard', heading: 'لوحة تحكم الإدارة' },
  { path: '/moderation', heading: 'قائمة الإشراف' },
  { path: '/translations', heading: 'إدارة الترجمات' },
  { path: '/indices', heading: 'فهارس المرئيات' },
];

const ENGLISH_UI_STRINGS = ['Dashboard', 'Moderation', 'Translations', 'Log out', 'Language', 'Theme'];

test.describe('language and direction', () => {
  test('I18N-01 the language switcher flips to Arabic RTL and persists', async ({ page }) => {
    await page.goto('/dashboard');
    await expectDirection(page, 'en');
    await chooseLanguage(page, 'ar');
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة تحكم الإدارة');
    await openMainNav(page);
    await expect(page.getByRole('navigation', { name: 'التنقل الرئيسي' }).getByRole('link', { name: 'الإشراف', exact: true })).toBeVisible();

    await page.reload();
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة تحكم الإدارة');

    await chooseLanguage(page, 'en');
    await expectDirection(page, 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admin Dashboard');
  });

  test('I18N-08 the language button keeps the page and its query', async ({ page }) => {
    await page.goto('/dashboard?e2e=lang');
    const toggle = page.getByTestId('language-toggle');
    await toggle.or(page.getByTestId('language-select')).first().waitFor({ state: 'attached' });
    test.skip((await toggle.count()) === 0, 'deployed build before the unified header');
    await expect(toggle).toHaveAttribute('href', '/dashboard?e2e=lang');
    await chooseLanguage(page, 'ar');
    await expect(page).toHaveURL(/\/dashboard\?e2e=lang$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة تحكم الإدارة');
    await chooseLanguage(page, 'en');
    await expect(page).toHaveURL(/\/dashboard\?e2e=lang$/);
  });

  test.describe('Accept-Language', () => {
    test.use({ locale: 'ar-EG' });

    test('I18N-02 Arabic browsers get Arabic by default', async ({ page }) => {
      await page.goto('/dashboard');
      await expectDirection(page, 'ar');
      const toggle = page.getByTestId('language-toggle');
      if (await toggle.isVisible().catch(() => false)) {
        // the header's language button offers the other language, by its own name
        await expect(toggle).toHaveAccessibleName('التبديل إلى الإنجليزية: English');
        await expect(toggle).toHaveAttribute('hreflang', 'en');
      } else {
        await expect(page.getByTestId('language-select')).toHaveValue('ar');
      }
    });
  });

  for (const target of AR_PAGES) {
    test(`I18N-03 ${target.path} is fully translated and laid out RTL`, async ({ page, isMobile }) => {
      await setPreferences(page, { locale: 'ar' });
      await page.goto(target.path);
      await expectDirection(page, 'ar');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(target.heading);
      // The top bar, and the sidebar's text (on phones the closed drawer has no innerText)
      const sidebar = page.getByTestId('admin-sidebar');
      const sidebarText = (await sidebar.count()) ? await sidebar.textContent() : '';
      const navText = `${await page.locator('header').innerText()} ${sidebarText}`;
      for (const english of ENGLISH_UI_STRINGS) {
        expect(navText, `nav should not contain "${english}"`).not.toContain(english);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      if (!isMobile) {
        // Brand sits on the inline-start side, which is the right in RTL
        const brand = await page.getByRole('link', { name: /الأمة الآن/ }).first().boundingBox();
        const logout = await (await accountControl(page)).boundingBox();
        expect(brand!.x).toBeGreaterThan(logout!.x);
      }
    });
  }

  test('I18N-04 report detail and actions are translated', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'ar', reason: 'spam' });
    await setPreferences(page, { locale: 'ar' });
    await page.goto(`/moderation/reports/${report.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تفاصيل البلاغ');
    await expect(page.getByTestId('status-chip')).toHaveText('قيد الانتظار');
    await expect(page.getByTestId('report-details')).toContainText('محتوى مزعج');
    await expect(page.getByTestId('report-id')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByTestId('confirm-action')).toHaveText('اختر إجراءً');
    await page.getByTestId('report-actions').locator('button[data-action="dismissed"]').click();
    await expect(page.getByTestId('confirm-action')).toHaveText('تأكيد: رفض البلاغ');
  });

  test('I18N-05 moderation filters and table headers are translated', async ({ page }) => {
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/moderation');
    await expect(page.getByLabel('الحالة')).toBeVisible();
    await expect(page.getByLabel('نوع المحتوى')).toBeVisible();
    const statuses = await optionTexts(page.getByLabel('الحالة'));
    expect(statuses).toEqual(['كل الحالات', 'قيد الانتظار', 'قيد المراجعة', 'تمت المعالجة', 'مرفوض']);
    const headers = await page.getByRole('columnheader').allTextContents();
    if (headers.length) expect(headers).toEqual(['النوع', 'السبب', 'الحالة', 'التاريخ', 'الإجراءات']);
  });
});

test.describe('public pages in Arabic', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('I18N-06 the login error is translated; unknown pages ask a visitor to sign in', async ({ page }) => {
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/login?error=unauthorized');
    await expectDirection(page, 'ar');
    await expect(page.getByTestId('login-error')).toHaveText('ليست لديك صلاحية الوصول إلى لوحة الإدارة');
    // Every path but /login and /access-denied needs a session (middleware.ts):
    // a signed-out visitor never sees the not-found page, so the admin app
    // does not tell outsiders which routes exist. The request carries no
    // cookies, so we read the redirect itself rather than the auth server's page.
    const res = await page.request.get('/no-such-page', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toMatch(/\/login\?return=%2Fno-such-page$/);
  });
});

test.describe('not found in Arabic', () => {
  test('I18N-06b the not-found page is translated', async ({ page }) => {
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/no-such-page');
    await expectDirection(page, 'ar');
    const main = page.getByRole('main');
    await expect(main.getByTestId('not-found')).toBeVisible();
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('الصفحة غير موجودة');
    // The page's own title is its only h1
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
});

test.describe('access denied in Arabic', () => {
  test.use({ storageState: storageStatePath('nonadmin') });

  test('I18N-07 access denied page is translated', async ({ page }) => {
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/access-denied');
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تم رفض الوصول');
    await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
  });
});

/**
 * The header passes axe (WCAG 2.2 AA) in both languages, in the admin shell and the signed-out
 * shell, with the experimental label-content-name-mismatch rule switched on (WCAG 2.5.3: the
 * language button's visible label is inside its name; docs/design/NAV.md "Header"). .options()
 * replaces the whole options object, so it comes before .withTags() or the tag filter is dropped.
 */
async function expectHeaderAxeClean(page: Page) {
  await expect(page.locator('header.aun-header .aun-brand')).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: { 'label-content-name-mismatch': { enabled: true } } })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .include('header.aun-header')
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

test.describe('header accessibility', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`I18N-09 axe finds no violations in the admin header (${locale})`, async ({ page }) => {
      await setPreferences(page, { locale });
      await page.goto('/dashboard');
      await expectDirection(page, locale);
      await expectHeaderAxeClean(page);
    });
  }
});

test.describe('header accessibility, signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const locale of ['en', 'ar'] as const) {
    test(`I18N-10 axe finds no violations in the signed-out header (${locale})`, async ({ page }) => {
      await setPreferences(page, { locale });
      // The admin's own signed-out page (PublicShell): plain /login goes straight on to the Auth
      // server's sign-in page, another app with its own header and language
      await page.goto('/login?error=auth_failed');
      await expectDirection(page, locale);
      await expect(page.locator('header.aun-header').getByTestId('header-sign-in')).toBeVisible();
      await expectHeaderAxeClean(page);
    });
  }
});
