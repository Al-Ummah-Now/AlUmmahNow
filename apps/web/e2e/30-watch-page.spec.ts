import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE, readAccount } from './test-utils/auth-state';
import { SEED_TITLES, ensureSeedVideos, type E2EVideo } from './test-utils/e2e-videos';
import { apiCall, fetchVideo, qaLecture, qaVideoForProject, tempName, watchUrl, type QaVideo, type WatchRoute } from './test-utils/watch-page';
import { clickAndWaitForURL } from './test-utils/qa-content';

/**
 * Watch page (/[locale]/video/[id] and the legacy /[locale]/video?vid=):
 * title, channel, metrics, reactions, save-to-playlist, report, owner edit
 * link, related videos, not-found state, RTL and dark theme.
 *
 * Player controls live in 31-video-player.spec.ts, comments in 32-comments.
 */

const ROUTES: WatchRoute[] = ['id', 'legacy'];

async function openWatch(page: Page, video: { id: string }, locale: 'en' | 'ar' = 'en', route: WatchRoute = 'id') {
  await page.goto(watchUrl(video.id, locale, route));
  await expect(page.getByTestId('video-metrics')).toBeVisible({ timeout: 45000 });
}

test.describe('watch page - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  for (const route of ROUTES) {
    test(`WATCH-001 shows title, channel, player and metrics (en, ${route} route)`, async ({ page, request }) => {
      const video = await qaLecture(request, 1);
      await openWatch(page, video, 'en', route);

      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
      await expect(page.getByRole('heading', { level: 1, name: video.titleLocalized?.en || video.title })).toBeVisible();
      await expect(page.locator('#video-player .video-js, #video-player [data-testid="video-error"]').first()).toBeAttached();
      await expect(page.getByTestId('video-metrics-views')).toHaveText(/\d+(\.\d)?[KM]? views?/);
      const channelLink = page.locator('main a[href*="/en/channels/"]').filter({ hasText: /\S/ }).first();
      await expect(channelLink).toBeVisible();
      // Skip-link targets exist on both routes
      await expect(page.locator('main#main-content')).toHaveCount(1);
      await expect(page.locator('#comments')).toHaveCount(1);
    });

    test(`WATCH-002 renders the Arabic RTL watch page (ar, ${route} route)`, async ({ page, request }) => {
      const video = await qaLecture(request, 1);
      await openWatch(page, video, 'ar', route);

      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      const arTitle = video.titleLocalized?.ar || video.title;
      await expect(page.getByRole('heading', { level: 1, name: arTitle })).toBeVisible();
      await expect(page.getByTestId('video-metrics-views')).toHaveText(/مشاهد/);
      await expect(page.getByTestId('video-metrics')).toHaveAccessibleName('إحصائيات الفيديو');
      await expect(page.getByRole('heading', { name: /ذات الصلة/ }).first()).toBeAttached();
    });
  }

  test('WATCH-003 legacy route without a video id shows the select-a-video prompt (en + ar)', async ({ page }) => {
    await page.goto('/en/video');
    await expect(page.getByRole('heading', { level: 1, name: 'No Video Selected' })).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);

    await page.goto('/ar/video');
    await expect(page.getByRole('heading', { level: 1, name: 'لم يتم اختيار فيديو' })).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
  });

  for (const [locale, heading, description] of [
    ['en', 'Video not found', /does not exist/],
    ['ar', 'الفيديو غير موجود', /غير موجود/],
  ] as const) {
    test(`WATCH-004 unknown video id shows a "video not found" state (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}/video/00000000-0000-4000-8000-000000000000`);
      const notFound = page.getByTestId('video-not-found');
      await expect(notFound).toBeVisible();
      await expect(notFound.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(notFound.getByRole('alert')).toContainText(description);
      await expect(notFound).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByTestId('video-metrics')).toHaveCount(0);
      await expect(page.locator('video')).toHaveCount(0);
      await expect(notFound.getByRole('link')).toHaveAttribute('href', `/${locale}`);
    });
  }

  test('WATCH-005 anonymous viewers cannot react, save or report', async ({ page, request }) => {
    const video = await qaLecture(request, 1);
    await openWatch(page, video);

    for (const id of ['video-like-button', 'video-dislike-button']) {
      const button = page.getByTestId(id);
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(button).toHaveAccessibleDescription(/sign in/i);
    }
    await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Report$/ })).toHaveCount(0);
    await expect(page.getByTestId('video-owner-edit-link')).toHaveCount(0);
  });

  test('WATCH-006 related videos exclude the current video and open another watch page', async ({ page, request, isMobile }) => {
    const video = await qaLecture(request, 1);
    await openWatch(page, video);

    // Desktop shows the sidebar list, mobile the list under the comments (the other copy is display:none)
    const related = page.getByTestId('related-video').locator('visible=true');
    await expect(related.first()).toBeVisible();
    const hrefs = await related.evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs, 'current video is not listed as related').not.toContain(`/en/video?vid=${video.id}`);

    const box = await related.first().boundingBox();
    const player = await page.locator('#video-player').boundingBox();
    expect(box && player).toBeTruthy();
    if (isMobile) {
      expect(box!.y, 'mobile: related list sits below the player').toBeGreaterThan(player!.y + player!.height);
    } else {
      expect(box!.x, 'desktop: related list is a sidebar next to the player').toBeGreaterThan(player!.x + player!.width - 1);
    }

    // Open a related QA seed video (other agents' temporary videos come and go):
    // its watch page shows that video's title
    const link = related.filter({ has: page.getByRole('heading', { level: 3, name: /^QA (Lecture|Nasheed) / }) }).first();
    const title = (await link.getByRole('heading', { level: 3 }).innerText()).trim();
    const id = (await link.getAttribute('href'))!.split('vid=')[1];
    await clickAndWaitForURL(page, link, new RegExp(`/en/video\\?vid=${id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.getByTestId('video-metrics')).toBeVisible();
  });
});

test.describe('watch page - dark theme', () => {
  test.use({ storageState: ANONYMOUS_STATE, colorScheme: 'dark' });

  for (const locale of ['en', 'ar'] as const) {
    test(`WATCH-007 follows the dark colour scheme (${locale})`, async ({ page, request }) => {
      const video = await qaLecture(request, 1);
      await openWatch(page, video, locale);
      await expect(page.locator('html')).toHaveClass(/dark/);
      const heading = page.getByRole('heading', { level: 1 }).first();
      const color = await heading.evaluate((el) => getComputedStyle(el).color);
      // Title text is light on the dark background
      const [r, g, b] = color.match(/\d+/g)!.map(Number);
      expect((r + g + b) / 3, `title colour ${color}`).toBeGreaterThan(180);
    });
  }
});

test.describe('watch page - reactions (signed in)', () => {
  // The multi-channel user reacts as its active (main) channel
  test.use({ storageState: AUTH_STATE.multi });
  test.describe.configure({ mode: 'serial' });

  let video: QaVideo;

  /** Removes any like/dislike this account left on the video (as its channels or itself) */
  async function clearReactions(request: Parameters<typeof qaLecture>[0]) {
    const account = readAccount('multi');
    const ids = [...account.channels.map((c) => c.id), account.userId];
    for (const channelId of ids) {
      await apiCall(request, 'DELETE', `/api/videos/${video.id}/likes`, { token: account.accessToken, channelId });
      await apiCall(request, 'DELETE', `/api/videos/${video.id}/dislikes`, { token: account.accessToken, channelId });
    }
  }

  test.beforeAll(async ({ request }, testInfo) => {
    // One video per project: projects run in parallel with the same account
    video = await qaVideoForProject(request, testInfo.project.name);
  });
  test.beforeEach(async ({ request }) => clearReactions(request));
  test.afterEach(async ({ request }) => clearReactions(request));

  test('WATCH-008 like toggles on and off and updates the count', async ({ page }) => {
    await openWatch(page, video);
    const like = page.getByTestId('video-like-button');
    await expect(like).toBeEnabled();
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    const before = Number(await like.locator('span').innerText());

    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toHaveAccessibleName(`Remove like ${before + 1}`);
    // Wait for the request to settle (the button is disabled while it runs)
    await expect(like).toBeEnabled();
    await expect(like).toHaveAttribute('aria-pressed', 'true');

    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(like).toHaveAccessibleName(`Like this video ${before}`);
  });

  test('WATCH-009 a like is stored for the active channel and restored after reload', async ({ page, request }) => {
    const account = readAccount('multi');
    const channelIds = account.channels.map((c) => c.id);
    await openWatch(page, video);
    const like = page.getByTestId('video-like-button');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toBeEnabled();

    await expect
      .poll(async () => (await fetchVideo(request, video.id)).likes?.some((l) => l.userId === account.userId && channelIds.includes(l.channelId ?? '')), {
        message: 'like recorded as one of the account\'s channels (not as the user id)',
      })
      .toBe(true);

    await page.reload();
    await expect(page.getByTestId('video-like-button')).toHaveAttribute('aria-pressed', 'true');
  });

  test('WATCH-010 switching from like to dislike moves the reaction', async ({ page }) => {
    await openWatch(page, video);
    const like = page.getByTestId('video-like-button');
    const dislike = page.getByTestId('video-dislike-button');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toBeEnabled();

    await dislike.click();
    await expect(dislike).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(dislike).toHaveAccessibleName(/^Remove dislike \d/);
    await expect(dislike).toBeEnabled();

    await dislike.click();
    await expect(dislike).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('watch page - report (signed in, not the owner)', () => {
  test.use({ storageState: AUTH_STATE.single });

  for (const [locale, report, title, close, spam] of [
    ['en', 'Report', 'Report Content', 'Close', 'Spam or Misleading'],
    ['ar', 'إبلاغ', 'الإبلاغ عن محتوى', 'إغلاق', 'بريد مزعج أو مضلل'],
  ] as const) {
    test(`WATCH-011 report dialog opens, requires a reason and closes without reporting (${locale})`, async ({ page, request }) => {
      const video = await qaLecture(request, 1);
      await openWatch(page, video, locale);

      // Report lives in the action row's "More actions" menu
      const more = page.getByTestId('watch-more-button');
      await expect(more).toHaveAttribute('aria-haspopup', 'menu');
      await more.click();
      const reportItem = page.getByRole('menuitem', { name: report, exact: true });
      await expect(reportItem).toHaveAttribute('data-testid', 'watch-more-report');
      await reportItem.click();
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(video.titleLocalized?.[locale] || video.title);

      // Submitting needs a reason: the submit button stays disabled until one is chosen
      const submit = dialog.locator('button[type="submit"]');
      await expect(submit).toBeDisabled();
      // The reason is a themed select: #report-reason is its trigger button, the native
      // select behind it is hidden. Pick the reason from the menu the way a viewer does.
      const reason = dialog.locator('#report-reason');
      await reason.click();
      const option = page.getByRole('menuitemradio', { name: spam, exact: true });
      await expect(option).toBeVisible();
      await option.click();
      await expect(reason).toContainText(spam);
      await expect(dialog.locator('select.tsf-native')).toHaveValue('spam');
      await expect(submit).toBeEnabled();

      await dialog.getByRole('button', { name: close }).first().click();
      await expect(dialog).toBeHidden();
    });
  }
});

test.describe('watch page - owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  let seed: Record<string, E2EVideo> = {};
  test.beforeAll(async () => {
    test.setTimeout(180000);
    seed = await ensureSeedVideos('single');
  });

  for (const route of ROUTES) {
    test(`WATCH-012 owner sees the edit link and no report button (${route} route)`, async ({ page }) => {
      const video = seed[SEED_TITLES.singleVideo];
      await openWatch(page, video, 'en', route);

      const edit = page.getByTestId('video-owner-edit-link');
      await expect(edit).toBeVisible();
      await expect(edit).toHaveText('Edit Video');
      await expect(page.getByRole('button', { name: 'Report', exact: true })).toHaveCount(0);

      await clickAndWaitForURL(page, edit, new RegExp(`/en/video/${video.id}/edit$`));
    });
  }

  test('WATCH-013 owner edit link is translated on the Arabic page', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openWatch(page, video, 'ar');
    await expect(page.getByTestId('video-owner-edit-link')).toHaveText('تعديل الفيديو');
    await expect(page.getByTestId('video-owner-edit-link')).toHaveAttribute('href', `/ar/video/${video.id}/edit`);
  });
});

test.describe('watch page - save to playlist', () => {
  test.use({ storageState: AUTH_STATE.single });

  const created: string[] = [];

  test.afterEach(async ({ request }) => {
    const account = readAccount('single');
    const channelId = account.channels.find((c) => c.isMain)?.id ?? account.channels[0]?.id;
    for (const id of created.splice(0)) {
      await apiCall(request, 'DELETE', `/api/playlists/${id}`, { token: account.accessToken, channelId });
    }
  });

  for (const [locale, save, dialogName, create, added] of [
    ['en', 'Save', 'Save to playlist', 'Create and add', 'Added to'],
    ['ar', 'حفظ', 'حفظ في قائمة تشغيل', 'إنشاء وإضافة', 'تمت الإضافة إلى'],
  ] as const) {
    test(`WATCH-014 creates a playlist with the video from the save dialog (${locale})`, async ({ page, request }) => {
      const video = await qaLecture(request, 1);
      await openWatch(page, video, locale);

      const trigger = page.getByRole('button', { name: save, exact: true });
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const dialog = page.getByRole('dialog', { name: dialogName });
      await expect(dialog).toBeVisible();

      const name = tempName('Watch Playlist');
      await dialog.getByRole('textbox').fill(name);
      const createResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.status() < 500);
      await dialog.getByRole('button', { name: create }).click();
      await createResponse.catch(() => undefined);

      await expect(dialog.getByRole('status')).toHaveText(`${added} ${name}`);
      const row = dialog.locator('label').filter({ hasText: name });
      await expect(row.getByRole('checkbox')).toBeChecked();

      // Record the playlist for cleanup and check the video really is in it
      const account = readAccount('single');
      const channelId = account.channels.find((c) => c.isMain)?.id ?? account.channels[0]?.id;
      const res = await apiCall(request, 'GET', `/api/playlists?channelId=${channelId}&limit=50`, { token: account.accessToken, channelId });
      const body = (await res.json()) as { data?: Array<{ id: string; name?: string; title?: string; videos?: string[] }>; result?: { data?: Array<{ id: string; name?: string; title?: string; videos?: string[] }> } };
      const playlist = (body.data ?? body.result?.data ?? []).find((p) => (p.name || p.title) === name);
      expect(playlist, 'created playlist is stored').toBeTruthy();
      created.push(playlist!.id);
      expect(playlist!.videos).toContain(video.id);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  }
});
