import { randomBytes } from 'node:crypto';
import { expect, type Locator, type Page, type TestType } from '@playwright/test';
import { ns, useOwnData as ownData, type CreatedVideo, type DataScope } from '../release/builders';
import { apiFetch, type WebUser } from '../release/web-session';
import { target } from '../release/targets';

/**
 * Public, ready videos a spec file owns (owner rule 2026-11-12: specs seed their own data). In
 * beforeAll a new creator signs up, makes a channel and uploads the videos through the real APIs
 * (release/builders.ts); afterAll deletes them. Pages that list public videos (home, explore,
 * search) then have content without the global seed or another run's uploads.
 *
 *   const own = ownPublicVideos(test, 'home');
 *   test('…', async ({ page }) => { own.videos()[0].id … });
 */
export interface OwnVideoSpec {
  title?: string;
  /** Arabic title (titleLocalized.ar), set after upload. */
  titleAr?: string;
  /** Platform category id (e.g. quran_tafsir), set after upload. */
  category?: string;
}

/** What else the file's own channel gets, besides its videos. */
export interface OwnChannelSpec {
  /**
   * Names exactly as given (channel `name`, video titles), without the run tag: for visual snapshots,
   * whose headers are not masked. Cleanup still deletes them (DataScope), and the leftover check
   * finds anything left through the run user's id.
   */
  exactNames?: boolean;
  /** The channel's name (default: `E2E <label> <run tag>`) */
  name?: string;
  /** Arabic name and English/Arabic descriptions (PUT /api/channels/:id) */
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  /** A public playlist of all the videos */
  playlist?: boolean;
  /** Public text posts on the Community tab */
  posts?: number;
}

export type OwnVideo = CreatedVideo & { titleLocalized?: { en?: string; ar?: string } };

export interface OwnPublicVideos {
  videos: () => OwnVideo[];
  owner: () => WebUser;
  channelId: () => string;
  channelName: () => string;
  playlistId: () => string;
  postIds: () => string[];
  /** The card of the spec's newest own video in a listing (never another run's or the seed's). */
  card: (page: Page) => Locator;
  /**
   * The card in a "Load More" listing (home, all videos): other specs on the same stack upload
   * newer videos while this file runs, so it can be past the first page. Loads more until it shows.
   */
  showCard: (page: Page) => Promise<Locator>;
  data: DataScope;
}

// The legacy suite extends the base test with its own fixtures; only beforeAll/afterAll are used
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTest = TestType<any, any>;

