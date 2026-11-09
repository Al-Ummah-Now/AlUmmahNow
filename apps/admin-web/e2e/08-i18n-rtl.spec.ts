import { test, expect } from './support/fixtures';
import { expectDirection, horizontalOverflow, setPreferences } from './support/ui';
import { storageStatePath } from './support/env';

const AR_PAGES = [
  { path: '/dashboard', heading: 'لوحة تحكم الإدارة' },
  { path: '/moderation', heading: 'قائمة الإشراف' },
  { path: '/translations', heading: 'إدارة الترجمات' },
  { path: '/indices', heading: 'فهارس الفيديو' },
];

const ENGLISH_UI_STRINGS = ['Dashboard', 'Moderation', 'Translations', 'Log out', 'Language', 'Theme'];

test.describe('language and direction', () => {
  test('I18N-01 the language switcher flips to Arabic RTL and persists', async ({ page }) => {
    await page.goto('/dashboard');
    await expectDirection(page, 'en');
    await page.getByTestId('language-select').selectOption('ar');
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة تحكم الإدارة');
    await expect(page.getByRole('navigation', { name: 'التنقل الرئيسي' }).getByRole('link', { name: 'الإشراف', exact: true })).toBeVisible();

    await page.reload();
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة تحكم الإدارة');

    await page.getByTestId('language-select').selectOption('en');
    await expectDirection(page, 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admin Dashboard');
  });

  test.describe('Accept-Language', () => {
    test.use({ locale: 'ar-EG' });

    test('I18N-02 Arabic browsers get Arabic by default', async ({ page }) => {
      await page.goto('/dashboard');
      await expectDirection(page, 'ar');
      await expect(page.getByTestId('language-select')).toHaveValue('ar');
    });
  });

  for (const target of AR_PAGES) {
    test(`I18N-03 ${target.path} is fully translated and laid out RTL`, async ({ page, isMobile }) => {
      await setPreferences(page, { locale: 'ar' });
      await page.goto(target.path);
      await expectDirection(page, 'ar');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(target.heading);
      const navText = await page.locator('header').innerText();
      for (const english of ENGLISH_UI_STRINGS) {
        expect(navText, `nav should not contain "${english}"`).not.toContain(english);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      if (!isMobile) {
        // Brand sits on the inline-start side, which is the right in RTL
        const brand = await page.getByRole('link', { name: /الأمة الآن/ }).first().boundingBox();
        const logout = await page.getByTestId('logout-button').boundingBox();
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
    const statuses = await page.getByLabel('الحالة').locator('option').allTextContents();
    expect(statuses).toEqual(['كل الحالات', 'قيد الانتظار', 'قيد المراجعة', 'تمت المعالجة', 'مرفوض']);
    const headers = await page.getByRole('columnheader').allTextContents();
    if (headers.length) expect(headers).toEqual(['النوع', 'السبب', 'الحالة', 'التاريخ', 'الإجراءات']);
  });
});

test.describe('public pages in Arabic', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('I18N-06 login error and not-found pages are translated', async ({ page }) => {
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/login?error=unauthorized');
    await expectDirection(page, 'ar');
    await expect(page.getByTestId('login-error')).toHaveText('ليست لديك صلاحية الوصول إلى لوحة الإدارة');
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحة غير موجودة');
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
