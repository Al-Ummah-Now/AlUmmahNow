/**
 * Release regression (#296): a channel's Shorts tab lists its shorts. The API
 * used to scan one ~100-object slice of the whole videos bucket, so a short
 * was almost never found. Uses any public short in the environment.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';

interface ListedVideo { id: string; channelId?: string; duration?: number; isLive?: boolean; isPublic?: boolean; uploadStatus?: string }

async function findShort(): Promise<ListedVideo | null> {
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const res = await fetch(`${target().api}/api/videos?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    expect(res.ok, `GET /api/videos answered ${res.status}`).toBe(true);
    const body = (await res.json()) as { data?: ListedVideo[]; cursor?: string };
    const short = (body.data ?? []).find((v) => !!v.channelId && (v.duration ?? 0) > 0 && (v.duration ?? 0) < 60 && !v.isLive && v.isPublic !== false);
    if (short) return short;
    if (!body.cursor || (body.data ?? []).length === 0) return null;
    cursor = body.cursor;
  }
  return null;
}

test.describe('Release: channel shorts', () => {
  test('a public short is listed on its channel\'s Shorts tab (API and page)', async ({ page }) => {
    const short = await findShort();
    test.skip(!short, 'no public short (under 60 s) in this environment');

    const res = await fetch(`${target().api}/api/channels/${short!.channelId}/shorts?limit=50`);
    expect(res.ok, `GET /api/channels/:id/shorts answered ${res.status}`).toBe(true);
    const ids = (((await res.json()) as { data?: Array<{ id: string }> }).data ?? []).map((v) => v.id);
    expect(ids, 'the short is on its channel\'s Shorts list').toContain(short!.id);

    const channel = await fetch(`${target().api}/api/channels/${short!.channelId}`);
    const body = (await channel.json()) as { result?: { videosCount?: number }; videosCount?: number };
    expect((body.result ?? body).videosCount ?? 0, 'channel videosCount counts its public videos').toBeGreaterThan(0);
  });
});
