/**
 * The videos a playback/watch spec needs, created by the spec itself (builders.ts) instead of read
 * from the global seed or "the newest public video":
 *
 *   const own = useOwnVideos(test);
 *   test('…', async ({ page }) => {
 *     const video = await own('landscape');      // ready, public, playable
 *   });
 *
 * beforeAll (per spec file and worker): a new creator with a channel uploads
 * - landscape:  90 s, chapters and subtitles (history/resume need ≥ 75 s),
 * - landscape2: 40 s, same channel (the related list of `landscape` is never empty),
 * - vertical:   a Short (portrait),
 * all public and ready. afterAll deletes them for good (DataScope.cleanup).
 */
import { expect, type test as base } from '@playwright/test';
import { useOwnData } from './builders';
import { target } from './targets';
import type { PublicVideo } from './videos';

export type OwnVideoKey = 'landscape' | 'landscape2' | 'vertical';

export interface OwnVideos {
  videos: Record<OwnVideoKey, PublicVideo>;
  /** The channel all three are on */
  channelId: string;
}

async function publicVideo(id: string): Promise<PublicVideo> {
  const res = await fetch(`${target().api}/api/videos/${id}`, { cache: 'no-store' });
  expect(res.ok, `GET /api/videos/${id} answered ${res.status}`).toBe(true);
  return (await res.json()) as PublicVideo;
}

/** Registers the spec file's own videos; the returned function gives one (or `all()` the set). */
export function useOwnVideos(test: typeof base): ((key: OwnVideoKey) => Promise<PublicVideo>) & { all: () => Promise<OwnVideos> } {
  const data = useOwnData(test);
  let built: OwnVideos | null = null;
  test.beforeAll(async ({ browser }) => {
    // Sign-up, channel and three uploads: allow for a slow environment
    test.setTimeout(10 * 60 * 1000);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const owner = await data.createUser(page, 'own-videos');
      await data.grantCreator(owner);
      const channelId = await data.createChannel(owner);
      const [landscape, landscape2, vertical] = await Promise.all([
        data.createVideo(owner, channelId, { clip: 'landscape90', chapters: true, subtitles: true }),
        data.createVideo(owner, channelId, { clip: 'landscape40' }),
        data.createVideo(owner, channelId, { clip: 'vertical' }),
      ]);
      built = {
        channelId,
        videos: {
          landscape: await publicVideo(landscape.id),
          landscape2: await publicVideo(landscape2.id),
          vertical: await publicVideo(vertical.id),
        },
      };
    } finally {
      await context.close();
    }
  });
  const all = async (): Promise<OwnVideos> => {
    expect(built, 'useOwnVideos: the beforeAll that creates the videos did not run').toBeTruthy();
    return built as OwnVideos;
  };
  return Object.assign(async (key: OwnVideoKey) => (await all()).videos[key], { all });
}