export function ownPublicVideos(test: AnyTest, label: string, specs: OwnVideoSpec[] = [{}], channel: OwnChannelSpec = {}): OwnPublicVideos {
  const data = ownData(test as never);
  let owner: WebUser | null = null;
  let channelId = '';
  // Tagged with ns() (run, spec file, worker) in beforeAll, so the job's leftover check can find it
  let channelName = '';
  let playlistId = '';
  const postIds: string[] = [];
  const videos: OwnVideo[] = [];

  test.beforeAll(async ({ browser }) => {
    // Sign-up, channel, uploads and their encodes (16 for the home grid)
    test.setTimeout(300_000 + specs.length * 20_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      channelName = channel.name ?? (channel.exactNames ? `E2E ${label}` : `E2E ${label} ${ns()} ${randomBytes(2).toString('hex')}`);
      owner = await data.createUser(page, label);
      await data.grantCreator(owner);
      channelId = await data.createChannel(owner, { name: channelName });
      for (const spec of specs) {
        // Readiness is awaited below, for all of them: uploads go first so the stack encodes them together
        const video: OwnVideo = await data.createVideo(owner, channelId, { clip: 'landscape40', isPublic: true, title: spec.title && (channel.exactNames ? spec.title : `${spec.title} ${ns()}`), waitReady: false });
        const update: Record<string, unknown> = {};
        if (spec.category) update.category = spec.category;
        if (spec.titleAr) update.titleLocalized = video.titleLocalized = { en: video.title, ar: spec.titleAr };
        if (Object.keys(update).length > 0) {
          const res = await apiFetch(owner, `/api/videos/${video.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', channelId },
            body: JSON.stringify(update),
          });
          expect(res.status, `update ${Object.keys(update).join(', ')}: ${await res.clone().text()}`).toBeLessThan(300);
        }
        videos.push(video);
      }
      // Polled here rather than the builders' 60 s: a shard's stack encodes many files' uploads at once
      for (const video of videos) {
        await expect
          .poll(async () => ((await (await fetch(`${target().api}/api/videos/${video.id}`, { cache: 'no-store' })).json().catch(() => ({}))) as { uploadStatus?: string }).uploadStatus, {
            message: `"${video.title}" never became ready`,
            timeout: 180_000,
            intervals: [1000, 2000, 5000],
          })
          .toBe('ready');
      }
      if (channel.playlist) playlistId = await data.createPlaylist(owner, channelId, { title: `E2E playlist ${channelName}`, videoIds: videos.map((v) => v.id) });
      for (let i = 0; i < (channel.posts ?? 0); i++) postIds.push(await data.createPost(owner, channelId, { text: `E2E post ${i + 1} of ${channelName}` }));
      if (channel.nameAr || channel.description || channel.descriptionAr) {
        // Arabic name and descriptions (what the channel header specs check), read back until they hold
        const res = await apiFetch(owner, `/api/channels/${channelId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', channelId },
          body: JSON.stringify({
            ...(channel.description ? { description: channel.description } : {}),
            nameLocalized: { en: channelName, ar: channel.nameAr ?? '' },
            descriptionLocalized: { en: channel.description ?? '', ar: channel.descriptionAr ?? '' },
          }),
        });
        expect(res.status, `channel update: ${await res.clone().text()}`).toBeLessThan(300);
        await expect
          .poll(async () => {
            const body = (await (await fetch(`${target().api}/api/channels/${channelId}`, { cache: 'no-store' })).json().catch(() => ({}))) as {
              result?: { description?: string; nameLocalized?: Record<string, string> };
              description?: string;
              nameLocalized?: Record<string, string>;
            };
            const ch = body.result ?? body;
            return { description: ch.description ?? '', ar: ch.nameLocalized?.ar ?? '' };
          }, { message: 'the channel update did not stick (GET /api/channels/:id)', timeout: 30_000 })
          .toEqual({ description: channel.description ?? '', ar: channel.nameAr ?? '' });
      }
    } finally {
      await context.close();
    }
  });

  const cardOf = (page: Page) => page.locator(`[data-testid="video-card"][data-video-id="${videos[videos.length - 1]?.id ?? 'not-created'}"]`);

  return {
    videos: () => {
      expect(videos.length, 'the spec\'s own public videos were not created').toBeGreaterThan(0);
      return videos;
    },
    owner: () => {
      if (!owner) throw new Error('the spec\'s own creator was not created');
      return owner;
    },
    channelId: () => channelId,
    channelName: () => channelName,
    playlistId: () => playlistId,
    postIds: () => postIds,
    card: (page: Page) => cardOf(page),
    showCard: async (page: Page) => {
      const card = cardOf(page);
      const cards = page.getByTestId('video-card');
      const more = page.getByRole('main').getByRole('button', { name: /^(Load More|تحميل المزيد|View All)$/ });
      // Retried as a whole: the grid can still be loading (no button yet) when a pass looks
      await expect(async () => {
        if (await card.isVisible()) return;
        await expect(cards.first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('video-grid-loading')).toHaveCount(0, { timeout: 10_000 });
        if ((await more.isVisible()) && (await more.isEnabled())) {
          const before = await cards.count();
          await more.click();
          await expect.poll(() => cards.count(), { timeout: 15_000 }).toBeGreaterThan(before);
        }
        await expect(card).toBeVisible({ timeout: 2_000 });
      }, 'this file\'s own video card in the listing').toPass({ timeout: 90_000, intervals: [500, 1000, 2000] });
      return card;
    },
    data,
  };
}
