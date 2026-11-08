import * as fs from 'fs';
import * as path from 'path';
import { ApiClient } from '../seed/seed-api';
import { AUTH_STATE, type AuthUser } from './auth-state';

/**
 * Real QA videos for the E2E users.
 *
 * The web app fetches videos through server actions, so browser route mocks
 * never reach api-videos. Specs instead work against videos that really exist
 * in the target environment:
 *
 * - Seed videos (ensureSeedVideos): a fixed, idempotent set per user, matched
 *   by title. Read-only for specs; never edit or delete them in a test.
 * - Disposable videos (createDisposableVideo): created by a spec for edit /
 *   delete flows and removed again (deleteVideoQuietly) when it is done.
 *
 * Uploads use a committed 4-second H.264/AAC clip (test-fixtures/e2e-sample.mp4)
 * through the api-videos TUS proxy, exactly like the web uploader.
 */

export const API_URL = (process.env.API_URL || 'https://videos.api.qa.alummahnow.net').replace(/\/$/, '');
const SAMPLE_VIDEO = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');
/** 40-second clip for flows that need a longer video (chapters must be >= 10s each) */
const LONG_SAMPLE_VIDEO = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample-40s.mp4');
const SAMPLES = {
  short: { file: SAMPLE_VIDEO, duration: 4 },
  long: { file: LONG_SAMPLE_VIDEO, duration: 40 },
} as const;
export type SampleVideo = keyof typeof SAMPLES;
const LOCK_DIR = path.join(__dirname, '..', '.auth', '.seed-lock');
const LOCK_STALE_MS = 5 * 60 * 1000;

export interface E2EVideo {
  id: string;
  title: string;
  channelId: string;
  userId?: string;
  isPublic?: boolean;
  uploadStatus?: string;
  thumbnailUrl?: string;
  playUrl?: string;
  scheduledPublishDate?: string;
  scheduledPublishStatus?: string;
  titleLocalized?: Record<string, string>;
  duration?: number;
}

export interface UserApi {
  api: ApiClient;
  token: string;
  userId: string;
  channelIds: string[];
}

interface SeedSpec {
  title: string;
  titleAr: string;
  channelIndex: number;
  isPublic: boolean;
  /** Days from now the video is scheduled to publish */
  scheduleInDays?: number;
}

/**
 * Seed videos are all private so they never surface in public listings (home
 * "recent", search). Specs that need a public video create a disposable one
 * (createDisposableVideo(..., { isPublic: true })) and delete it afterwards.
 */
export const SEED_TITLES = {
  singleVideo: 'E2E Seed Video',
  singlePrivate: 'E2E Seed Private Video',
  singleScheduled: 'E2E Seed Scheduled Video',
  multiOne: 'E2E Seed Multi Channel One Video',
  multiTwo: 'E2E Seed Multi Channel Two Video',
} as const;

const SEED: Partial<Record<AuthUser, SeedSpec[]>> = {
  single: [
    { title: SEED_TITLES.singleVideo, titleAr: 'فيديو اختبار', channelIndex: 0, isPublic: false },
    { title: SEED_TITLES.singlePrivate, titleAr: 'فيديو اختبار خاص', channelIndex: 0, isPublic: false },
    { title: SEED_TITLES.singleScheduled, titleAr: 'فيديو اختبار مجدول', channelIndex: 0, isPublic: false, scheduleInDays: 10 },
  ],
  multi: [
    { title: SEED_TITLES.multiOne, titleAr: 'فيديو القناة الأولى', channelIndex: 0, isPublic: false },
    { title: SEED_TITLES.multiTwo, titleAr: 'فيديو القناة الثانية', channelIndex: 1, isPublic: false },
  ],
};

/** Seed titles from earlier versions of this file (public); removed when found */
const RETIRED_SEED_TITLES = ['E2E Seed Public Video'];

interface StoredState {
  cookies: Array<{ name: string; value: string }>;
}

interface SessionAccount {
  accessToken?: string;
  channels?: Array<{ id: string; isMain?: boolean }>;
}

/** Builds an authenticated api-videos client from a stored E2E session */
export function userApi(user: AuthUser): UserApi {
  const state = JSON.parse(fs.readFileSync(AUTH_STATE[user], 'utf8')) as StoredState;
  const cookie = state.cookies.find((c) => c.name === 'al_ummah_session');
  if (!cookie) throw new Error(`No session cookie for ${user}`);
  let raw = cookie.value;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // not URI-encoded
  }
  const data = JSON.parse(raw) as { activeUserId: string; accounts: Record<string, SessionAccount> };
  const account = data.accounts[data.activeUserId];
  if (!account?.accessToken) throw new Error(`No access token for ${user}`);
  const channels = [...(account.channels || [])].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
  return {
    api: new ApiClient(API_URL),
    token: account.accessToken,
    userId: data.activeUserId,
    channelIds: channels.map((c) => c.id),
  };
}

