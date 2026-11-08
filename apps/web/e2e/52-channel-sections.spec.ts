import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import {
  channelsOf,
  clickUntil,
  createSection,
  deleteSectionsTitled,
  expectRtl,
  fillStable,
  findQaLecturesChannel,
  listChannelPlaylists,
  listPublicChannelVideos,
  listSections,
  tempName,
  keyboardMoveDown,
  withLock,
} from './test-utils/channel-content';

/**
 * Channel sections: the owner's section manager
 * (/[locale]/settings/channel/[id]/sections: add, edit, reorder, delete) and
 * how sections render on the channel Home tab; plus the /[locale]/sections
 * video-sections page.
 *
 * Writes go to the single user's own channel. Every section a test creates
 * has a unique "E2E Temp …" title and is deleted afterwards. Tests that change
 * the channel's section list hold a run-wide lock, because the reorder API
 * takes the full list of section ids.
 */

const owner = 'single' as const;
const channelId = () => channelsOf(owner).main.id;

async function openManager(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/settings/channel/${channelId()}/sections`);
  await expect(page.getByTestId('sections-count')).toBeVisible();
}

function sectionRow(page: Page, title: string): Locator {
  return page.getByTestId('section-item').filter({ has: page.getByTestId('section-item-title').getByText(title, { exact: true }) });
}

async function openAddDialog(page: Page, label = 'Add section') {
  const dialog = page.getByRole('dialog');
  await clickUntil(page.getByRole('button', { name: label }), async () => expect(dialog).toBeVisible({ timeout: 3000 }));
  return dialog;
}

test.describe('Section manager', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('SECT-001 shows the localized header, usage count and breadcrumb (en)', async ({ page }) => {
    const existing = await listSections(owner, channelId());
    await openManager(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Channel sections' })).toBeVisible();
    await expect(page.getByText('Customize your channel layout (max 10 sections)')).toBeVisible();
    await expect(page.getByTestId('sections-count')).toHaveText(`${existing.length} of 10 sections used`);
    await expect(page.getByTestId('publish-sections')).toBeDisabled();

    const crumbs = page.getByTestId('channel-settings-breadcrumb');
    await expect(crumbs).toHaveAttribute('aria-label', 'Breadcrumb');
    await expect(crumbs.getByRole('link', { name: channelsOf(owner).main.name })).toHaveAttribute('href', `/en/channels/${channelId()}`);
    await expect(crumbs.getByRole('link', { name: 'Channel Settings' })).toHaveAttribute('href', `/en/settings/channel/${channelId()}`);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Manage Sections');
  });

  test('SECT-002 adds an automatic section that then renders on the channel Home tab', async ({ page }) => {
    const title = tempName('Recent');
    await withLock('sections', async () => {
      try {
        await openManager(page);
        const dialog = await openAddDialog(page);
        await expect(dialog.getByRole('heading', { name: 'Add channel section' })).toBeVisible();
        await expect(dialog.locator('[data-section-type]')).toHaveCount(7);
        await dialog.locator('[data-section-type="recent_uploads"]').click();
        await expect(dialog.getByRole('heading', { name: 'Configure section' })).toBeVisible();
        await expect(dialog).toContainText('This section type will automatically display content from your channel.');
        await fillStable(dialog.getByLabel('Section title'), title);
        await expect(dialog.getByText(`${title.length}/100 characters`)).toBeVisible();
        await dialog.getByRole('button', { name: 'Create section' }).click();

        await expect(dialog).toBeHidden();
        await expect(page.getByRole('status').filter({ hasText: 'Section created successfully' })).toBeVisible();
        const row = sectionRow(page, title);
        await expect(row).toBeVisible();
        await expect(row).toContainText('Recent uploads · Automatic content');
        expect((await listSections(owner, channelId())).some((s) => s.title === title && s.type === 'recent_uploads')).toBe(true);

        // Public channel page: the section heading uses the owner's title
        await page.goto(`/en/channels/${channelId()}`);
        await expect(page.getByTestId('tabpanel-home').getByRole('heading', { name: title })).toBeVisible();
      } finally {
        await deleteSectionsTitled(owner, channelId(), title);
      }
    });
  });

  test('SECT-003 validates featured-video and playlist sections', async ({ page }) => {
    await openManager(page);
    const dialog = await openAddDialog(page);

    await dialog.locator('[data-section-type="featured_videos"]').click();
    await dialog.getByRole('button', { name: 'Create section' }).click();
    await expect(dialog.locator('#videoIds-error')).toHaveText('At least one video ID is required');
    await expect(dialog.getByLabel('Video IDs')).toHaveAttribute('aria-invalid', 'true');

    await fillStable(dialog.getByLabel('Section title'), 'Bad <title>');
    await dialog.getByRole('button', { name: 'Create section' }).click();
    await expect(dialog.locator('#title-error')).toHaveText('Title cannot contain < or > characters');

    // Cancel returns to the type picker
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.getByRole('heading', { name: 'Add channel section' })).toBeVisible();

    await dialog.locator('[data-section-type="single_playlist"]').click();
    await fillStable(dialog.getByLabel(/Playlist IDs/), 'one, two');
    await dialog.getByRole('button', { name: 'Create section' }).click();
    await expect(dialog.locator('#playlists-error')).toHaveText('Single playlist section requires exactly one playlist ID');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.locator('[data-section-type="multiple_playlists"]').click();
    await dialog.getByRole('button', { name: 'Create section' }).click();
    await expect(dialog.locator('#title-error')).toHaveText('Title is required for this section type');
    await expect(dialog.locator('#playlists-error')).toHaveText('At least one playlist is required');

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('SECT-004 edits a section title', async ({ page }) => {
    const title = tempName('Edit');
    const renamed = `${title} renamed`;
    await withLock('sections', async () => {
      try {
        await createSection(owner, channelId(), { type: 'popular_uploads', title });
        await openManager(page);
        await sectionRow(page, title).getByRole('button', { name: `Edit section: ${title}` }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('heading', { name: 'Edit section' })).toBeVisible();
        await expect(dialog.getByLabel('Section title')).toHaveValue(title);
        await dialog.getByLabel('Section title').fill(renamed);
        await dialog.getByRole('button', { name: 'Save changes' }).click();

        await expect(dialog).toBeHidden();
        await expect(page.getByRole('status').filter({ hasText: 'Section updated successfully' })).toBeVisible();
        await expect(sectionRow(page, renamed)).toBeVisible();
        await expect.poll(async () => (await listSections(owner, channelId())).map((s) => s.title)).toContain(renamed);
      } finally {
        await deleteSectionsTitled(owner, channelId(), title);
      }
    });
  });

  test('SECT-005 reorders sections with the keyboard and publishes the order', async ({ page }) => {
    const first = tempName('First');
    const second = tempName('Second');
    await withLock('sections', async () => {
      try {
        await createSection(owner, channelId(), { type: 'recent_uploads', title: first });
        await createSection(owner, channelId(), { type: 'popular_uploads', title: second });
        await openManager(page);

        const titles = page.getByTestId('section-item-title');
        const order = async () => (await titles.allInnerTexts()).filter((t) => t === first || t === second);
        await expect.poll(order).toEqual([first, second]);

        // dnd-kit keyboard sensor: Space picks up, ArrowDown moves, Space drops
        const handle = sectionRow(page, first).getByTestId('section-drag-handle');
        await keyboardMoveDown(page, handle);

        await expect.poll(order).toEqual([second, first]);
        await expect(page.getByTestId('sections-unpublished')).toHaveText('(Unpublished changes)');
        await page.getByTestId('publish-sections').click();
        await expect(page.getByRole('status').filter({ hasText: 'Sections published successfully!' })).toBeVisible();
        await expect(page.getByTestId('sections-unpublished')).toHaveCount(0);

        await expect
          .poll(async () => (await listSections(owner, channelId())).map((s) => s.title).filter((t) => t === first || t === second))
          .toEqual([second, first]);
      } finally {
        await deleteSectionsTitled(owner, channelId(), first);
        await deleteSectionsTitled(owner, channelId(), second);
      }
    });
  });

  test('SECT-006 deletes a section after confirmation (cancel keeps it)', async ({ page }) => {
    const title = tempName('Delete');
    await withLock('sections', async () => {
      try {
        await createSection(owner, channelId(), { type: 'recent_uploads', title });
        await openManager(page);
        const row = sectionRow(page, title);
        await row.getByRole('button', { name: `Delete section: ${title}` }).click();
        const confirm = page.getByRole('alertdialog');
        await expect(confirm.getByRole('heading', { name: 'Delete section' })).toBeVisible();
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        await expect(confirm).toBeHidden();
        await expect(row).toBeVisible();

        await row.getByRole('button', { name: `Delete section: ${title}` }).click();
        await confirm.getByRole('button', { name: 'Delete' }).click();
        await expect(row).toHaveCount(0);
        await expect(page.getByRole('status').filter({ hasText: 'Section deleted successfully' })).toBeVisible();
        await expect.poll(async () => (await listSections(owner, channelId())).some((s) => s.title === title)).toBe(false);
      } finally {
        await deleteSectionsTitled(owner, channelId(), title);
      }
    });
  });

  test('SECT-007 Arabic section manager is RTL and fully translated', async ({ page }) => {
    await openManager(page, 'ar');
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'أقسام القناة' })).toBeVisible();
    await expect(page.getByTestId('sections-count')).toContainText('من 10 أقسام');
    await expect(page.getByTestId('publish-sections')).toHaveText('نشر');
    await expect(page.getByTestId('channel-settings-breadcrumb')).toHaveAttribute('aria-label', 'مسار التنقل');

    const dialog = await openAddDialog(page, 'إضافة قسم');
    await expect(dialog).toHaveAttribute('dir', 'rtl');
    await expect(dialog.getByRole('heading', { name: 'إضافة قسم للقناة' })).toBeVisible();
    await expect(dialog.locator('[data-section-type="recent_uploads"]')).toContainText('أحدث الفيديوهات');
    await dialog.locator('[data-section-type="featured_videos"]').click();
    await dialog.getByRole('button', { name: 'إنشاء القسم' }).click();
    await expect(dialog.locator('#videoIds-error')).toHaveText('مطلوب معرف فيديو واحد على الأقل');
    await dialog.getByRole('button', { name: 'إلغاء' }).click();
    await expect(dialog.getByRole('heading', { name: 'إضافة قسم للقناة' })).toBeVisible();
  });

  test('SECT-008 breadcrumb runs right-to-left in Arabic', async ({ page }) => {
    await openManager(page, 'ar');
    const items = page.getByTestId('channel-settings-breadcrumb').getByRole('listitem');
    await expect(items).toHaveCount(3);
    const boxes = await items.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: Math.round(r.top) };
      })
    );
    const listRight = await page.getByTestId('channel-settings-breadcrumb').getByRole('list').evaluate((e) => e.getBoundingClientRect().right);
    // The first crumb (channel) starts at the inline start, i.e. the right edge
    expect(Math.abs(listRight - boxes[0].right)).toBeLessThan(2);
    // Crumbs on the same line run right to left (the list may wrap on phones)
    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].top === boxes[i - 1].top) expect(boxes[i].right).toBeLessThanOrEqual(boxes[i - 1].left + 1);
    }
  });
});

test.describe('Sections on the channel Home tab', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('SECT-010 featured-video and playlist sections render their configured content', async ({ page }) => {
    const lectures = await findQaLecturesChannel();
    const [video] = await listPublicChannelVideos(lectures.id);
    const [playlist] = await listChannelPlaylists(lectures.id);
    const featured = tempName('Featured');
    const single = tempName('Playlist');

    await withLock('sections', async () => {
      try {
        // Content is stored by the API under `content` (videoIds / playlistId)
        await createSection(owner, channelId(), { type: 'featured_videos', title: featured, videoIds: [video.id] });
        await createSection(owner, channelId(), { type: 'single_playlist', title: single, playlistId: playlist.id });

        await page.goto(`/en/channels/${channelId()}`);
        const home = page.getByTestId('tabpanel-home');
        const featuredSection = home.locator('section').filter({ has: page.getByRole('heading', { name: featured }) });
        await expect(featuredSection).toBeVisible();
        await expect(featuredSection.getByTestId('video-card')).toHaveCount(1);
        await expect(featuredSection.getByTestId('video-card')).toHaveAttribute('href', `/en/video?vid=${video.id}`);

        const playlistLink = home.getByRole('link', { name: new RegExp(playlist.name) }).first();
        await expect(playlistLink).toBeVisible();
        await expect(playlistLink).toHaveAttribute('href', `/en/playlist/${playlist.id}`);
        await expect(home).not.toContainText('Playlist not found');
      } finally {
        await deleteSectionsTitled(owner, channelId(), featured);
        await deleteSectionsTitled(owner, channelId(), single);
      }
    });
  });
});

test.describe('Video sections page (/sections)', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('SECT-020 renders the localized heading and video sections (en)', async ({ page }) => {
    await page.goto('/en/sections');
    await expect(page).toHaveTitle('Explore Videos | Al Ummah Now');
    await expect(page.getByRole('heading', { level: 1, name: 'Explore Videos' })).toBeVisible();
    await expect(page.getByText('Discover Islamic content across different categories')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Uploads' })).toBeVisible();
  });

  test('SECT-021 renders in Arabic, right-to-left', async ({ page }) => {
    await page.goto('/ar/sections');
    await expectRtl(page);
    await expect(page).toHaveTitle('استكشف الفيديوهات | الأمة الآن');
    await expect(page.getByRole('heading', { level: 1, name: 'استكشف الفيديوهات' })).toBeVisible();
    await expect(page.locator('main').first()).toHaveAttribute('dir', 'rtl');
  });
});
