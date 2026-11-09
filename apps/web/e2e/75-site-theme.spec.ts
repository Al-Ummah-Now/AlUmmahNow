import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';

/** The site theme is in the first HTML, so the page never paints in another theme. */
const THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'];

test.describe('Site theme on first paint', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('THEME-001 the first HTML names the theme, and hydration does not change it', async ({ page, request }) => {
    const html = await (await request.get('/en')).text();
    const served = /<html[^>]*data-theme="(\w+)"/.exec(html)?.[1];
    expect(THEMES).toContain(served);

    const primaries: string[] = [];
    await page.exposeFunction('__recordPrimary', (value: string) => primaries.push(value));
    await page.addInitScript(() => {
      const record = () => {
        const value = getComputedStyle(document.documentElement).getPropertyValue('--fanous-color-primary').trim();
        if (value) (window as unknown as { __recordPrimary(v: string): void }).__recordPrimary(value);
      };
      const tick = () => {
        record();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto('/en', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    expect(new Set(primaries).size).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-theme', served as string);
  });
});
