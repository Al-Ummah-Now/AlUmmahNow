import { expect, type Locator, type Page, type TestType } from '@playwright/test';
import { useOwnData, type CreatedVideo, type DataScope } from '../release/builders';
import { apiFetch, type WebUser } from '../release/web-session';

/**
 * Public, ready videos a spec file owns (owner rule 2026-11-12: specs seed their own data). In
 * beforeAll a new creator signs up, makes a channel and uploads the videos through the real APIs
 * (release/builders.ts); afterAll deletes them. Pages that list public videos (home, explore,
 * search) then have content without the global seed or another run's uploads.
 *
 *   const own = usePublicVideos(test, 'home');
 *   test('…', async ({ page }) => { own.videos()[0].id … });
 */
export interface OwnVideoSpec {
  title?: string;
  /** Platform category id (e.g. quran_tafsir), set after upload. */
  category?: string;
}

export interface OwnPublicVideos {
  videos: () => CreatedVideo[];
  owner: () => WebUser;
  channelId: () => string;
  /** The card of the spec's first own video in a listing (never another run's or the seed's). */
  card: (page: Page) => Locator;
  data: DataScope;
}

// The legacy suite extends the base test with its own fixtures; only beforeAll/afterAll are used
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTest = TestType<any, any>;

export function usePublicVideos(test: AnyTest, label: string, specs: OwnVideoSpec[] = [{}]): OwnPublicVideos {
  const data = useOwnData(test as never);
  let owner: WebUser | null = null;
  let channelId = '';
  const videos: CreatedVideo[] = [];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      owner = await data.createUser(page, label);
      await data.grantCreator(owner);
      channelId = await data.createChannel(owner);
      for (const spec of specs) {
        const video = await data.createVideo(owner, channelId, { clip: 'landscape40', isPublic: true, title: spec.title });
        if (spec.category) {
          const res = await apiFetch(owner, `/api/videos/${video.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', channelId },
            body: JSON.stringify({ category: spec.category }),
          });
          expect(res.status, `set category ${spec.category}: ${await res.clone().text()}`).toBeLessThan(300);
        }
        videos.push(video);
      }
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
    card: (page: Page) => page.locator(`[data-testid="video-card"][data-video-id="${videos[0]?.id ?? 'not-created'}"]`),
    data,
  };
}
