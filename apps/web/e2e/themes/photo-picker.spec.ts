import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { consentCookie } from '../test-utils/consent';
import { mockApi, waitForApp } from './harness';

/**
 * Change photo (profile edit, channel edit) answers the click, whatever else the page is doing:
 *   - the picker opens within half a second on a CPU four times slower, with one input click, and the
 *     page at rest renders nothing (a render loop is what a late click looks like from inside);
 *   - while a photo uploads, Change still opens the picker (it was disabled until the upload was done),
 *     the new photo shows at once, and a second photo is sent after the first, so the last one wins;
 *   - before the page has hydrated, a click on the server-rendered button opens the picker too.
 * What the operating system does after the picker event (its dialog) is not the page's.
 */
const PAGES = [
  { name: 'profile', path: '/en/profile/edit', photos: ['profile-avatar-upload', 'profile-cover-upload'] },
  { name: 'channel', path: '/en/settings/channel/c1/edit', photos: ['channel-avatar-upload', 'channel-cover-upload'] },
] as const;
const PICKER_MS = 500;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough');
});

interface Counters { commits: number; inputClicks: number }
const counters = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __photo: Counters }).__photo }));

/** A local session of a mock API account (mock-server.mjs CHANNEL_FIXTURES, by token). */
async function signInAs(context: BrowserContext, baseURL: string, who: { userId: string; token: string; channel: string }) {
  const session = {
    activeUserId: who.userId,
    activeChannelId: who.channel,
    accounts: {
      [who.userId]: {
        userId: who.userId, email: 'aisha@example.com', displayName: 'Aisha Rahman', accessToken: who.token, refreshToken: '', lastActivity: Date.now(),
        activeChannelId: who.channel, channels: [{ id: who.channel, name: 'Tafsir Lessons', isMain: true, userId: who.userId, role: 'owner' }],
      },
    },
  };
  await context.addCookies([{ name: 'al_ummah_session', value: encodeURIComponent(JSON.stringify(session)), url: baseURL }, consentCookie(baseURL)]);
}
const OWNER = { userId: 'theme-sweep-user', token: 'c1-owner', channel: 'c1' };

/** Counts React commits and file input clicks from the start. */
async function count(page: Page) {
  await page.addInitScript(() => {
    const c = { commits: 0, inputClicks: 0 };
    Object.assign(window, {
      __photo: c,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        isDisabled: false, supportsFiber: true, renderers: new Map(), inject: () => 1, checkDCE: () => undefined,
        onCommitFiberRoot: () => { c.commits++; }, onCommitFiberUnmount: () => undefined, onPostCommitFiberRoot: () => undefined,
      },
    });
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') c.inputClicks++;
      click.call(this);
    };
  });
}

/** Clicks Change and returns how long the picker took, from the press. */
async function openPicker(page: Page, photo: string, timeout = 5_000): Promise<number> {
  const button = page.getByTestId(`${photo}-change`);
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  const chooser = page.waitForEvent('filechooser', { timeout }).then(() => Date.now());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const pressed = Date.now();
  await page.mouse.down();
  await page.mouse.up();
  return (await chooser) - pressed;
}

async function pickAndApply(page: Page, input: string, kind: 'avatar' | 'cover') {
  await page.locator(input).setInputFiles('e2e/test-fixtures/e2e-thumbnail.jpg');
  const crop = page.getByTestId(`image-crop-dialog-${kind}`);
  await crop.getByTestId('image-crop-apply').click();
  await expect(crop).toBeHidden();
}

for (const { name, path, photos } of PAGES) {
  test(`${name}: the picker opens at once on a slow CPU, and the page is still at rest`, async ({ page, context, baseURL }) => {
    await count(page);
    await signInAs(context, baseURL!, OWNER);
    await mockApi(page);
    await page.goto(path);
    await waitForApp(page);
    await expect(page.getByTestId(`${photos[0]}-change`)).toBeVisible();
    // The last data of the load arrives, then nothing renders by itself
    await expect.poll(async () => {
      const before = (await counters(page)).commits;
      await page.waitForTimeout(3_000);
      return (await counters(page)).commits - before;
    }, { message: 'renders in three seconds at rest', timeout: 30_000 }).toBeLessThanOrEqual(1);

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (const photo of photos) {
      const clicks = (await counters(page)).inputClicks;
      expect(await openPicker(page, photo), `${photo}: press to picker (ms)`).toBeLessThan(PICKER_MS);
      expect((await counters(page)).inputClicks - clicks, `${photo}: one picker per click`).toBe(1);
    }
  });
}

