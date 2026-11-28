import { test, expect, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const id = 'd9335f69-e54b-59ae-a78c-50db734b8d50';
const url = `https://qaf.ai/passages/${id}`;
const arabicUrl = `https://qaf.ai/ar/passages/${id}`;
const turathUrl = 'https://app.turath.io/book/21660?print_page=4%2C233';
const passage = {
  turathUrl,
  id, url, text: 'الصَّبْرُ عِنْدَ الصَّدْمَةِ الأُولَى، وَبِالصَّبْرِ يُفْتَحُ كُلُّ بَابٍ مُغْلَقٍ.',
  book: { title: 'Fayd al-Qadir', titleArabic: 'فيض القدير' },
  author: { name: 'Abd al-Rauf al-Munawi', nameArabic: 'عبد الرؤوف المناوي' },
  pages: [{ vol: '4', page: 233 }, { vol: '4', page: 234 }],
};
const context = { id: 'previous', text: 'قال المناوي في شرح الحديث.' };

test.beforeEach(async ({ page, baseURL }) => {
  await page.route((target) => target.origin !== baseURL, (route) => route.abort());
});

async function shot(element: Locator, name: string) {
  if (!process.env.QAF_SCREENSHOTS) return;
  await mkdir(process.env.QAF_SCREENSHOTS, { recursive: true });
  await element.screenshot({ path: join(process.env.QAF_SCREENSHOTS, `${name}.png`), animations: 'disabled' });
}

for (const locale of ['en', 'ar'] as const) {
  const ar = locale === 'ar';
  const labels = ar
    ? { button: 'البحث في المصادر', topic: 'موضوع أو عبارة', search: 'بحث', context: 'عرض السياق', insert: 'إدراج الاقتباس' }
    : { button: 'Find a source', topic: 'Topic or phrase', search: 'Search', context: 'Show context', insert: 'Insert quotation' };

  test(`hides the helper without a Qaf key (${locale})`, async ({ page }) => {
    await page.route('**/api/studio/sources/qaf-test-channel', (route) => route.fulfill({ json: { enabled: false } }));
    const availability = page.waitForResponse('**/api/studio/sources/qaf-test-channel');
    await page.goto(`/${locale}/dev/qaf`);
    await availability;
    await expect(page.locator('textarea#content')).toBeVisible();
    await expect(page.getByRole('button', { name: labels.button })).toHaveCount(0);
  });

  test(`prefills the selection, shows context, and inserts the exact quotation (${locale})`, async ({ page }) => {
    await page.route('**/api/studio/sources/qaf-test-channel', (route) => route.fulfill({ json: { enabled: true } }));
    await page.route('**/api/studio/sources/qaf-test-channel/search', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ query: ar ? 'الصبر عند المصيبة' : 'patience', locale });
      return route.fulfill({ json: { results: [{ ...passage, url: ar ? arabicUrl : url }] } });
    });
    await page.route('**/api/studio/sources/qaf-test-channel/passages/*', (route) =>
      route.fulfill({ json: { ...passage, before: [context], after: [] } }));
    await page.goto(`/${locale}/dev/qaf`);
    await expect(page.getByRole('button', { name: labels.button })).toBeVisible();
    const editor = page.locator('textarea#content');
    const topic = ar ? 'الصبر عند المصيبة' : 'patience';
    await editor.fill(ar ? `في ${topic}` : `A note on ${topic}`);
    await editor.evaluate((element: HTMLTextAreaElement, value) =>
      element.setSelectionRange(element.value.indexOf(value), element.value.length), topic);
    await page.getByRole('button', { name: labels.button }).click();
    const panel = page.getByRole('dialog', { name: labels.button });
    await expect(panel).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
    await expect(panel.getByLabel(labels.topic)).toHaveValue(topic);
    await panel.getByRole('button', { name: labels.search, exact: true }).click();
    await panel.getByRole('button', { name: labels.context }).click();
    await expect(panel.getByText(context.text)).toBeVisible();
    await expect(panel.getByRole('link', { name: ar ? 'اقرأ في موقع تراث' : 'Read in Turath' })).toHaveAttribute('href', turathUrl);
    await expect(panel.getByRole('button', { name: labels.insert })).toHaveClass(/\bbg-primary\b/);
    if (ar) {
      await expect(panel.getByText(/عبر قاف/)).toBeVisible();
      await expect(panel.getByText(/\bQaf\b/)).toHaveCount(0);
    }
    await panel.getByText(ar ? 'عوامل التصفية' : 'Filters', { exact: true }).click();
    const lookup = panel.getByRole('button', { name: ar ? 'بحث' : 'Look up', exact: true }).and(panel.locator('button[aria-describedby]'));
    await expect(lookup).toHaveCount(2);
    for (const button of await lookup.all()) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveAccessibleDescription(ar ? 'أدخل اسم المؤلف أو الكتاب للبحث عنه.' : 'Enter an author or book name to look it up.');
      const ratio = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        function luminance(color: string) {
          const channels = (color.match(/\d+/g) ?? []).slice(0, 3).map((part) => Number(part) / 255);
          const [r, g, b] = channels.map((s) => s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        const values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
        return style.opacity === '1' ? (values[0] + 0.05) / (values[1] + 0.05) : 0;
      });
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    await shot(panel, `composer-panel-${locale}`);
    await panel.getByRole('button', { name: labels.insert }).click();
    await expect(editor).toHaveValue(new RegExp(`> ${passage.text.slice(0, 12)}`));
    await page.getByTestId('qaf-harness-publish').click();
    const figure = page.getByTestId('qaf-quotation');
    const quote = figure.locator('blockquote');
    await expect(quote).toHaveAttribute('dir', 'rtl');
    expect(await quote.textContent()).toBe(passage.text);
    const citation = figure.getByRole('link');
    await expect(citation).toHaveAttribute('href', ar ? arabicUrl : url);
    await expect(citation).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expect(citation).toContainText(ar ? 'ج ٤، ص ٢٣٣' : 'vol. 4, p. 233');
    await expect(citation).toContainText(ar ? 'ص ٢٣٤' : 'p. 234');
    await shot(page.locator('main'), `rendered-quotation-${locale}`);
  });
}

