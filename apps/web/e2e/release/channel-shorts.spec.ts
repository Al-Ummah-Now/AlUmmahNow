/**
 * Release regression (#296): a channel's Shorts tab lists its shorts. The API
 * used to scan one ~100-object slice of the whole videos bucket, so a short
 * was almost never found. Uses public shorts already in the environment.
 *
 * QA is shared with other suites that create public shorts and delete them a
 * moment later ("E2E Temp …" uploads), and the anonymous first page of
 * GET /api/videos is edge-cached for 30 s, so a short picked from it may
 * already be gone. Stable shorts are preferred, and each candidate is checked
 * with an uncached GET /api/videos/:id before and after reading the Shorts
 * tab. A short that exists the whole time but is not listed fails the test;
 * one that disappears meanwhile is replaced by the next candidate.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';

interface ListedVideo {
  id: string;
  title?: string;
  channelId?: string;
  duration?: number;
  isLive?: boolean;
  isPublic?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
  uploadStatus?: string;
  dateCreated?: string;
}

const MAX_CANDIDATES = 5;
const MAX_SHORTS_PAGES = 5;
/** Fixtures other suites create and delete during their runs. */
const TEMPORARY_TITLE = /^(E2E Temp|Release E2E)\b/;
const STABLE_AGE_MS = 15 * 60 * 1000;

function isPublicShort(v: ListedVideo | null): v is ListedVideo {
  return !!v && !!v.channelId && (v.duration ?? 0) > 0 && (v.duration ?? 0) < 60
    && !v.isLive && v.isPublic !== false && !v.isDeleted && !v.isHidden;
}

/** Fixtures and anything created in the last few minutes may be deleted mid-test. */
function isStable(v: ListedVideo): boolean {
  const created = Date.parse(v.dateCreated ?? '');
  return !TEMPORARY_TITLE.test(v.title ?? '') && Number.isFinite(created) && Date.now() - created > STABLE_AGE_MS;
}

/** Public shorts from the first pages of GET /api/videos, stable ones first. */
async function candidateShorts(): Promise<ListedVideo[]> {
  const found: ListedVideo[] = [];
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const res = await fetch(`${target().api}/api/videos?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    expect(res.ok, `GET /api/videos answered ${res.status}`).toBe(true);
    const body = (await res.json()) as { data?: ListedVideo[]; cursor?: string };
    found.push(...(body.data ?? []).filter(isPublicShort));
    if (found.some(isStable) || !body.cursor || (body.data ?? []).length === 0) break;
    cursor = body.cursor;
  }
  return [...found.filter(isStable), ...found.filter((v) => !isStable(v))].slice(0, MAX_CANDIDATES);
}

/** The video as stored now (uncached), or null once it is gone. */
async function currentVideo(id: string): Promise<ListedVideo | null> {
  const res = await fetch(`${target().api}/api/videos/${id}`, { cache: 'no-store' });
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
    const res = await fetch(`${target().api}/api/channels/${channelId}/shorts?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
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
    const candidates = await candidateShorts();
    test.skip(candidates.length === 0, 'no public short (under 60 s) in this environment');

    const vanished: string[] = [];
    for (const candidate of candidates) {
      const before = await currentVideo(candidate.id);
      if (!isPublicShort(before) || before.channelId !== candidate.channelId) {
        vanished.push(candidate.id);
        continue;
      }

      const listed = (await shortsTabIds(before.channelId!)).includes(before.id);
      if (!listed) {
        // Deleted or changed while the tab was read: not a listing bug
        const after = await currentVideo(before.id);
        if (!isPublicShort(after) || after.channelId !== before.channelId) {
          vanished.push(before.id);
          continue;
        }
      }
      expect(listed, `short ${before.id} (still public, ${before.duration}s) is on its channel's Shorts list`).toBe(true);

      const channel = await fetch(`${target().api}/api/channels/${before.channelId}`);
      const body = (await channel.json()) as { result?: { videosCount?: number }; videosCount?: number };
      expect((body.result ?? body).videosCount ?? 0, 'channel videosCount counts its public videos').toBeGreaterThan(0);
      return;
    }
    test.skip(true, `every candidate short was deleted or changed during the test: ${vanished.join(', ')}`);
  });
});
