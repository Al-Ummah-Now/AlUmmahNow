/**
 * Release regressions for the core web experience (Epic 29): auth pages follow
 * the site language (#293), unknown channels keep their config (#297), live
 * comments reach signed-out viewers (#301), and the library, notifications,
 * explore and search pages work at phone width in Arabic.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { target } from './targets';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';
import { apiFetch, createProfile, signUpOnWeb, startSignIn, type Locale } from './web-session';

const PHONE = { width: 390, height: 844 };

/** Answers the consent banner up front so it cannot cover the page's controls. */
async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([
    { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
  ]);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);
}

test.describe('Release: auth pages follow the site language', () => {
  for (const [locale, dir] of [['en', 'ltr'], ['ar', 'rtl']] as const) {
    test(`sign-in and register open in ${locale}`, async ({ page }) => {
      await startSignIn(page, locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);

      await page.click('a[href*="register"]');
      await expect(page.locator('input[name="repeat"]')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
    });
  }
});

test.describe('Release: unknown channel page', () => {
  for (const [locale, path] of [['en', '/channels/none'], ['ar', '/c/none']] as const) {
    test(`stays a clean 404 (${locale}${path})`, async ({ page }) => {
      const wrongOrigin: string[] = [];
      const web = target().web;
      page.on('request', (request) => {
        if (/\/api\/(notifications|i18n)\//.test(request.url()) && request.url().startsWith(web)) wrongOrigin.push(request.url());
      });
      page.on('websocket', (socket) => {
        if (socket.url().includes(new URL(web).host)) wrongOrigin.push(socket.url());
      });

      const response = await page.goto(`${web}/${locale}${path}`);
      expect(response?.status()).toBe(404);
      await page.waitForLoadState('load');
      await page.waitForTimeout(4000);
      expect(wrongOrigin, `calls on the web origin: ${wrongOrigin.join(', ')}`).toEqual([]);
    });
  }
});

test.describe('Release: live comments', () => {
  test('a new comment reaches a signed-out viewer without a reload', async ({ page, browser, context }) => {
    const video = await findPlayableVideo();
    test.skip(!video, NO_PLAYABLE_VIDEO);

    await answerConsent(context);
    const author = await signUpOnWeb(page, 'rel-live-comment');
    await createProfile(author);
    await page.goto(watchUrl(video!.id));

    const viewerContext = await browser.newContext();
    await answerConsent(viewerContext);
    const viewer = await viewerContext.newPage();
    const subscribed = new Promise<void>((resolve) => {
      viewer.on('websocket', (socket) => {
        socket.on('framereceived', (frame) => {
          if (String(frame.payload).includes(`"video:${video!.id}"`) && String(frame.payload).includes('subscribed')) resolve();
        });
      });
    });
    await viewer.goto(watchUrl(video!.id));
    await subscribed;

    const text = `release live comment ${Date.now()}`;
    const section = page.getByTestId('comments-section');
    await section.getByTestId('comment-input').fill(text);
    await section.getByTestId('comment-submit').click();

    await expect(viewer.getByTestId('comment').filter({ hasText: text }).first()).toBeVisible({ timeout: 20000 });
    await viewerContext.close();

    const list = await apiFetch(author, `/api/videos/${video!.id}/comments?limit=20`);
    const body = (await list.json()) as { result?: { comments?: Array<{ id: string; text: string }> } };
    const mine = body.result?.comments?.find((c) => c.text === text);
    if (mine) await apiFetch(author, `/api/videos/${video!.id}/comments/${mine.id}`, { method: 'DELETE' });
  });
});

test.describe('Release: Arabic at phone width', () => {
  test.use({ viewport: PHONE });

  test('watch later reaches the library, and notifications opens', async ({ page, context }) => {
    const video = await findPlayableVideo();
    test.skip(!video, NO_PLAYABLE_VIDEO);

    await answerConsent(context);
    const user = await signUpOnWeb(page, 'rel-library', 'ar');
    await createProfile(user);

    await page.goto(watchUrl(video!.id, 'ar'));
    await page.getByTestId('watch-later-button').first().click();
    await expect
      .poll(async () => {
        const res = await apiFetch(user, '/api/library/watch-later?limit=50');
        return res.ok ? JSON.stringify(await res.json()).includes(video!.id) : false;
      }, { timeout: 15000 })
      .toBe(true);

    await page.goto(`${target().web}/ar/library/watch-later`);
    await expect(page.locator(`[data-testid="library-list-item"][data-video-id="${video!.id}"]`)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoSidewaysScroll(page);

    await page.goto(`${target().web}/ar/notifications`);
    await expect(page.getByTestId('notifications-page')).toHaveAttribute('dir', 'rtl');
    await expectNoSidewaysScroll(page);
  });

  for (const [name, path, testId] of [
    ['explore', '/explore', 'explore-page'],
    ['search', '/search?q=%D8%A7%D9%84%D8%A7%D9%85%D8%A9', 'search-page'],
  ] as const) {
    test(`${name} renders right to left without sideways scroll`, async ({ page, context }) => {
      await answerConsent(context);
      const locale: Locale = 'ar';
      await page.goto(`${target().web}/${locale}${path}`);
      await expect(page.getByTestId(testId)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectNoSidewaysScroll(page);
    });
  }
});
