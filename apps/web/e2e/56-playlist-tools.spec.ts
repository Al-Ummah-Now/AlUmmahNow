import { test as fixturesTest, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { expectRtl, fillStable, keyboardMoveDown, playlistToolsDeployed, pointerDrag } from './test-utils/channel-content';
import { ns, useOwnData, type CreatedVideo, type Creator } from './release/builders';
import { apiFetch, expectHydrated } from './release/web-session';

/**
 * Adding videos to playlists (owner, 2026-11-10: "how do you add videos to a
 * playlist?"), from every place it can happen:
 *
 * - Manage Playlists › New playlist: name, order, and videos picked from the
 *   channel, created in one go
 * - Manage Playlists › a playlist: add with the picker, reorder (keyboard
 *   drag and Move buttons), automatic order, remove
 * - Studio Content › Videos (Video Management moved there, 3883fa94): the
 *   selection's "Add to playlist", to an existing playlist or a new one
 * - (owner, 2026-11-11) names in English and Arabic; a manual order set right
 *   in the create form (drag, Alt+arrows, Move buttons) and saved; "Add to
 *   playlist" from a selection searches the channel's playlists (autocomplete,
 *   several at once) and appends to a manual playlist; its New playlist has no
 *   video picker; the dialog's edge is one continuous border
 *
 * UI that lands with a pull request skips, with a reason, until the target
 * runs it (E2E on a pull request may test the deployed site).
 *
 * Own data (release/builders.ts): a creator with one channel and three
 * private videos (not waited on: the tools list videos still processing too),
 * made for this spec and deleted afterwards. Playlists made through the UI are
 * registered with the scope as soon as their id is known, and a sweep of the
 * channel's playlists runs at cleanup in case a test failed before that.
 *
 * Listing a channel's playlists scans the whole bucket on QA (#909, about 13 s),
 * so the waits on those lists are longer than the default.
 */

const data = useOwnData(fixturesTest);
let owner: Creator;

// One worker runs this file's tests in order: its afterAll deletes the creators' channels, so a
// worker must not come back to this file afterwards with the (worker-scoped) creators still set
fixturesTest.describe.configure({ mode: 'default' });

/**
 * The file's creators, made in a worker fixture rather than beforeAll: Playwright resolves a context
 * option such as storageState before beforeAll runs, so a creator made there was undefined in
 * test.use (every signed-in test failed with "reading 'state'"). Deleted by the file's DataScope.
 */
const test = fixturesTest.extend<object, { creators: { owner: Creator } }>({
  creators: [
    async ({ browser }, use) => {
      owner = await data.createCreator(browser, 'plt');
      await use({ owner });
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});
let channelId: string;
let videos: CreatedVideo[] = [];
/** A unique title prefix (the three videos end in A, B and C, their order by title) */
const tag = () => `E2E PLT ${ns()} ${Date.now().toString(36)}`;
/** #909: GET /api/playlists?channelId= scans every playlist on QA */
const PLAYLIST_LIST_MS = 60000;

interface PlaylistRecord { id: string; title: string; titleLocalized?: Record<string, string>; videos: string[]; sortMode?: string; sortField?: string; sortDirection?: string; isPublic?: boolean }

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await apiFetch(owner.user, path, {
    method,
    headers: { 'Content-Type': 'application/json', channelId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

async function stored(id: string): Promise<PlaylistRecord> {
  const { status, body } = await api<PlaylistRecord & { result?: PlaylistRecord }>('GET', `/api/playlists/${id}`);
  expect(status, `GET /api/playlists/${id}`).toBe(200);
  return body.result ?? body;
}

/** A playlist made through the UI: deleted with the rest of the spec's data */
function adopt(id: string) {
  data.onCleanup(`playlist ${id}`, () => api('DELETE', `/api/playlists/${id}`));
}

/** The picker row of a video (searched by its title) */
async function pick(scope: Locator, video: CreatedVideo) {
  await fillStable(scope.getByTestId('picker-search'), video.title);
  // The search is an autocomplete: close its suggestions so they don't cover the grid
  await scope.getByTestId('picker-search').press('Escape');
  const row = scope.locator(`[data-testid="picker-video"][data-video-id="${video.id}"]`);
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.getByRole('checkbox').check();
  await expect(row).toHaveAttribute('data-selected', 'true');
}

/**
 * Opens Studio's video list on the tab the videos are in now (Processing until
 * they are encoded, then Published) and waits for their select boxes
 */
async function openStudioWith(page: Page, wanted: CreatedVideo[], locale: 'en' | 'ar' = 'en') {
  const select = (video: CreatedVideo) => page.locator(`[data-testid="studio-video-select"][data-video-id="${video.id}"]`);
  await expect(async () => {
    const { body } = await api<{ uploadStatus?: string }>('GET', `/api/videos/${wanted[0].id}`);
    const status = body.uploadStatus && body.uploadStatus !== 'ready' ? 'processing' : 'published';
    await page.goto(`/${locale}/studio/${channelId}/content/videos?status=${status}`);
    await expect(page.getByTestId('studio-videos-loading')).toHaveCount(0, { timeout: 20000 });
    for (const video of wanted) await expect(select(video)).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 90000 });
  for (const video of wanted) await expectHydrated(select(video));
  return select;
}

/** The create form's order list (manual order before saving) */
const createOrder = (scope: Locator | Page) => scope.getByTestId('create-order-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-video-id')));

/** English and Arabic name fields (owner, 2026-11-11); skips while the target still has one Name field */
async function skipUntilBilingualForm(scope: Locator | Page) {
  const english = scope.getByRole('textbox', { name: 'Name (English)' });
  await expect(english.or(scope.getByRole('textbox', { name: 'Name', exact: true })).first()).toBeVisible({ timeout: 20000 });
  test.skip(!(await english.isVisible()), 'Bilingual playlist names and ordering in the create form are not deployed on the target yet (they land with the PR that adds them)');
}

/** The search-and-pick "Add to playlist" dialog (owner, 2026-11-11); skips while the target has the old list */
async function skipUntilSearchDialog(dialog: Locator) {
  await expect(dialog.getByTestId('add-to-playlist-new')).toBeVisible({ timeout: 20000 });
  test.skip(!(await dialog.getByTestId('add-to-playlist-search').isVisible()), 'The search-and-pick Add to playlist dialog is not deployed on the target yet (it lands with the PR that adds it)');
}

/** The dialog's option for a playlist, found by searching its title (the list loads slowly on QA, #909) */
async function playlistOption(dialog: Locator, title: string) {
  await fillStable(dialog.getByRole('combobox', { name: 'Search your playlists' }), title);
  const option = dialog.getByTestId('add-to-playlist-option').filter({ hasText: title });
  await expect(option).toBeVisible({ timeout: PLAYLIST_LIST_MS });
  return option;
}

const itemOrder = (page: Page) => page.getByTestId('playlist-item').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-video-id')));

test.describe('Playlist tools', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser, creators }) => {
    void browser;
    void creators;
    test.skip(!(await playlistToolsDeployed()), 'The playlist tools are not deployed on the target yet (they land with the PR that adds them)');
    test.setTimeout(300000);
    channelId = owner.channelIds[0];
    // Every playlist of this channel is the spec's: swept at cleanup, before the channel goes
    data.onCleanup(`playlists of channel ${channelId}`, async () => {
      const { body } = await api<{ data?: Array<{ id: string }> }>('GET', `/api/playlists?channelId=${channelId}&limit=100`);
      for (const playlist of body.data ?? []) await api('DELETE', `/api/playlists/${playlist.id}`);
    });
    const base = tag();
    videos = [];
    for (const letter of ['A', 'B', 'C']) {
      videos.push(await data.createVideo(owner.user, channelId, { clip: 'landscape40', title: `${base} ${letter}`, isPublic: false, waitReady: false }));
    }
  });

  test('PLT-001 creates a playlist named in English and Arabic, its picked videos put in order before saving', async ({ page }) => {
    const title = `${tag()} Create`;
    const arabic = `قائمة ${title.slice(-6)}`;
    await page.goto(`/en/settings/channel/${channelId}/playlists`);
    const newLink = page.getByTestId('new-playlist-link');
    await expectHydrated(newLink);
    await newLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'New playlist' })).toBeVisible();
    const form = page.getByTestId('create-playlist-form');
    await expectHydrated(form.getByTestId('picker-search'));
    await skipUntilBilingualForm(page);
    await fillStable(page.getByRole('textbox', { name: 'Name (English)' }), title);
    await fillStable(page.getByRole('textbox', { name: 'Name (Arabic)' }), arabic);
    await expect(page.getByRole('textbox', { name: 'Name (Arabic)' })).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked();

    for (const video of videos) await pick(form, video);
    await expect.poll(() => createOrder(form)).toEqual([videos[0].id, videos[1].id, videos[2].id]);

    // Manual order before saving: Move down, Alt+Up on a row, and a pointer drag by the handle
    await form.getByTestId('create-order-row').first().getByTestId('create-order-down').click();
    await expect.poll(() => createOrder(form)).toEqual([videos[1].id, videos[0].id, videos[2].id]);
    await form.getByTestId('create-order-handle').last().focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => createOrder(form)).toEqual([videos[1].id, videos[2].id, videos[0].id]);
    await expect(form.getByTestId('create-order-handle').nth(1)).toBeFocused();
    await pointerDrag(page, form.getByTestId('create-order-handle').first(), form.getByTestId('create-order-row').last());
    await expect.poll(() => createOrder(form)).toEqual([videos[2].id, videos[0].id, videos[1].id]);
    // The numbers follow, live
    await expect(form.getByTestId('create-order-position')).toHaveText(['1', '2', '3']);
    await expect(page.getByTestId('create-playlist-submit')).toHaveText('Create with 3 videos');
    await page.getByTestId('create-playlist-submit').click();

    // Lands on the new playlist's editor with the videos in that order, saved
    // Not /playlists/new: the form's own URL matches [\w-]+ too, before the redirect
    const editorUrl = new RegExp(`/en/settings/channel/${channelId}/playlists/(?!new$)([\\w-]+)$`);
    await expect(page).toHaveURL(editorUrl, { timeout: 30000 });
    const id = editorUrl.exec(page.url())![1];
    adopt(id);
    await expect(page.getByTestId('playlist-editor')).toBeVisible({ timeout: 30000 });
    const order = [videos[2].id, videos[0].id, videos[1].id];
    await expect.poll(() => itemOrder(page)).toEqual(order);
    await expect(page.getByTestId('playlist-item-count')).toHaveText('3 videos');
    // Still there: the page stays on the editor (it snapped back to an empty New playlist form, #995)
    await expect(page).toHaveURL(editorUrl);
    const record = await stored(id);
    expect(record.title).toBe(title);
    expect(record.titleLocalized).toEqual({ en: title, ar: arabic });
    expect(record.videos).toEqual(order);
    expect(record.sortMode ?? 'manual').toBe('manual');
    // Each viewer sees their language
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.goto(`/ar/settings/channel/${channelId}/playlists/${id}`);
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: arabic })).toBeVisible({ timeout: 30000 });
  });

  test('PLT-002 editor: add with the picker, reorder by keyboard and buttons, automatic order, remove', async ({ page }) => {
    const id = await data.createPlaylist(owner.user, channelId, { title: `${tag()} Edit` });
    await page.goto(`/en/settings/channel/${channelId}/playlists/${id}`);
    await expect(page.getByTestId('playlist-editor')).toBeVisible();
    await expect(page.getByText('This playlist has no videos yet.')).toBeVisible();

    // Add all three with the picker, in this order
    await expectHydrated(page.getByTestId('playlist-add-videos'));
    await page.getByTestId('playlist-add-videos').click();
    const panel = page.getByTestId('playlist-add-panel');
    for (const video of [videos[0], videos[1], videos[2]]) await pick(panel, video);
    await page.getByTestId('playlist-add-submit').click();
    await expect(page.getByTestId('bulk-add-notice')).toContainText('Added 3 videos to');
    await expect.poll(() => itemOrder(page)).toEqual([videos[0].id, videos[1].id, videos[2].id]);
    await expect.poll(async () => (await stored(id)).videos).toEqual([videos[0].id, videos[1].id, videos[2].id]);

    // Adding again is idempotent: the picker marks them as in the playlist
    await page.getByTestId('playlist-add-videos').click();
    await fillStable(panel.getByTestId('picker-search'), videos[0].title);
    await panel.getByTestId('picker-search').press('Escape');
    await expect(panel.locator(`[data-testid="picker-video"][data-video-id="${videos[0].id}"]`).getByRole('checkbox')).toBeDisabled({ timeout: 30000 });
    await panel.getByRole('button', { name: 'Cancel' }).first().click();

    // Keyboard drag: first video one step down
    await keyboardMoveDown(page, page.getByTestId('playlist-item-handle').first());
    await expect.poll(() => itemOrder(page)).toEqual([videos[1].id, videos[0].id, videos[2].id]);
    await expect.poll(async () => (await stored(id)).videos).toEqual([videos[1].id, videos[0].id, videos[2].id]);

    // Move up button: last video up one
    await page.getByTestId('playlist-item').last().getByTestId('playlist-item-up').click();
    await expect.poll(() => itemOrder(page)).toEqual([videos[1].id, videos[2].id, videos[0].id]);
    await expect(page.getByText('Order saved')).toBeVisible();

    // Alt+Down / Alt+Up on a row (the bulk-rename shortcut), where the target has it
    // The visible hint (dnd-kit repeats it in a hidden describedby node)
    if (await page.locator('#playlist-reorder-hint').filter({ hasText: /press Alt with the Up or Down arrow/ }).isVisible()) {
      await page.getByTestId('playlist-item-handle').first().focus();
      await page.keyboard.press('Alt+ArrowDown');
      await expect.poll(() => itemOrder(page)).toEqual([videos[2].id, videos[1].id, videos[0].id]);
      await expect.poll(async () => (await stored(id)).videos).toEqual([videos[2].id, videos[1].id, videos[0].id]);
      await page.getByTestId('playlist-item-handle').nth(1).focus();
      await page.keyboard.press('Alt+ArrowUp');
      await expect.poll(async () => (await stored(id)).videos).toEqual([videos[1].id, videos[2].id, videos[0].id]);
    }

    // Automatic: title A to Z (no handles), then back to manual keeps that order
    await page.getByRole('radio', { name: /Automatic/ }).check();
    await expect(page.getByText('Order updated')).toBeVisible();
    await page.getByTestId('sort-field').selectOption('title');
    await page.getByTestId('sort-direction-asc').click();
    const byTitle = [...videos].sort((a, b) => a.title.localeCompare(b.title)).map((v) => v.id);
    await expect.poll(async () => (await stored(id)).videos).toEqual(byTitle);
    await expect.poll(() => itemOrder(page)).toEqual(byTitle);
    await expect(page.getByTestId('playlist-item-handle')).toHaveCount(0);
    await expect.poll(async () => (await stored(id)).sortField).toBe('title');

    await page.getByRole('radio', { name: /Manual/ }).check();
    await expect(page.getByTestId('playlist-item-handle')).toHaveCount(3);
    await expect.poll(async () => (await stored(id)).sortMode).toBe('manual');
    expect((await stored(id)).videos).toEqual(byTitle);

    // Remove one
    await page.getByTestId('playlist-item').first().getByTestId('playlist-item-remove').click();
    await page.getByTestId('playlist-editor-remove-dialog-confirm').click();
    await expect(page.getByTestId('playlist-item')).toHaveCount(2);
    await expect.poll(async () => (await stored(id)).videos).toEqual(byTitle.slice(1));
  });

  test('PLT-003 Studio videos: New playlist from the selection, named in both languages and ordered there (no video picker)', async ({ page }) => {
    const newTitle = `${tag()} Inline`;
    const select = await openStudioWith(page, [videos[0], videos[1]]);
    await select(videos[1]).check();
    await select(videos[0]).check();
    await page.getByTestId('studio-bulk-playlist').click();
    const dialog = page.getByTestId('add-to-playlist-dialog');
    await expect(dialog.getByRole('heading', { name: 'Add 2 videos to playlists' })).toBeVisible();
    await skipUntilSearchDialog(dialog);
    // The videos are already chosen: no video picker here
    await expect(dialog.getByTestId('video-picker')).toHaveCount(0);
    await dialog.getByTestId('add-to-playlist-new').click();
    await expect(dialog.getByRole('heading', { name: 'New playlist with 2 videos' })).toBeVisible();
    await expect(dialog.getByText('Videos (optional)')).toHaveCount(0);
    await expect(dialog.getByTestId('video-picker')).toHaveCount(0);
    const selected = await createOrder(dialog);
    expect([...selected].sort()).toEqual([videos[0].id, videos[1].id].sort());
    // Back to the playlists keeps nothing half made
    await dialog.getByRole('button', { name: 'Back to playlists' }).click();
    await expect(dialog.getByRole('heading', { name: 'Add 2 videos to playlists' })).toBeVisible();
    await dialog.getByTestId('add-to-playlist-new').click();
    // Ordered right there, then saved in that order
    await dialog.getByTestId('create-order-row').first().getByTestId('create-order-down').click();
    const order = [selected[1], selected[0]];
    await expect.poll(() => createOrder(dialog)).toEqual(order);
    await fillStable(dialog.getByRole('textbox', { name: 'Name (English)' }), newTitle);
    await fillStable(dialog.getByRole('textbox', { name: 'Name (Arabic)' }), 'قائمة جديدة');
    await dialog.getByRole('radio', { name: /^Private/ }).check();
    await dialog.getByTestId('create-playlist-submit').click();
    await expect(dialog.getByTestId('bulk-add-notice')).toContainText(`Added 2 videos to ${newTitle}.`);
    // The new playlist joins the dialog's list, marked as done
    const created = await playlistOption(dialog, newTitle);
    await expect(created).toHaveAttribute('aria-checked', 'true');
    const id = (await created.getAttribute('data-option-id'))!;
    adopt(id);
    await expect.poll(async () => (await stored(id)).videos).toEqual(order);
    const record = await stored(id);
    expect(record.title).toBe(newTitle);
    expect(record.titleLocalized).toEqual({ en: newTitle, ar: 'قائمة جديدة' });
    expect(record.isPublic).toBe(false);
  });

  test('PLT-005 Studio videos: search and add the selection to a manual playlist (appended at the end)', async ({ page }) => {
    const title = `${tag()} Studio`;
    const id = await data.createPlaylist(owner.user, channelId, { title, videoIds: [videos[0].id] });
    const select = await openStudioWith(page, [videos[0], videos[1]]);
    // One already in the playlist is skipped, not added twice
    await select(videos[0]).check();
    await select(videos[1]).check();
    await page.getByTestId('studio-bulk-playlist').click();
    const dialog = page.getByTestId('add-to-playlist-dialog');
    await expect(dialog.getByRole('heading', { name: 'Add 2 videos to playlists' })).toBeVisible();
    // The dialog lists the channel's playlists once they have loaded (#909: slow on QA)
    await skipUntilSearchDialog(dialog);
    await expect(dialog.getByTestId('video-picker')).toHaveCount(0);
    // Search the channel's playlists and tick this one
    const option = await playlistOption(dialog, title);
    await expect(option).toHaveAttribute('data-option-id', id);
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByTestId('add-to-playlist-chosen')).toContainText(title);
    await expect(dialog.getByTestId('add-to-playlist-submit')).toHaveText('Add to 1 playlist');
    await dialog.getByTestId('add-to-playlist-submit').click();
    await expect(dialog.getByTestId('bulk-add-notice')).toContainText(`Added 1 video to ${title}.`);
    await expect(dialog.getByTestId('bulk-add-notice')).toContainText('1 already in the playlist.');
    await expect.poll(async () => (await stored(id)).videos).toEqual([videos[0].id, videos[1].id]);
  });

  test('PLT-004 Arabic editor is translated and RTL', async ({ page }) => {
    const id = await data.createPlaylist(owner.user, channelId, { title: `${tag()} Ar`, videoIds: [] });
    await page.goto(`/ar/settings/channel/${channelId}/playlists/${id}`);
    await expectRtl(page);
    await expect(page.getByTestId('playlist-editor')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'المرئيات في هذه القائمة' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /يدوي/ })).toBeChecked();
    await expect(page.getByTestId('playlist-add-videos')).toHaveText('إضافة مرئيات');

    // The Add to playlist dialog in Arabic: translated, right to left, both name fields
    const select = await openStudioWith(page, [videos[0]], 'ar');
    await select(videos[0]).check();
    await page.getByTestId('studio-bulk-playlist').click();
    const dialog = page.getByTestId('add-to-playlist-dialog');
    await skipUntilSearchDialog(dialog);
    await expect(dialog).toHaveAttribute('dir', 'rtl');
    await expect(dialog.getByRole('heading', { name: 'إضافة فيديو واحد إلى قوائم التشغيل' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'ابحث في قوائم التشغيل' })).toBeVisible();
    await dialog.getByTestId('add-to-playlist-new').click();
    await expect(dialog.getByRole('heading', { name: 'قائمة تشغيل جديدة بفيديو واحد' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'الاسم (بالعربية)' })).toHaveAttribute('dir', 'rtl');
    await expect(dialog.getByRole('textbox', { name: 'الاسم (بالإنجليزية)' })).toHaveAttribute('dir', 'ltr');
  });

  test('PLT-006 the dialog fits the viewport, its edge is one border, and option cards read clearly (desktop and phone)', async ({ page }, testInfo) => {
    for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      const select = await openStudioWith(page, [videos[0]]);
      await select(videos[0]).check();
      await page.getByTestId('studio-bulk-playlist').click();
      const dialog = page.getByTestId('add-to-playlist-dialog');
      await skipUntilSearchDialog(dialog);
      await dialog.getByTestId('add-to-playlist-new').click();
      await expect(dialog.getByTestId('create-playlist-form')).toBeVisible();

      // Inside the viewport, with its actions reachable
      const box = (await dialog.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
      await dialog.getByTestId('create-playlist-submit').scrollIntoViewIfNeeded();
      await expect(dialog.getByTestId('create-playlist-submit')).toBeInViewport();

      // The edge is a real border (one continuous line round the corners), not a box-shadow ring
      const edge = await dialog.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { width: cs.borderTopWidth, style: cs.borderTopStyle, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow };
      });
      expect(edge.width).toBe('1px');
      expect(edge.style).toBe('solid');
      expect(edge.shadow).not.toMatch(/\b0px 0px 0px 1px\b/);
      // Close-ups of two corners, for review (Firefox and WebKit run this nightly)
      const r = parseFloat(edge.radius) + 8;
      for (const [name, x, y] of [['top-start', box.x - 4, box.y - 4], ['bottom-end', box.x + box.width - r + 4, box.y + box.height - r + 4]] as const) {
        const shot = await page.screenshot({ clip: { x: Math.max(0, x), y: Math.max(0, y), width: r, height: r }, scale: 'device' });
        await testInfo.attach(`dialog-corner-${name}-${size.width}`, { body: shot, contentType: 'image/png' });
      }

      // Selected option cards: solid tint, primary border and a check mark
      const selected = dialog.locator('.ocard[data-checked]').first();
      await expect(selected.locator('.ocard-mark svg')).toBeVisible();
      expect(await selected.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
      await testInfo.attach(`dialog-${size.width}`, { body: await dialog.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  });
});
