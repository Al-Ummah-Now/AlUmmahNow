import { test, expect } from './fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import type { Browser, Locator, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import {
  apiAs,
  channelsOf,
  clickUntil,
  createPlaylist,
  createSection,
  createTextPost,
  deletePlaylistQuietly,
  deletePostsContaining,
  deleteSectionsOfType,
  deleteSectionsTitled,
  ensureUnsubscribed,
  expectRtl,
  fillStable,
  listPublicChannelVideos,
  listSections,
  tempName,
  keyboardMoveDown,
  withLock,
} from './test-utils/channel-content';
import { setupPublicDisposable, userApi } from './test-utils/e2e-videos';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * Channel sections (docs/specs/CHANNEL-SECTIONS.md): the owner's section
 * manager (/[locale]/settings/channel/[id]/sections: add, edit, reorder,
 * delete), every section type added through the grouped dialog and drawn on
 * the channel Home tab, for the owner and for a signed-out visitor; plus the
 * /[locale]/sections video-sections page.
 *
 * Writes go to the single user's own channel. Tests that change the channel's
 * section list hold a run-wide lock, because the reorder API takes the full
 * list of section ids and most types can be added once per channel. Sections
 * with a temp title are deleted by title; default-titled ones by type.
 */

const owner = 'single' as const;
const channelId = () => channelsOf(owner).main.id;

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

/** Another creator's channel with a public video, for featured channels and other channels' videos (made in beforeAll, deleted afterwards) */
const otherCreator = ownPublicVideos(test, 'sections-other');
const ownOtherChannel = () => ({ id: otherCreator.channelId(), name: otherCreator.channelName() });
const MAX_SECTIONS = 12;
const LOCK_WAIT = 600_000;

type Locale = 'en' | 'ar';

const UI = {
  en: {
    addSection: 'Add section',
    addChannelSection: 'Add channel section',
    created: 'Section created successfully',
    deleted: 'Section deleted successfully',
    published: 'Sections published successfully!',
    publish: 'Publish',
    deleteSection: 'Delete section',
    delete: 'Delete',
    back: 'Back',
    automatic: 'Automatic content',
  },
  ar: {
    addSection: 'إضافة قسم',
    addChannelSection: 'إضافة قسم للقناة',
    created: 'تم إنشاء القسم بنجاح',
    deleted: 'تم حذف القسم بنجاح',
    published: 'تم نشر الأقسام بنجاح!',
    publish: 'نشر',
    deleteSection: 'حذف القسم',
    delete: 'حذف',
    back: 'رجوع',
    automatic: 'محتوى تلقائي',
  },
} as const;

async function openManager(page: Page, locale: Locale = 'en') {
  await page.goto(`/${locale}/settings/channel/${channelId()}/sections`);
  await expect(page.getByTestId('sections-count')).toBeVisible();
}

function sectionRow(page: Page, title: string): Locator {
  return page.getByTestId('section-item').filter({ has: page.getByTestId('section-item-title').getByText(title, { exact: true }) });
}

async function openAddDialog(page: Page, locale: Locale = 'en') {
  const dialog = page.getByRole('dialog');
  await clickUntil(page.getByRole('button', { name: UI[locale].addSection }), async () => expect(dialog).toBeVisible({ timeout: 3000 }));
  await expect(dialog.getByTestId('section-type-options')).toBeVisible();
  return dialog;
}

/** Deletes a section row through its delete button and the confirmation */
async function deleteRow(page: Page, row: Locator, locale: Locale) {
  await row.getByTestId('section-delete').click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('heading', { name: UI[locale].deleteSection })).toBeVisible();
  await confirm.getByRole('button', { name: UI[locale].delete, exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: UI[locale].deleted })).toBeVisible();
}

