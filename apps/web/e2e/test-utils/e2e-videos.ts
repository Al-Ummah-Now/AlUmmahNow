import * as fs from 'fs';
import { test } from '@playwright/test';
import * as path from 'path';
import { ApiClient } from '../seed/seed-api';
import { AUTH_STATE, type AuthUser } from './auth-state';
import { runId } from './run-users';

/**
 * Real videos of the run's E2E users.
 *
 * The web app fetches videos through server actions, so browser route mocks
 * never reach api-videos. Specs instead upload the videos they need:
 *
 * - Studio videos (own-studio-videos.ts): a fixed set per spec file, made in its
 *   beforeAll and deleted in its afterAll.
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

/**
 * Base titles of the run user's Studio videos (own-studio-videos.ts makes them per spec file, with
 * the run tag). Specs that need a public video create a disposable one and delete it afterwards.
 */
export const SEED_TITLES = {
  singleVideo: 'E2E Seed Video',
  singlePrivate: 'E2E Seed Private Video',
  singleScheduled: 'E2E Seed Scheduled Video',
  multiOne: 'E2E Seed Multi Channel One Video',
  multiTwo: 'E2E Seed Multi Channel Two Video',
} as const;

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
/**
 * Uploads a video the way the web uploader does: initiate, TUS bytes, complete.
 *
 * `bytes: false` (record only): initiate and complete without sending the
 * file. The record is "processing" exactly as right after a real upload (the
 * state these specs saw before Bunny finished anyway), but Bunny never gets
 * bytes, so it never encodes anything. QA and stage share one Bunny library
 * whose encoding queue the suites filled on 2026-11-10 (thousands of test
 * encodes a day): only a spec that needs Bunny's output (frames, playback, a
 * watch page) sends the bytes.
 */
