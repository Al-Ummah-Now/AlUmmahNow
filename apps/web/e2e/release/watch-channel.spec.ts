/**
 * Release regression: the channel row under the watch-page title. It holds the
 * channel avatar, the name linking to the channel page, the subscriber count and
 * Subscribe at every width from 320 to 1920, in English and Arabic. Signed out,
 * Subscribe starts sign-in and comes back to the video; signed in it toggles
 * Subscribe / Subscribed and the count follows. On prod (v2026.11.09.5) the row
 * had no count at all (the theme hid it) and Subscribe sent signed-out viewers
 * to the home page.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { target } from './targets';
import { watchUrl } from './videos';
import { apiFetch, createProfile, signUpOnWeb, type Locale } from './web-session';

// The signed-in test registers through the auth server: its trace would hold
// the typed password and email code. Trace off for the file.
test.use({ trace: 'off' });

const WIDTHS = [320, 375, 768, 1000, 1280, 1920];
const LOCALES: Locale[] = ['en', 'ar'];
const SUBSCRIBE: Record<Locale, string> = { en: 'Subscribe', ar: 'اشترك' };
const SUBSCRIBED: Record<Locale, string> = { en: 'Subscribed', ar: 'مشترك' };

interface ChannelVideo {
  id: string;
  channelId: string;
}

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

/** A public video that belongs to a channel (legacy imports have channelId null and no Subscribe). */
async function findChannelVideo(): Promise<ChannelVideo | null> {
  const res = await fetch(`${target().api}/api/videos?limit=100`);
  expect(res.ok, `GET /api/videos answered ${res.status}`).toBe(true);
  const body = (await res.json()) as { data?: Array<{ id: string; channelId?: string | null; isPublic?: boolean }> };
  const video = (body.data ?? []).find((v) => !!v.channelId && v.isPublic !== false);
  return video ? { id: video.id, channelId: video.channelId as string } : null;
}

/** Subscribe in the channel row, by role and name: a link signed out, a toggle button signed in. */
function subscribeIn(page: Page, locale: Locale) {
  const row = page.getByTestId('watch-channel').or(page.locator('.watch-channel')).first();
  const name = new RegExp(`^(${SUBSCRIBE[locale]}|${SUBSCRIBED[locale]})$`);
  return row.getByRole('link', { name }).or(row.getByRole('button', { name })).first();
}

async function subscriberCount(channelId: string): Promise<number> {
  const res = await fetch(`${target().api}/api/channels/${channelId}/subscriptions/status`);
  expect(res.ok, `GET subscriptions/status answered ${res.status}`).toBe(true);
  return ((await res.json()) as { result: { subscriberCount: number } }).result.subscriberCount;
}

/** The number in the count line ("1 subscriber", "No subscribers", "٣ مشتركين" → 1, 0, 3). */
async function shownCount(page: Page): Promise<number> {
  const count = page.getByTestId('watch-subscriber-count');
  if (!(await count.isVisible())) return NaN;
  const text = (await count.innerText()).trim();
  if (!text) return NaN; // still loading: the line holds a placeholder
  const digits = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/\d+/);
  if (digits) return Number(digits[0]);
  if (/^(No subscribers|لا يوجد مشتركون)$/.test(text)) return 0;
  if (/^مشترك واحد$/.test(text)) return 1;
  if (/^مشتركان$/.test(text)) return 2;
  throw new Error(`unreadable subscriber count "${text}"`);
}

/** Avatar, name, count and Subscribe are all on screen, inside the row, and nothing overlaps or scrolls sideways. */
async function expectFullRow(page: Page, width: number, locale: Locale): Promise<void> {
  const row = page.getByTestId('watch-channel');
  const parts = {
    avatar: row.locator('.watch-avatar'),
    name: row.getByTestId('watch-channel-link'),
    count: row.getByTestId('watch-subscriber-count'),
    subscribe: subscribeIn(page, locale),
  };
  for (const [part, locator] of Object.entries(parts)) {
    await expect(locator, `${part} at ${width}px`).toBeVisible();
    const box = (await locator.boundingBox())!;
    expect(box.width, `${part} has no width at ${width}px`).toBeGreaterThan(0);
    expect(box.x, `${part} starts off screen at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${part} ends off screen at ${width}px`).toBeLessThanOrEqual(width + 0.5);
  }
  const name = (await parts.name.boundingBox())!;
  const button = (await parts.subscribe.boundingBox())!;
  const apart = name.x + name.width <= button.x + 0.5 || button.x + button.width <= name.x + 0.5 || name.y + name.height <= button.y + 0.5;
  expect(apart, `the name and Subscribe overlap at ${width}px`).toBe(true);
  expect(button.height, `Subscribe is a small tap target at ${width}px`).toBeGreaterThanOrEqual(36);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
}