test.describe('Section manager', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('SECT-001 shows the localized header, usage count and breadcrumb (en)', async ({ page }) => {
    const existing = await listSections(owner, channelId());
    await openManager(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Channel sections' })).toBeVisible();
    await expect(page.getByText(`Customize your channel layout (max ${MAX_SECTIONS} sections)`)).toBeVisible();
    await expect(page.getByTestId('sections-count')).toHaveText(`${existing.length} of ${MAX_SECTIONS} sections used`);
    await expect(page.getByTestId('publish-sections')).toBeDisabled();

    const crumbs = page.getByTestId('channel-settings-breadcrumb');
    await expect(crumbs).toHaveAttribute('aria-label', 'Breadcrumb');
    // <channel> › Settings › Manage Sections: the name opens the channel, Settings its settings; the arrow goes back there
    await expect(crumbs.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', `/en/settings/channel/${channelId()}`);
    await expect(crumbs.getByRole('link', { name: channelsOf(owner).main.name, exact: true })).toHaveAttribute('href', /^\/en\/(@|channels\/)/);
    await expect(crumbs.locator('a[href="/en/settings"]')).toHaveCount(0);
    await expect(crumbs.getByTestId('settings-back')).toHaveAttribute('href', `/en/settings/channel/${channelId()}`);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Manage Sections');
  });

  test('SECT-002 adds a titled automatic section that then renders on the channel Home tab', async ({ page }) => {
    const title = tempName('Recent');
    await withLock(
      'sections',
      async () => {
        try {
          await deleteSectionsOfType(owner, channelId(), ['recent_uploads']);
          await openManager(page);
          const dialog = await openAddDialog(page);
          await expect(dialog.getByRole('heading', { name: 'Add channel section' })).toBeVisible();
          await dialog.locator('[data-section-card="recent_uploads"]').click();
          await expect(dialog.getByRole('heading', { name: 'Latest videos' })).toBeVisible();
          await expect(dialog.getByText('Your newest videos')).toBeVisible();
          await fillStable(dialog.getByLabel('Section title'), title);
          await dialog.getByTestId('section-form-submit').click();

          await expect(dialog).toBeHidden();
          await expect(page.getByRole('status').filter({ hasText: 'Section created successfully' })).toBeVisible();
          const row = sectionRow(page, title);
          await expect(row).toBeVisible();
          await expect(row).toContainText('Latest videos, Automatic content');
          expect((await listSections(owner, channelId())).some((s) => s.title === title && s.type === 'recent_uploads')).toBe(true);

          // The card is at its limit now: it stays in the list, closed
          const again = await openAddDialog(page);
          await expect(again.locator('[data-section-card="recent_uploads"]')).toBeDisabled();
          await expect(again.locator('[data-section-card="recent_uploads"]')).toContainText('Already on your channel');
          await page.keyboard.press('Escape');

          // Channel Home, as the owner, who sees it as visitors do: drawn under the owner's title when the
          // channel has public videos; an empty section isn't drawn and the manager marks it Hidden. The seed
          // videos are private, so it is usually empty here (other specs' public videos come and go).
          // (a fresh load: the populated list arrives whole, badges included)
          await openManager(page);
          await expect(row).toBeVisible();
          const hidden = (await row.getByTestId('section-hidden-badge').count()) > 0;
          await openHome(page, 'en');
          const home = page.getByTestId('channel-section-recent_uploads');
          if (hidden) await expect(home).toHaveCount(0);
          else await expect(home.getByRole('heading', { name: title })).toBeVisible();
        } finally {
          await deleteSectionsTitled(owner, channelId(), title);
        }
      },
      LOCK_WAIT
    );
  });

  for (const [locale, colorScheme] of [['en', 'dark'], ['ar', 'light']] as const) {
    test(`SECT-011 the section-type picker is option cards: grouped, keyboard, WCAG AA (${locale}, ${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await openManager(page, locale);
      const dialog = await openAddDialog(page, locale);
      await expect(dialog).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      const picker = dialog.getByTestId('section-type-options');
      // Videos, Playlists, Channels, Community; live streams have a card per filter
      await expect(picker.getByRole('group')).toHaveCount(4);
      await expect(picker.getByRole('group').last().getByRole('heading')).toHaveText(locale === 'ar' ? 'المجتمع' : 'Community');
      const options = dialog.locator('[data-section-card]');
      await expect(options).toHaveCount(14);

      // Cards, not primary buttons: not a pill, and big enough to tap
      const look = await options.first().evaluate((el) => {
        const cs = getComputedStyle(el);
        return { radius: parseFloat(cs.borderTopLeftRadius), height: el.getBoundingClientRect().height };
      });
      expect(look.radius).toBeLessThan(look.height / 3);
      expect(look.height).toBeGreaterThanOrEqual(44);

      // Private data is labelled on its cards
      await expect(dialog.locator('[data-section-card="liked_videos"]')).toContainText(locale === 'ar' ? 'بيانات خاصة' : 'Private data');

      // The first open card has focus; the arrow keys move through the open cards (ArrowLeft is forward in Arabic)
      const open = dialog.locator('[data-section-card]:not(:disabled)');
      await expect(open.first()).toBeFocused();
      await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight');
      await expect(open.nth(1)).toBeFocused();
      await page.keyboard.press('End');
      await expect(open.last()).toBeFocused();

      const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

      // Enter picks the focused card and moves on to its form, titled with the card; Back returns to it; Escape closes
      await page.keyboard.press('Home');
      const first = await open.first().getAttribute('data-section-card');
      await page.keyboard.press('Enter');
      await expect(dialog.getByTestId('section-form')).toBeVisible();
      if (first === 'channel_spotlight') {
        await expect(dialog.getByRole('heading', { name: locale === 'ar' ? 'واجهة القناة' : 'Channel spotlight' })).toBeVisible();
      }
      await dialog.getByRole('button', { name: UI[locale].back }).click();
      await expect(dialog.locator(`[data-section-card="${first}"]`)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('add-section-button')).toBeFocused();
    });
  }

  // Owner rule 2026-11-11: every picker opens with content before anything is typed
  for (const locale of ['en', 'ar'] as const) {
    test(`SECT-012 pickers open with results: featured channels and videos list before typing, typing filters (${locale})`, async ({ page }) => {
      await openManager(page, locale);
      const dialog = await openAddDialog(page, locale);
      await dialog.locator('[data-section-card="featured_channels"]').click();
      const channels = dialog.getByTestId('channel-picker-options');
      // Most viewed channels, without typing; never this channel itself
      await expect(channels.getByTestId('channel-picker-option').first()).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByTestId('channel-picker-search')).toHaveValue('');
      await expect(channels.locator(`[data-option-id="${channelId()}"]`)).toHaveCount(0);
      const count = await channels.getByTestId('channel-picker-option').count();
      expect(count).toBeGreaterThan(0);
      // The list is announced and busy only while loading
      await expect(channels.getByRole('listbox')).not.toHaveAttribute('aria-busy', 'true');
      // Picking one marks it and keeps it from being added twice
      const first = channels.getByTestId('channel-picker-option').first();
      await first.click();
      await expect(first).toHaveAttribute('aria-checked', 'true');
      await expect(first).toHaveAttribute('aria-disabled', 'true');
      // Typing filters live
      const name = ((await channels.getByTestId('channel-picker-option').nth(Math.min(1, count - 1)).locator('span[dir="auto"]').first().textContent()) ?? '').trim();
      if (name.length >= 2) {
        await fillStable(dialog.getByTestId('channel-picker-search'), name.slice(0, Math.min(6, name.length)));
        await expect(channels.getByTestId('channel-picker-option').first()).toBeVisible();
      }
    });
  }

  test('SECT-003 validates picks and titles before saving', async ({ page }) => {
    await openManager(page);
    const dialog = await openAddDialog(page);

    await dialog.locator('[data-section-card="featured_videos"]').click();
    await dialog.getByTestId('section-form-submit').click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Pick at least one.' })).toBeVisible();

    await fillStable(dialog.getByLabel('Section title'), 'Bad <title>');
    await dialog.getByTestId('section-form-submit').click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Title cannot contain < or > characters' })).toBeVisible();

    // Back returns to the cards
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(dialog.getByRole('heading', { name: 'Add channel section' })).toBeVisible();

    // Featured playlists and featured channels need a title of their own
    await dialog.locator('[data-section-card="multiple_playlists"]').click();
    await dialog.getByTestId('section-form-submit').click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Give this section a title, for example "Our scholars".' })).toBeVisible();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Pick at least one.' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.locator('[data-section-card="subscribed_channels"]').click();
    await dialog.getByTestId('section-form-submit').click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Tick the box to show this on your channel.' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    expect((await listSections(owner, channelId())).some((s) => s.title?.startsWith('Bad'))).toBe(false);
  });

  test('SECT-004 edits a section title', async ({ page }) => {
    const title = tempName('Edit');
    const renamed = `${title} renamed`;
    await withLock(
      'sections',
      async () => {
        try {
          await deleteSectionsOfType(owner, channelId(), ['popular_uploads']);
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
      },
      LOCK_WAIT
    );
  });

  for (const locale of ['en', 'ar'] as const) {
    test(`SECT-005 reorders sections with the keyboard and publishes the order (${locale})`, async ({ page }) => {
      const first = tempName('First');
      const second = tempName('Second');
      // The Home tab draws only sections with something to show: a featured channel and a post of
      // this test (the seed videos are private, so an automatic video section would be empty)
      const postMarker = tempName('Reorder post');
      await withLock(
        'sections',
        async () => {
          try {
            const lectures = ownOtherChannel();
            await deleteSectionsOfType(owner, channelId(), ['featured_channels', 'community_posts']);
            await createTextPost(owner, channelId(), postMarker);
            await createSection(owner, channelId(), { type: 'featured_channels', title: first, channelIds: [lectures.id] });
            await createSection(owner, channelId(), { type: 'community_posts', title: second });
            await openManager(page, locale);

            const titles = page.getByTestId('section-item-title');
            const order = async () => (await titles.allInnerTexts()).filter((t) => t === first || t === second);
            await expect.poll(order).toEqual([first, second]);

            // dnd-kit keyboard sensor: Space picks up, ArrowDown moves, Space drops
            await keyboardMoveDown(page, sectionRow(page, first).getByTestId('section-drag-handle'));

            await expect.poll(order).toEqual([second, first]);
            await expect(page.getByTestId('sections-unpublished')).toBeVisible();
            await expect(page.getByTestId('publish-sections')).toHaveText(UI[locale].publish);
            await page.getByTestId('publish-sections').click();
            await expect(page.getByRole('status').filter({ hasText: UI[locale].published })).toBeVisible();
            await expect(page.getByTestId('sections-unpublished')).toHaveCount(0);

            await expect
              .poll(async () => (await listSections(owner, channelId())).map((s) => s.title).filter((t) => t === first || t === second))
              .toEqual([second, first]);

            // The Home tab follows the new order
            await page.goto(`/${locale}/channels/${channelId()}`);
            const homeOrder = page.locator('[data-testid="channel-sections"] > section[data-section-type]');
            await expect
              .poll(async () =>
                (await homeOrder.evaluateAll((els) => els.map((e) => e.getAttribute('data-section-type')))).filter(
                  (t) => t === 'featured_channels' || t === 'community_posts'
                )
              )
              .toEqual(['community_posts', 'featured_channels']);
          } finally {
            await deleteSectionsTitled(owner, channelId(), first);
            await deleteSectionsTitled(owner, channelId(), second);
            await deletePostsContaining(owner, channelId(), postMarker);
          }
        },
        LOCK_WAIT
      );
    });
  }

  test('SECT-006 deletes a section after confirmation (cancel keeps it)', async ({ page }) => {
    const title = tempName('Delete');
    await withLock(
      'sections',
      async () => {
        try {
          await deleteSectionsOfType(owner, channelId(), ['recent_uploads']);
          await createSection(owner, channelId(), { type: 'recent_uploads', title });
          await openManager(page);
          const row = sectionRow(page, title);
          await row.getByRole('button', { name: `Delete section: ${title}` }).click();
          const confirm = page.getByRole('alertdialog');
          await expect(confirm.getByRole('heading', { name: 'Delete section' })).toBeVisible();
          await confirm.getByRole('button', { name: 'Cancel' }).click();
          await expect(confirm).toBeHidden();
          await expect(row).toBeVisible();

          await deleteRow(page, row, 'en');
          await expect.poll(async () => (await listSections(owner, channelId())).some((s) => s.title === title)).toBe(false);
        } finally {
          await deleteSectionsTitled(owner, channelId(), title);
        }
      },
      LOCK_WAIT
    );
  });

  test('SECT-007 Arabic section manager is RTL and fully translated', async ({ page }) => {
    await openManager(page, 'ar');
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'أقسام القناة' })).toBeVisible();
    await expect(page.getByTestId('sections-count')).toContainText(`من ${MAX_SECTIONS} أقسام`);
    await expect(page.getByTestId('publish-sections')).toHaveText('نشر');
    await expect(page.getByTestId('channel-settings-breadcrumb')).toHaveAttribute('aria-label', 'مسار التنقل');

    const dialog = await openAddDialog(page, 'ar');
    await expect(dialog).toHaveAttribute('dir', 'rtl');
    await expect(dialog.getByRole('heading', { name: 'إضافة قسم للقناة' })).toBeVisible();
    await expect(dialog.locator('[data-section-card="recent_uploads"]')).toContainText('أحدث المرئيات');
    await dialog.locator('[data-section-card="featured_videos"]').click();
    await expect(dialog.getByRole('heading', { name: 'مرئيات مميزة' })).toBeVisible();
    await dialog.getByTestId('section-form-submit').click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'اختر عنصرًا واحدًا على الأقل.' })).toBeVisible();
    await dialog.getByRole('button', { name: 'رجوع' }).click();
    await expect(dialog.getByRole('heading', { name: 'إضافة قسم للقناة' })).toBeVisible();
  });

  test('SECT-008 breadcrumb runs right-to-left in Arabic', async ({ page }) => {
    await openManager(page, 'ar');
    // <channel> › Settings › Manage Sections (channel settings belong to the channel, not the user's Settings)
    const items = page.getByTestId('channel-settings-breadcrumb').getByRole('listitem');
    await expect(items).toHaveCount(3);
    const boxes = await items.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: Math.round(r.top) };
      })
    );
    const listRight = await page.getByTestId('channel-settings-breadcrumb').getByRole('list').evaluate((e) => e.getBoundingClientRect().right);
    // The first crumb (the channel) starts at the inline start, i.e. the right edge
    expect(Math.abs(listRight - boxes[0].right)).toBeLessThan(2);
    // Crumbs on the same line run right to left (the list may wrap on phones)
    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].top === boxes[i - 1].top) expect(boxes[i].right).toBeLessThanOrEqual(boxes[i - 1].left + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Every section type: add through the dialog, render for the owner and for a
// visitor, remove. The owner sees a note on a section with nothing to show;
// visitors don't see that section at all.
// ---------------------------------------------------------------------------

interface Fixtures {
  /** A public video of the owner's channel */
  ownVideoId: string;
  /** A public video of another channel (this file's own second creator) */
  otherVideoId: string;
  lecturesChannelId: string;
  lecturesChannelName: string;
  /** A public playlist of the owner's channel holding the own video */
  playlistId: string;
  playlistTitle: string;
  postMarker: string;
}

interface TypeCase {
  /** The dialog card (data-section-card) */
  card: string;
  type: string;
  /** Title for the types that need one */
  title?: string;
  fill?: (dialog: Locator, fx: Fixtures) => Promise<void>;
  /**
   * What a visitor sees once it's added: the content is checked in `content`;
   * 'empty' types have nothing on the test channel (owner note only); 'any'
   * depends on the account's own data (likes, subscriptions) and is checked
   * for agreement between the owner's note and the visitor's view.
   */
  expect: 'content' | 'empty' | 'any';
  content?: (section: Locator, fx: Fixtures, locale: Locale) => Promise<void>;
}

const pickPasted = (testId: string, id: () => string) => async (dialog: Locator) => {
  await fillStable(dialog.getByTestId(`${testId}-paste`), id());
  await dialog.getByTestId(`${testId}-paste`).press('Enter');
  await expect(dialog.getByTestId(`${testId}-selected`).locator('li')).toHaveCount(1);
};

const pickPlaylist = async (dialog: Locator, fx: Fixtures) => {
  // The picker opens with the channel's playlists listed (no typing needed)
  await dialog.getByTestId('playlist-picker-options').locator(`[data-option-id="${fx.playlistId}"]`).click();
  await expect(dialog.getByTestId('playlist-picker-options').locator(`[data-option-id="${fx.playlistId}"]`)).toHaveAttribute('aria-checked', 'true');
};

const videoLink = (section: Locator, videoId: string) => section.locator(`a[href*="vid=${videoId}"]`).first();

const TYPE_CASES = (fx: () => Fixtures): TypeCase[] => [
  {
    card: 'channel_spotlight',
    type: 'channel_spotlight',
    fill: async (dialog) => pickPasted('spotlight-trailer', () => fx().ownVideoId)(dialog),
    expect: 'content',
    content: async (section, f, locale) => {
      // Nobody here is subscribed to the test channel: the trailer plays
      const spot = section.page().getByTestId('section-spotlight');
      await expect(spot).toHaveAttribute('data-spotlight-kind', 'trailer');
      await expect(spot.locator(`a[href="/${locale}/video?vid=${f.ownVideoId}"]`).first()).toBeVisible();
    },
  },
  {
    card: 'featured_videos',
    type: 'featured_videos',
    fill: async (dialog) => pickPasted('video-picker', () => fx().otherVideoId)(dialog),
    expect: 'content',
    content: async (section, f) => {
      await expect(videoLink(section, f.otherVideoId)).toBeVisible();
    },
  },
  {
    card: 'recent_uploads',
    type: 'recent_uploads',
    expect: 'content',
    content: async (section, f) => {
      await expect(videoLink(section, f.ownVideoId)).toBeVisible();
    },
  },
  {
    card: 'popular_uploads',
    type: 'popular_uploads',
    expect: 'content',
    content: async (section, f) => {
      await expect(videoLink(section, f.ownVideoId)).toBeVisible();
    },
  },
  // The test video is landscape, so it is not a Short
  { card: 'shorts', type: 'shorts', expect: 'empty' },
  { card: 'live_streams', type: 'live_streams', expect: 'empty' },
  { card: 'live_streams_past', type: 'live_streams', expect: 'empty' },
  {
    card: 'liked_videos',
    type: 'liked_videos',
    fill: async (dialog) => dialog.getByTestId('section-consent').check(),
    expect: 'any',
  },
  {
    card: 'single_playlist',
    type: 'single_playlist',
    fill: pickPlaylist,
    expect: 'content',
    content: async (section, f, locale) => {
      // Titled with the playlist's name; its videos as a row; the view-all link opens the playlist
      await expect(section.getByRole('heading', { name: f.playlistTitle })).toBeVisible();
      await expect(videoLink(section, f.ownVideoId)).toBeVisible();
      await expect(section.locator(`a[href="/${locale}/playlist/${f.playlistId}"]`).first()).toBeVisible();
    },
  },
  {
    card: 'multiple_playlists',
    type: 'multiple_playlists',
    title: tempName('Playlists'),
    fill: pickPlaylist,
    expect: 'content',
    content: async (section, f, locale) => {
      // The card is the link to the playlist
      const card = section.getByTestId('section-playlist-card').filter({ hasText: f.playlistTitle });
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('href', `/${locale}/playlist/${f.playlistId}`);
    },
  },
  {
    card: 'created_playlists',
    type: 'created_playlists',
    expect: 'content',
    content: async (section, f) => {
      await expect(section.getByTestId('section-playlist-card').filter({ hasText: f.playlistTitle })).toBeVisible();
    },
  },
  {
    card: 'featured_channels',
    type: 'featured_channels',
    title: tempName('Channels'),
    fill: async (dialog, f) => {
      await fillStable(dialog.getByTestId('channel-picker-search'), f.lecturesChannelName);
      const option = dialog.getByTestId('channel-picker-options').locator(`[data-option-id="${f.lecturesChannelId}"]`);
      await option.click();
      await expect(option).toHaveAttribute('aria-checked', 'true');
    },
    expect: 'content',
    content: async (section) => {
      // The one picked channel, under its name in the page's language (the Arabic name differs)
      await expect(section.getByTestId('channel-tile')).toHaveCount(1);
      await expect(section.getByTestId('channel-tile')).toBeVisible();
    },
  },
  {
    card: 'subscribed_channels',
    type: 'subscribed_channels',
    fill: async (dialog) => dialog.getByTestId('section-consent').check(),
    // The owner subscribes to this file's other channel (beforeAll), so it is the one tile
    expect: 'content',
    content: async (section) => {
      await expect(section.getByTestId('channel-tile')).toHaveCount(1);
      await expect(section.getByTestId('channel-tile')).toBeVisible();
    },
  },
  {
    card: 'community_posts',
    type: 'community_posts',
    expect: 'content',
    content: async (section, f) => {
      await expect(section.getByTestId('section-post-card').filter({ hasText: f.postMarker })).toBeVisible();
    },
  },
];

/** The section on the Home tab: the spotlight draws its own hero when it has a video */
function homeSection(page: Page, c: TypeCase): Locator {
  const section = page.locator(`[data-testid="channel-section-${c.type}"]`);
  return c.type === 'channel_spotlight' ? section.or(page.getByTestId('section-spotlight')) : section;
}

async function openHome(page: Page, locale: Locale) {
  await page.goto(`/${locale}/channels/${channelId()}`);
  // Attached, not visible: a Home tab whose only sections have nothing to show renders empty
  await expect(page.getByTestId('tabpanel-home')).toBeAttached();
  // The sections load after the page: wait for the list (or for no list, when a visitor has none)
  await expect(page.getByTestId('channel-sections-loading')).toHaveCount(0, { timeout: 20_000 });
}

async function visitorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: ANONYMOUS_STATE });
  return context.newPage();
}

test.describe('Each section type: add, render, remove', () => {
  test.use({ storageState: AUTH_STATE.single });
  // In order, one at a time (they share the channel), but a failure doesn't skip the rest
  test.describe.configure({ mode: 'default' });

  // Ready first: sections list only videos that finished processing (spotlight, recent, popular, playlists)
  const disposable = setupPublicDisposable(owner, 'Sections', { ready: true });
  let fx: Fixtures | null = null;
  const getFx = () => {
    if (!fx) throw new Error('Section fixtures were not created');
    return fx;
  };

  test.beforeAll(async ({}, testInfo) => {
    // 28 round trips through the dialog and two Home tabs: the rendering is the same in every browser
    test.skip(testInfo.project.name !== 'chromium', 'Every section type runs on the chromium project only');
    test.setTimeout(540_000);
    const video = await disposable.create();
    const lectures = ownOtherChannel();
    const [other] = await listPublicChannelVideos(lectures.id);
    const playlistTitle = tempName('Sections playlist');
    const playlist = await createPlaylist(owner, channelId(), { title: playlistTitle, isPublic: true, videoIds: [video.id] });
    const postMarker = tempName('Sections post');
    await createTextPost(owner, channelId(), postMarker);
    // The owner's own like, so the liked-videos section has something of this file's to show
    const u = userApi(owner);
    await u.api.post(`/api/videos/${video.id}/likes`, {}, { token: u.token, channelId: channelId() });
    // The owner's own subscription, so the subscribed-channels section has a channel to show
    const sub = await apiAs(owner, 'POST', `/api/channels/${lectures.id}/subscriptions`, { channelId: channelId() });
    expect([200, 201, 409], `subscribe to ${lectures.id}`).toContain(sub.status);
    fx = {
      ownVideoId: video.id,
      otherVideoId: other.id,
      lecturesChannelId: lectures.id,
      lecturesChannelName: lectures.name,
      playlistId: playlist.id,
      playlistTitle,
      postMarker,
    };
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    if (fx) {
      const u = userApi(owner);
      await u.api.request(`/api/videos/${fx.ownVideoId}/likes`, { method: 'DELETE', token: u.token, channelId: channelId(), allowStatus: [400, 404] });
      await deletePlaylistQuietly(owner, channelId(), fx.playlistId);
      await deletePostsContaining(owner, channelId(), fx.postMarker);
    }
    await ensureUnsubscribed(owner, channelId(), ownOtherChannel().id).catch(() => undefined);
    await disposable.remove();
  });

  for (const locale of ['en', 'ar'] as const) {
    for (const c of TYPE_CASES(getFx)) {
      test(`SECT-030 ${c.card}: add, render for the owner and a visitor, remove (${locale})`, async ({ page, browser }) => {
        test.setTimeout(LOCK_WAIT + 180_000);
        const f = getFx();
        const ui = UI[locale];
        await withLock(
          'sections',
          async () => {
            const visitor = await visitorPage(browser);
            try {
              await deleteSectionsOfType(owner, channelId(), [c.type]);

              // Add through the dialog
              await openManager(page, locale);
              const dialog = await openAddDialog(page, locale);
              const cardButton = dialog.locator(`[data-section-card="${c.card}"]`);
              await expect(cardButton).toBeEnabled();
              const label = (await cardButton.locator('.opt-title').innerText()).trim();
              await cardButton.click();
              await expect(dialog.getByRole('heading', { name: label })).toBeVisible();
              if (c.title) await fillStable(dialog.getByTestId('section-title-input'), c.title);
              await c.fill?.(dialog, f);
              await dialog.getByTestId('section-form-submit').click();
              await expect(dialog).toBeHidden();
              await expect(page.getByRole('status').filter({ hasText: ui.created })).toBeVisible();

              // The row: titled with the card's label (or the given title); Hidden while it has nothing to show
              const rowTitle = c.title ?? label;
              const row = page.locator(`[data-testid="section-item"][data-section-type="${c.type}"]`);
              await expect(row).toHaveCount(1);
              await expect(row.getByTestId('section-item-title')).toHaveText(rowTitle);
              if (c.expect === 'empty') await expect(row.getByTestId('section-hidden-badge')).toBeVisible();
              if (c.expect === 'content') await expect(row.getByTestId('section-hidden-badge')).toHaveCount(0);

              // Home tab, as the owner
              await openHome(page, locale);
              // The owner sees the page as visitors do: an empty section isn't drawn (the manager marks it Hidden)
              if (c.expect === 'empty') await expect(homeSection(page, c)).toHaveCount(0);
              if (c.expect === 'content') {
                const ownSection = homeSection(page, c);
                await expect(ownSection.first()).toBeVisible();
                await c.content?.(ownSection.first(), f, locale);
              }

              // Home tab, as a signed-out visitor: the section only with content
              await expect(async () => {
                await openHome(visitor, locale);
                const visible = homeSection(visitor, c);
                if (c.expect === 'empty') await expect(visible).toHaveCount(0);
                else {
                  await expect(visible.first()).toBeVisible({ timeout: 5000 });
                  await c.content?.(visible.first(), f, locale);
                }
              }).toPass({ timeout: 60_000, intervals: [2000, 5000, 10_000] });

              // Remove through the manager; it leaves the Home tab
              await openManager(page, locale);
              await deleteRow(page, page.locator(`[data-testid="section-item"][data-section-type="${c.type}"]`), locale);
              await expect.poll(async () => (await listSections(owner, channelId())).some((s) => s.type === c.type)).toBe(false);
              await openHome(page, locale);
              await expect(homeSection(page, c)).toHaveCount(0);
            } finally {
              await visitor.context().close();
              await deleteSectionsOfType(owner, channelId(), [c.type]);
            }
          },
          LOCK_WAIT
        );
      });
    }
  }
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
    await expect(page).toHaveTitle('استكشف المرئيات | الأمة الآن');
    await expect(page.getByRole('heading', { level: 1, name: 'استكشف المرئيات' })).toBeVisible();
    await expect(page.locator('main').first()).toHaveAttribute('dir', 'rtl');
  });
});