/** All videos the user owns across its channels (public, private, scheduled) */
export async function listOwnVideos(u: UserApi): Promise<E2EVideo[]> {
  if (u.channelIds.length === 0) return [];
  const videos: E2EVideo[] = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    // Later pages 500 on API builds without the videoSearch cursor fix; stop there
    const res = await u.api.get<{ data?: E2EVideo[]; cursor?: string }>(
      `/api/videos/search?limit=100&isOwner=true&channelIds=${u.channelIds.join(',')}${cursor ? `&cursor=${cursor}` : ''}`,
      { token: u.token, channelId: u.channelIds[0], allowStatus: page > 0 ? [500] : [] },
    );
    if (res.status !== 200) break;
    videos.push(...(res.data.data || []));
    cursor = res.data.cursor || '';
    if (!cursor) break;
  }
  return videos;
}

export async function getVideo(u: UserApi, videoId: string): Promise<E2EVideo | null> {
  const res = await u.api.get<E2EVideo>(`/api/videos/${videoId}`, { token: u.token, allowStatus: [403, 404] });
  return res.status === 200 ? res.data : null;
}

/** Uploads the sample clip as a new video and returns it */
export async function uploadVideo(
  u: UserApi,
  opts: { title: string; titleAr?: string; isPublic: boolean; channelIndex?: number; description?: string; sample?: SampleVideo },
): Promise<E2EVideo> {
  const channelId = u.channelIds[opts.channelIndex ?? 0];
  if (!channelId) throw new Error('User has no channel to upload to');
  const sample = SAMPLES[opts.sample ?? 'short'];
  const fileSize = fs.statSync(sample.file).size;
  const description = opts.description ?? 'Uploaded by the Playwright E2E suite';
  const initiate = await u.api.post<{ result?: { videoId?: string; tusSessionId?: string } }>(
    '/api/videos/upload/initiate',
    {
      title: opts.title,
      titleLocalized: { en: opts.title, ar: opts.titleAr || '' },
      description,
      descriptionLocalized: { en: description, ar: '' },
      fileSize,
      mimeType: 'video/mp4',
      isPublic: opts.isPublic,
      tags: 'e2e',
    },
    { token: u.token, channelId },
  );
  const videoId = initiate.data.result?.videoId;
  const tusSessionId = initiate.data.result?.tusSessionId;
  if (!videoId || !tusSessionId) throw new Error(`Upload initiate for "${opts.title}" returned no videoId/tusSessionId`);
  await u.api.tusUpload({ token: u.token, tusSessionId, videoId, filePath: sample.file, mimeType: 'video/mp4' });
  await u.api.post('/api/videos/upload/complete', { videoId, fileSize, duration: sample.duration }, { token: u.token, channelId });
  const video: E2EVideo = { id: videoId, title: opts.title, channelId, isPublic: opts.isPublic };
  // initiate stores only the plain title/description; set the localized fields explicitly
  await setLocalizedMetadata(u, video, { en: opts.title, ar: opts.titleAr || '' }, { en: description, ar: '' });
  // GET /api/videos/:id is briefly cached; wait until the new video (with its
  // metadata) is readable so pages opened next do not see a 404
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const stored = await getVideo(u, videoId);
    if (stored?.titleLocalized?.en === opts.title) return { ...video, ...stored };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return video;
}

async function setLocalizedMetadata(
  u: UserApi,
  video: E2EVideo,
  titleLocalized: Record<string, string>,
  descriptionLocalized: Record<string, string>,
): Promise<void> {
  await u.api.put(`/api/videos/${video.id}`, { titleLocalized, descriptionLocalized }, { token: u.token, channelId: video.channelId });
}

async function ensureSchedule(u: UserApi, video: E2EVideo, days: number): Promise<void> {
  const minLead = 2 * 24 * 60 * 60 * 1000;
  const current = video.scheduledPublishDate ? new Date(video.scheduledPublishDate).getTime() : 0;
  if (video.scheduledPublishStatus === 'scheduled' && current - Date.now() > minLead) return;
  const when = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  when.setUTCHours(12, 0, 0, 0);
  if (video.scheduledPublishStatus === 'scheduled') {
    await u.api.request(`/api/videos/${video.id}/schedule`, {
      method: 'DELETE',
      token: u.token,
      channelId: video.channelId,
      allowStatus: [404],
    });
  }
  await u.api.post(
    `/api/videos/${video.id}/schedule`,
    { scheduledPublishDate: when.toISOString(), timezone: 'UTC', notifyOnPublish: false },
    { token: u.token, channelId: video.channelId },
  );
}

