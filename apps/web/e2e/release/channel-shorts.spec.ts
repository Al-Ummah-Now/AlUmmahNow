/**
 * Release regression (#296): a channel's Shorts tab lists its shorts. The API
 * used to scan one ~100-object slice of the whole videos bucket, so a short
 * was almost never found.
 *
 * Uses the seeded Short (fixtures.ts), which no spec changes or deletes: the
 * shorts other suites upload and delete a moment later made this spec pick a
 * short that was gone by the time the tab was read.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { fetchRetry } from './net';
import { useOwnVideos } from './own-videos';

// This spec's own videos (created in beforeAll, deleted in afterAll): never the seed's or the newest public one
const own = useOwnVideos(test);
// It signs a user up through the auth server: traces and video would hold the password and code
test.use({ trace: 'off', video: 'off' });

interface ListedVideo {
  id: string;
  title?: string;
  channelId?: string;
  duration?: number;
  /** Shared rule (≤ 3 min and vertical/square, or the uploader's choice), computed by the API */
  isShort?: boolean;
  isLive?: boolean;
  isPublic?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
  uploadStatus?: string;
  dateCreated?: string;
}

const MAX_SHORTS_PAGES = 5;

/** The video as stored now (uncached), or null once it is gone. */
async function currentVideo(id: string): Promise<ListedVideo | null> {
  const res = await fetchRetry(`${target().api}/api/videos/${id}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  expect(res.ok, `GET /api/videos/:id answered ${res.status}`).toBe(true);
  const body = (await res.json()) as ListedVideo & { result?: ListedVideo };
  return body.result ?? body;
}

/** Ids on the channel's Shorts tab (first few pages). */
async function shortsTabIds(channelId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_SHORTS_PAGES; page++) {
    const res = await fetchRetry(`${target().api}/api/channels/${channelId}/shorts?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    expect(res.ok, `GET /api/channels/:id/shorts answered ${res.status}`).toBe(true);
    const body = (await res.json()) as { data?: Array<{ id: string }>; cursor?: string };
    ids.push(...(body.data ?? []).map((v) => v.id));
    if (!body.cursor) break;
    cursor = body.cursor;
  }
  return ids;
}

test.describe('Release: channel shorts', () => {
  test('a public short is listed on its channel\'s Shorts tab (API)', async () => {
    const short = await currentVideo((await own('vertical')).id);
    expect(short, 'the seeded Short is gone: re-run the seed').not.toBeNull();
    expect(short!.isShort, 'the seeded vertical clip is a Short by the shared rule').toBe(true);
    expect(short!.channelId, 'the seeded Short has a channel').toBeTruthy();

    const listed = (await shortsTabIds(short!.channelId!)).includes(short!.id);
    expect(listed, `short ${short!.id} (public, ${short!.duration}s) is on its channel's Shorts list`).toBe(true);

    const channel = await fetchRetry(`${target().api}/api/channels/${short!.channelId}`);
    const body = (await channel.json()) as { result?: { videosCount?: number }; videosCount?: number };
    expect((body.result ?? body).videosCount ?? 0, 'channel videosCount counts its public videos').toBeGreaterThan(0);
  });
});