test.describe('Release: watch-page channel row', () => {
  for (const locale of LOCALES) {
    test(`signed out (${locale}): avatar, channel link, count and Subscribe at every width; Subscribe starts sign-in`, async ({ page, context }) => {
      const video = await findChannelVideo();
      test.skip(!video, 'no public video with a channel in this environment');
      await answerConsent(context);
      const count = await subscriberCount(video!.channelId);

      await page.setViewportSize({ width: WIDTHS[0], height: 900 });
      await page.goto(watchUrl(video!.id, locale));
      const subscribe = subscribeIn(page, locale);
      await expect(subscribe).toBeVisible({ timeout: 30000 });
      // Disabled while the session loads; enabled once the viewer is known to be signed out
      await expect(subscribe).toBeEnabled({ timeout: 30000 });
      await expect(subscribe).toHaveText(SUBSCRIBE[locale]);
      await expect(page.getByTestId('watch-channel-link')).toHaveAttribute('href', `/${locale}/channels/${video!.channelId}`);
      await expect.poll(() => shownCount(page), { message: 'the count is not the channel\'s subscriber count' }).toBe(count);

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await expectFullRow(page, width, locale);
      }

      // The auth server keeps the request in a flow and answers /authorize with a
      // redirect to /password/authorize?auth_flow=..., so the page that loads no
      // longer carries redirect_uri: read it from the /authorize request itself.
      const authorize = page.waitForRequest((r) => r.url().startsWith(`${target().auth}/authorize?`), { timeout: 30000 });
      await subscribe.click();
      const authorizeUrl = new URL((await authorize).url());
      expect(authorizeUrl.searchParams.get('redirect_uri'), 'sign-in does not come back to this site').toBe(`${target().web}/api/callback`);
      await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
      const back = (await context.cookies(target().web)).find((c) => c.name === 'auth_return');
      expect(back?.value && decodeURIComponent(back.value), 'sign-in does not return to the video').toBe(`/${locale}/video/${video!.id}`);
      // The auth server only accepts the environment's own callback, not a local WEB_APP_URL
      if (!process.env.WEB_APP_URL) await expect(page.locator('input[name="email"], a[href*="register"]').first()).toBeVisible();
    });
  }

  test('signed in: Subscribe toggles to Subscribed and back, and the count follows', async ({ page, context }) => {
    const video = await findChannelVideo();
    test.skip(!video, 'no public video with a channel in this environment');
    await answerConsent(context);
    await page.setViewportSize({ width: 1000, height: 900 });
    const user = await signUpOnWeb(page, 'rel-watch-subscribe', 'ar');
    await createProfile(user);

    // Subscriptions are made by a channel: create it the way users do (account
    // menu), which puts it in the web session.
    const channelName = `Release E2E sub ${Date.now().toString(36)}`;
    await page.goto(`${target().web}/ar`);
    await page.getByTestId('nav-menu-trigger').click();
    const switchChannel = page.getByTestId('nav-switch-channel');
    await switchChannel.or(page.getByTestId('nav-create-channel')).first().waitFor();
    if (await switchChannel.isVisible()) await switchChannel.click();
    await page.getByTestId('nav-create-channel').click();
    const nameInput = page.locator('[role="menu"] input[type="text"]').first();
    await nameInput.fill(channelName);
    await nameInput.press('Enter');
    await expect(nameInput).toBeHidden({ timeout: 30000 });
    await expect
      .poll(async () => {
        const res = await apiFetch(user, '/api/channels?limit=100');
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ name: string }> };
        return body.data?.some((c) => c.name === channelName) ?? false;
      }, { message: 'the channel created in the account menu is not in GET /api/channels', timeout: 30000 })
      .toBe(true);

    const before = await subscriberCount(video!.channelId);
    await page.goto(watchUrl(video!.id, 'ar'));
    const subscribe = subscribeIn(page, 'ar');
    await expect(subscribe).toHaveText(SUBSCRIBE.ar, { timeout: 30000 });
    await expect(subscribe).toHaveAttribute('aria-pressed', 'false');
    await expect(subscribe).toBeEnabled();
    await expect.poll(() => shownCount(page)).toBe(before);
    await expectFullRow(page, 1000, 'ar');

    await subscribe.click();
    await expect(subscribe).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
    await expect(subscribe).toHaveText(SUBSCRIBED.ar);
    await expect.poll(() => shownCount(page)).toBe(before + 1);
    expect(await subscriberCount(video!.channelId), 'the API does not count the new subscription').toBe(before + 1);

    // Still subscribed after a reload (the status comes from the API, not local state)
    await page.reload();
    await expect(subscribe).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });

    await subscribe.click();
    await expect(subscribe).toHaveAttribute('aria-pressed', 'false', { timeout: 30000 });
    await expect(subscribe).toHaveText(SUBSCRIBE.ar);
    await expect.poll(() => shownCount(page)).toBe(before);
  });
});