async function withSeedLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_STALE_MS;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      break;
    } catch {
      const age = Date.now() - (fs.statSync(LOCK_DIR, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > LOCK_STALE_MS || Date.now() > deadline) {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}

/**
 * Ensures the fixed seed videos exist for a user (idempotent, by title) and
 * returns them keyed by title. Safe to call from many workers at once.
 */
export async function ensureSeedVideos(user: AuthUser): Promise<Record<string, E2EVideo>> {
  const specs = SEED[user] || [];
  if (specs.length === 0) return {};
  return withSeedLock(async () => {
    const u = userApi(user);
    const existing = await listOwnVideos(u);
    const result: Record<string, E2EVideo> = {};
    for (const spec of specs) {
      const channelId = u.channelIds[spec.channelIndex];
      // Matched by title + channel only: api-videos currently maps Bunny's
      // "finished" code to uploadStatus "failed", so status is not a usable signal.
      let video = existing.find((v) => v.title === spec.title && v.channelId === channelId);
      if (!video) {
        video = await uploadVideo(u, { title: spec.title, titleAr: spec.titleAr, isPublic: spec.isPublic, channelIndex: spec.channelIndex });
      } else if (video.titleLocalized?.ar !== spec.titleAr || video.titleLocalized?.en !== spec.title) {
        const description = (video as E2EVideo & { description?: string }).description || '';
        await setLocalizedMetadata(u, video, { en: spec.title, ar: spec.titleAr }, { en: description, ar: '' });
      }
      if (video.isPublic !== spec.isPublic && !spec.scheduleInDays) {
        await u.api.put(`/api/videos/${video.id}`, { isPublic: spec.isPublic }, { token: u.token, channelId: video.channelId });
      }
      if (spec.scheduleInDays) {
        const fresh = (await getVideo(u, video.id)) || video;
        await ensureSchedule(u, fresh, spec.scheduleInDays);
      }
      result[spec.title] = (await getVideo(u, video.id)) || video;
    }
    // Retired (public) seeds and leftovers from aborted runs; never fails the seed
    for (const v of existing.filter((x) => RETIRED_SEED_TITLES.includes(x.title))) {
      await deleteVideoQuietly(user, v);
    }
    await purgeStaleDisposables(user).catch(() => undefined);
    return result;
  });
}

/**
 * A public video for one spec file: created in beforeAll, removed in afterAll
 * (seed videos are private). Returns getters so describes can share it.
 */
export function setupPublicDisposable(user: AuthUser, label: string) {
  let video: E2EVideo | null = null;
  return {
    create: async () => {
      video = await createDisposableVideo(user, label, { isPublic: true });
      return video;
    },
    remove: async () => {
      await deleteVideoQuietly(user, video);
      video = null;
    },
    get: () => {
      if (!video) throw new Error('Public disposable video was not created');
      return video;
    },
  };
}

/** Unique title for a video a single test owns */
export function disposableTitle(label: string): string {
  return `E2E Temp ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function createDisposableVideo(
  user: AuthUser,
  label: string,
  opts: { isPublic?: boolean; channelIndex?: number; titleAr?: string; sample?: SampleVideo } = {},
): Promise<E2EVideo> {
  const u = userApi(user);
  return uploadVideo(u, {
    title: disposableTitle(label),
    titleAr: opts.titleAr,
    isPublic: opts.isPublic ?? false,
    channelIndex: opts.channelIndex,
    sample: opts.sample,
  });
}

/** Best-effort cleanup; ignores videos that are already gone */
export async function deleteVideoQuietly(user: AuthUser, video: E2EVideo | null | undefined): Promise<void> {
  if (!video) return;
  try {
    const u = userApi(user);
    // bulk-delete rather than DELETE /api/videos/:id, which rejects every
    // request on API builds before the param-name fix in videoDelete.ts
    await u.api.post('/api/videos/bulk-delete', { videoIds: [video.id] }, {
      token: u.token,
      channelId: video.channelId,
      allowStatus: [400, 403, 404],
    });
  } catch {
    // cleanup must never fail a test
  }
}

/**
 * Removes leftover disposable videos (from aborted runs) older than an hour.
 * Seed videos are never touched.
 */
export async function purgeStaleDisposables(user: AuthUser): Promise<void> {
  const u = userApi(user);
  const videos = await listOwnVideos(u);
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const v of videos) {
    const created = new Date((v as E2EVideo & { dateCreated?: string }).dateCreated || 0).getTime();
    if (v.title.startsWith('E2E Temp ') && created < cutoff) {
      await deleteVideoQuietly(user, v);
    }
  }
}

/**
 * Bunny CDN folder of a video, derived from its playUrl by dropping the file
 * name. Works for plain (https://vz-xxx.b-cdn.net/<id>/playlist.m3u8) and
 * token-signed path URLs (https://vz-xxx.b-cdn.net/bcdn_token=…&token_path=…/<id>/playlist.m3u8),
 * whose directory token then also covers the generated thumbnails.
 */
export function cdnBase(video: E2EVideo): string | null {
  if (!video.playUrl || !/^https:\/\/[^/]+\/.+\/[^/]+$/.test(video.playUrl)) return null;
  return video.playUrl.replace(/\/[^/]+$/, '');
}

/**
 * Polls the Bunny CDN until the video's generated thumbnails exist (encoding
 * finished), or the timeout passes. Returns whether they became available.
 */
export async function waitForThumbnails(user: AuthUser, videoId: string, timeoutMs = 120000): Promise<boolean> {
  const u = userApi(user);
  const webUrl = process.env.WEB_APP_URL || 'https://videos.qa.alummahnow.net';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const video = await getVideo(u, videoId);
    const base = video ? cdnBase(video) : null;
    if (base) {
      const res = await fetch(`${base}/thumbnail_1.jpg`, { method: 'HEAD', headers: { Referer: `${webUrl}/` } });
      if (res.ok) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return false;
}