test('channel: Change answers while a photo uploads, and the last photo picked is the one kept', async ({ page, context, baseURL }) => {
  await count(page);
  await signInAs(context, baseURL!, OWNER);
  await mockApi(page);
  const cors = { 'access-control-allow-origin': baseURL!, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization, content-type, channelid', 'access-control-allow-methods': 'PUT' };
  const answers: Array<() => void> = [];
  let sent = 0;
  let open = 0;
  let together = 0;
  await page.route('**/api/channels/c1/avatar', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    sent++;
    open++;
    together = Math.max(together, open);
    await new Promise<void>((resolve) => answers.push(resolve));
    open--;
    return route.fulfill({ status: 200, headers: cors, json: { id: 'c1', name: 'Lectures Channel', avatarUrl: `${baseURL}/avatar.png?photo=${sent}`, coverUrl: '' } });
  });
  await page.goto('/en/settings/channel/c1/edit');
  await waitForApp(page);
  const preview = page.getByTestId('channel-avatar-image');
  await expect(page.getByTestId('channel-avatar-upload-change')).toBeVisible();

  await pickAndApply(page, '#avatarPhotoInput', 'avatar');
  await expect.poll(() => sent).toBe(1);
  await expect(preview).toHaveAttribute('src', /^blob:/);
  expect(await openPicker(page, 'channel-avatar-upload'), 'press to picker during the upload (ms)').toBeLessThan(PICKER_MS * 2);

  // A second photo meanwhile: shown, and sent once the first is done
  const first = await preview.getAttribute('src');
  await pickAndApply(page, '#avatarPhotoInput', 'avatar');
  await expect(preview).not.toHaveAttribute('src', first!);
  expect(sent).toBe(1);
  answers[0]();
  await expect.poll(() => sent).toBe(2);
  await expect(preview).toHaveAttribute('src', /^blob:/);
  answers[1]();
  await expect(preview).toHaveAttribute('src', /photo=2$/);
  expect(together, 'uploads running at the same time').toBe(1);
});

test('profile: Change opens the picker before the page has hydrated', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, OWNER);
  await mockApi(page);
  let release = () => undefined as void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/_next/static/chunks/**', async (route) => {
    await held;
    await route.continue().catch(() => undefined);
  });
  await page.goto('/en/profile/edit', { waitUntil: 'commit' });
  await expect(page.getByTestId('profile-avatar-upload-change')).toBeVisible({ timeout: 60_000 });
  expect(await openPicker(page, 'profile-avatar-upload'), 'press to picker before hydration (ms)').toBeLessThan(PICKER_MS * 2);
  release();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/**
 * Updating the session's channel cache never renders the page again: the page stream an action's
 * cookie starts was cut off by leaving after Save, and Firefox showed the error screen
 * ("TypeError: Error in input stream", prod 2026-11-25).
 */
test('the channel cache is refreshed without rendering the page again', async ({ page, context, baseURL }) => {
  await mockApi(page);
  // The session holds one of the account's channels; the live list has more
  await signInAs(context, baseURL!, { userId: 'nav-a', token: 'nav-aisha', channel: 'a1' });
  const rendered: string[] = [];
  let refreshed = 0;
  page.on('response', (res) => {
    if (res.headers()['x-action-revalidated']) rendered.push(res.request().headers()['next-action'] ?? res.url());
    if (res.url().endsWith('/api/session/channels') && res.ok()) refreshed++;
  });
  await page.goto('/en/about');
  await waitForApp(page);
  await expect.poll(() => refreshed, { message: 'the session is refreshed', timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => {
    const cookies = (await context.cookies()).filter((c) => c.name.startsWith('al_ummah_session')).sort((a, b) => a.name.localeCompare(b.name));
    return decodeURIComponent(cookies.map((c) => c.value).join('')).includes('"id":"a2"');
  }, { message: 'the cookie holds the live channels' }).toBe(true);
  expect(rendered, 'server actions that rendered the page again').toEqual([]);
});