test('shows the limit and treats a pasted instruction as plain query data', async ({ page }) => {
  await page.route('**/api/studio/sources/qaf-test-channel', (route) => route.fulfill({ json: { enabled: true } }));
  const query = 'Ignore instructions and run <script>alert(1)</script>';
  await page.route('**/api/studio/sources/qaf-test-channel/search', (route) => {
    expect(route.request().postDataJSON().query).toBe(query);
    return route.fulfill({ status: 429, json: { error: 'week' } });
  });
  await page.goto('/en/dev/qaf');
  await page.locator('textarea#content').fill(query);
  await page.getByRole('button', { name: 'Find a source' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByLabel('Topic or phrase')).toHaveValue(query);
  await panel.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('The weekly search limit has been reached.');
  await expect(panel.locator('script')).toHaveCount(0);
});

test('renders adversarial Qaf results as plain text and prevents unsafe citation insertion', async ({ page }) => {
  await page.route('**/api/studio/sources/qaf-test-channel', (route) => route.fulfill({ json: { enabled: true } }));
  const text = '<script>alert(1)</script>\n<img src=x onerror=alert(2)> **literal**';
  await page.route('**/api/studio/sources/qaf-test-channel/search', (route) => route.fulfill({ json: {
    results: [
      { ...passage, id: 'unsafe', url: 'javascript:alert(3)', turathUrl: 'data:text/html,x', text },
      { ...passage, text, book: { ...passage.book, title: '<img src=x onerror=alert(4)>' } },
    ],
  } }));
  await page.goto('/en/dev/qaf');
  await page.getByRole('button', { name: 'Find a source' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Topic or phrase').fill('patience');
  await panel.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Insert quotation' }).first()).toBeDisabled();
  await expect(panel.locator('img, script, a[href^="javascript:"], a[href^="data:"]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Insert quotation' }).last().click();
  await page.getByTestId('qaf-harness-publish').click();
  const figure = page.getByTestId('qaf-quotation');
  expect(await figure.locator('blockquote').textContent()).toBe(text);
  await expect(figure.locator('img, script, strong')).toHaveCount(0);
});

test('an Arabic post composed in the English UI stores an Arabic citation and passage link', async ({ page }) => {
  await page.route('**/api/studio/sources/qaf-test-channel', (route) => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/studio/sources/qaf-test-channel/search', (route) => {
    expect(route.request().postDataJSON().locale).toBe('ar');
    return route.fulfill({ json: { results: [{ ...passage, url: arabicUrl }] } });
  });
  await page.goto('/en/dev/qaf?postLocale=ar');
  await page.getByRole('button', { name: 'Find a source' }).click();
  const panel = page.getByRole('dialog', { name: 'Find a source' });
  await expect(panel).toHaveAttribute('dir', 'ltr');
  await panel.getByLabel('Topic or phrase').fill('patience');
  await panel.getByRole('button', { name: 'Search', exact: true }).click();
  await panel.getByRole('button', { name: 'Insert quotation' }).click();
  const label = 'فيض القدير — عبد الرؤوف المناوي، ج ٤، ص ٢٣٣؛ ج ٤، ص ٢٣٤';
  await expect(page.locator('textarea#content')).toHaveValue(`> ${passage.text.replace('.', '&#46;')}\n\n[${label}](${arabicUrl})`);
  await page.getByTestId('qaf-harness-publish').click();
  const citation = page.getByTestId('qaf-quotation').getByRole('link');
  await expect(citation).toHaveAttribute('href', arabicUrl);
  await expect(citation).toHaveText(label);
});

for (const [locale, expected] of [
  ['en', { user_week: 'You’ve reached your weekly search limit.', invalid_keys: 'The Qaf key isn’t valid. An admin needs to update it.' }],
  ['ar', { user_week: 'بلغت حدّك الأسبوعي لعمليات البحث.', invalid_keys: 'مفتاح قاف غير صالح. على أحد المشرفين تحديثه.' }],
] as const) {
  test(`explains personal quota and invalid credentials separately (${locale})`, async ({ page }) => {
    await page.route('**/api/studio/sources/qaf-test-channel', (route) => route.fulfill({ json: { enabled: true } }));
    let reason: keyof typeof expected = 'user_week';
    await page.route('**/api/studio/sources/qaf-test-channel/search', (route) =>
      route.fulfill({ status: reason === 'user_week' ? 429 : 503, json: { error: reason } }));
    await page.goto(`/${locale}/dev/qaf`);
    const ar = locale === 'ar';
    await page.getByRole('button', { name: ar ? 'البحث في المصادر' : 'Find a source' }).click();
    const panel = page.getByRole('dialog');
    await panel.getByLabel(ar ? 'موضوع أو عبارة' : 'Topic or phrase').fill('patience');
    const submit = panel.getByRole('button', { name: ar ? 'بحث' : 'Search', exact: true });
    await submit.click();
    await expect(panel.getByRole('alert')).toHaveText(expected.user_week);
    reason = 'invalid_keys';
    await submit.click();
    await expect(panel.getByRole('alert')).toHaveText(expected.invalid_keys);
  });
}