export async function uploadVideo(
  u: UserApi,
  opts: { title: string; titleAr?: string; isPublic: boolean; channelIndex?: number; description?: string; sample?: SampleVideo; bytes?: boolean },
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
  if (opts.bytes !== false) await u.api.tusUpload({ token: u.token, tusSessionId, videoId, filePath: sample.file, mimeType: 'video/mp4' });
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

/**
 * A public video for one spec file: created in beforeAll, removed in afterAll
 * (seed videos are private). Returns getters so describes can share it.
 */
export function setupPublicDisposable(user: AuthUser, label: string, opts: { ready?: boolean } = {}) {
  let video: E2EVideo | null = null;
  return {
    create: async () => {
      // Public pages (watch, comments, channel sections) need a real, encoding video
      video = await createDisposableVideo(user, label, { isPublic: true, encode: true });
      // Listings (channel sections, Studio's Published list, search) show a video only once it is ready
      if (opts.ready) video = await waitForReady(user, video);
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

/**
 * The longest any legacy spec waits for Bunny's encode. A 4 s clip normally
 * encodes in about a minute; when QA's shared Bunny library is backed up it
 * takes 15-50+ min (#929), and longer waits only ate the suite's globalTimeout.
 */
export const BUNNY_WAIT_MS = 120_000;
export const BUNNY_BACKLOG = 'QA\'s shared Bunny library is backed up (#929)';

/**
 * Owner rule (2026-11-12): a slow third-party encode is not a functional failure of our code.
 * When Bunny is still encoding at the end of a wait, the test is skipped with this reason;
 * wrong behaviour once an encode finished (or an encode that failed) still fails.
 */
export function skipSlowEncode(what: string): never {
  test.info().annotations.push({ type: 'encode-timeout', description: `${what} (#929)` });
  test.skip(true, `${what}: Bunny did not finish encoding in time, a slow third-party encode, not a product failure (https://github.com/Al-Ummah-Now/AlUmmahNow/issues/929)`);
  throw new Error('unreachable');
}

/**
 * Waits until Bunny has encoded the video (uploadStatus "ready"). Listings
 * leave out videos that are still processing (public ones since the
 * 2026-11-10 incident; Studio files them under Processing, not Published), so
 * a spec that looks for a just-uploaded video there waits for this first.
 * Throws when it is not ready in time: the spec would fail anyway, less clearly.
 */
export async function waitForReady(user: AuthUser, video: E2EVideo, timeoutMs = BUNNY_WAIT_MS): Promise<E2EVideo> {
  const u = userApi(user);
  const deadline = Date.now() + timeoutMs;
  let last: E2EVideo | null = null;
  for (;;) {
    last = await getVideo(u, video.id);
    if (last && (!last.uploadStatus || last.uploadStatus === 'ready')) return { ...video, ...last };
    if (last?.uploadStatus === 'failed' || Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (last && last.uploadStatus !== 'failed') skipSlowEncode(`"${video.title}" (${video.id}) still ${last.uploadStatus} after ${Math.round(timeoutMs / 1000)} s`);
  throw new Error(`"${video.title}" (${video.id}) is ${last?.uploadStatus ?? 'missing'}, not ready after ${Math.round(timeoutMs / 1000)} s of Bunny encoding: ${BUNNY_BACKLOG}?`);
}

/** Unique title for a video a single test owns */
export function disposableTitle(label: string): string {
  // The run id (CI) tags it for the job's leftover check
  return `E2E Temp ${label} ${runId() ?? 'local'} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * A video one spec owns and deletes again. Record only by default (no bytes,
 * so Bunny encodes nothing; see uploadVideo): enough for edit, delete, bulk,
 * schedule and dashboard flows. `encode: true` sends the file, for a spec that
 * needs Bunny's output (auto thumbnails, chapters on a real duration,
 * playback).
 */
export async function createDisposableVideo(
  user: AuthUser,
  label: string,
  opts: { isPublic?: boolean; channelIndex?: number; titleAr?: string; sample?: SampleVideo; encode?: boolean } = {},
): Promise<E2EVideo> {
  const u = userApi(user);
  return uploadVideo(u, {
    title: disposableTitle(label),
    titleAr: opts.titleAr,
    isPublic: opts.isPublic ?? false,
    channelIndex: opts.channelIndex,
    sample: opts.sample,
    bytes: opts.encode === true,
  });
}

/** Best-effort cleanup; ignores videos that are already gone */
export async function deleteVideoQuietly(user: AuthUser, video: E2EVideo | null | undefined): Promise<void> {
  if (!video) return;
  try {
    const u = userApi(user);
    // bulk-delete rather than DELETE /api/videos/:id, which rejects every
    // request on API builds before the param-name fix in videoDelete.ts
    const res = await u.api.post<{ results?: Array<{ success: boolean; error?: string }> }>('/api/videos/bulk-delete', { videoIds: [video.id] }, {
      token: u.token,
      channelId: video.channelId,
      allowStatus: [400, 401, 403, 404],
    });
    const result = res.data?.results?.[0];
    if (res.status >= 300 || (result && !result.success && result.error !== 'Video not found')) {
      console.warn(`[cleanup] could not delete video ${video.id} ("${video.title}"): ${res.status} ${result?.error ?? ''}`.trim());
    }
    // A soft delete keeps the Bunny video (restorable for 30 days) and its encode
    // in the shared test library's queue (#929): purge it now, which deletes the
    // R2 record and the Bunny video (admin job video.purge).
    const purge = await u.api.request(`/api/videos/${video.id}/permanent`, {
      method: 'DELETE',
      token: u.token,
      channelId: video.channelId,
      allowStatus: [400, 401, 403, 404, 409],
    });
    if (purge.status >= 300 && purge.status !== 404) {
      console.warn(`[cleanup] could not purge video ${video.id} ("${video.title}"): ${purge.status}; the hourly test-library purge removes its Bunny video`);
    }
  } catch (error) {
    // cleanup must never fail a test, but a leftover should be visible in the log
    console.warn(`[cleanup] could not delete video ${video.id} ("${video.title}")`, error);
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
export async function waitForThumbnails(user: AuthUser, videoId: string, timeoutMs = BUNNY_WAIT_MS): Promise<boolean> {
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
  // Still encoding when time ran out: a slow third-party encode, not ours (#929)
  const video = await getVideo(u, videoId);
  if (video && video.uploadStatus && video.uploadStatus !== 'ready' && video.uploadStatus !== 'failed') {
    skipSlowEncode(`thumbnails of ${videoId} (video ${video.uploadStatus}) after ${Math.round(timeoutMs / 1000)} s`);
  }
  return false;
}
