/**
 * Seeded fixtures for the release suite: content the seed guarantees on QA and
 * stage (apps/web/e2e/seed/seed-config.ts, run by deploy.yml / release.yml),
 * found by its fixed seed title. Specs that only need "a video" or "a channel"
 * use these instead of whatever a shared list happens to return first: the
 * newest public video is often another spec's upload, which is still encoding,
 * becomes the featured video mid-test, or is deleted while this spec runs.
 *
 * Specs that change content create their own (studio.ts, uploads); these are
 * read-only for every spec. Production has no seed, so nothing here runs there.
 *
 * A missing fixture fails with what to do (the environment is not seeded), never
 * a skip: a suite that silently skips its playback specs is not a passing suite.
 */
import { expect } from '@playwright/test';
import { target } from './targets';
import type { PublicVideo } from './videos';

/** Seed titles (seed-config.ts SEED_CHANNELS): change both together. */
export const FIXTURE_TITLES = {
  /** Landscape 640x360, 75 s, subtitles and chapters, channel "QA — Lectures" */
  landscape: 'QA Lecture 1 — Introduction to Tafsir',
  /** Landscape, 70 s, same channel: the related list of `landscape` is never empty */
  landscape2: 'QA Lecture 2 — Hadith Basics',
  /** Portrait, 20 s: a Short */
  vertical: 'QA Nasheed Short — Vertical Clip',
} as const;

export type FixtureKey = keyof typeof FIXTURE_TITLES;

export interface SeededFixtures {
  videos: Record<FixtureKey, PublicVideo>;
  /** Channel of `landscape`/`landscape2` (the seed's main channel, with a community post) */
  lecturesChannelId: string;
  /** Channel of `vertical` */
  nasheedsChannelId: string;
}

const SEED_HINT = 'run the seed for this environment (apps/web/e2e/seed/seed-qa.ts; CLAUDE.md "Release regressions")';

/** Ready, public, encoded and playable right now. */
function playable(v: PublicVideo): boolean {
  return v.uploadStatus === 'ready' && v.isPublic !== false && !v.isLive && (v.availableResolutions?.length ?? 0) > 0 && !!v.playUrl;
}

async function lookUp(): Promise<SeededFixtures> {
  const wanted = new Map<string, FixtureKey>(Object.entries(FIXTURE_TITLES).map(([k, t]) => [t, k as FixtureKey]));
  const found: Partial<Record<FixtureKey, PublicVideo>> = {};
  let cursor = '';
  // The seed's videos are old: every page is read until all are found (bounded)
  for (let page = 0; page < 20 && Object.keys(found).length < wanted.size; page++) {
    const res = await fetch(`${target().api}/api/videos?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' });
    expect(res.ok, `GET /api/videos answered ${res.status}`).toBe(true);
    const body = (await res.json()) as { data?: PublicVideo[]; cursor?: string | null };
    for (const v of body.data ?? []) {
      const key = wanted.get(v.title);
      if (key && !found[key] && playable(v)) found[key] = v;
    }
    if (!body.cursor) break;
    cursor = body.cursor;
  }
  for (const [title, key] of wanted) {
    expect(found[key], `seeded fixture "${title}" is not a ready public video here: ${SEED_HINT}`).toBeTruthy();
  }
  const videos = found as Record<FixtureKey, PublicVideo>;
  expect(videos.landscape.channelId, 'the seeded lecture has no channel').toBeTruthy();
  expect(videos.vertical.channelId, 'the seeded Short has no channel').toBeTruthy();
  return { videos, lecturesChannelId: videos.landscape.channelId!, nasheedsChannelId: videos.vertical.channelId! };
}

let cached: Promise<SeededFixtures> | null = null;

/** The seeded fixtures (looked up once per worker). */
export function seeded(): Promise<SeededFixtures> {
  cached ??= lookUp().catch((e: unknown) => {
    cached = null;
    throw e;
  });
  return cached;
}

/** A seeded fixture video. */
export async function fixtureVideo(key: FixtureKey): Promise<PublicVideo> {
  return (await seeded()).videos[key];
}
