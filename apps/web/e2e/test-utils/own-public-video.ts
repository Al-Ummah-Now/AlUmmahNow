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
    test.setTimeout(180_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      channelName = `E2E ${label} ${ns()} ${Math.random().toString(36).slice(2, 6)}`;
      owner = await data.createUser(page, label);
      await data.grantCreator(owner);
      channelId = await data.createChannel(owner, { name: channelName });
      for (const spec of specs) {
        const video: OwnVideo = await data.createVideo(owner, channelId, { clip: 'landscape40', isPublic: true, title: spec.title && `${spec.title} ${ns()}` });
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
      if (channel.playlist) playlistId = await data.createPlaylist(owner, channelId, { title: `E2E playlist ${channelName}`, videoIds: videos.map((v) => v.id) });
      for (let i = 0; i < (channel.posts ?? 0); i++) postIds.push(await data.createPost(owner, channelId, { text: `E2E post ${i + 1} of ${channelName}` }));
      // The anonymous first page of GET /api/videos is edge-cached for 30 s (videoList.ts): wait until
      // it lists the newest one, so pages that read it (home, all videos) show this file's videos on the first load
      await expect
        .poll(async () => {
          const res = await fetch(`${target().api}/api/videos?limit=15`);
          const ids = new Set((((await res.json().catch(() => ({}))) as { data?: { id: string }[] }).data ?? []).map((v) => v.id));
          return ids.has(videos[videos.length - 1].id);
        }, { message: 'the newest own video never reached the first page of GET /api/videos', timeout: 75_000, intervals: [2000, 5000] })
        .toBe(true);
    } finally {
      await context.close();
    }
  });

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
    card: (page: Page) => page.locator(`[data-testid="video-card"][data-video-id="${videos[videos.length - 1]?.id ?? 'not-created'}"]`),
    data,
  };
}
