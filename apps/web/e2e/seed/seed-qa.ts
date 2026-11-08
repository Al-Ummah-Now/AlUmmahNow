#!/usr/bin/env npx tsx
/**
 * Idempotent QA seed for Al Ummah Now.
 *
 * Ensures four QA accounts exist (admin, moderator, creator, viewer), grants
 * the admin/moderator RBAC roles in the OpenAuth D1 database, and seeds
 * profiles, channels, uploaded videos (real TUS uploads of ffmpeg-generated
 * media), chapters, subtitles, a scheduled video, playlists, community posts
 * and viewer interactions through the public api-videos API.
 *
 * Every item is looked up by its natural key first and skipped if present, so
 * the script is safe to re-run.
 *
 * Usage (from apps/web):
 *   QA_SEED_PASSWORD=… [RESEND_API_KEY=…] npx tsx e2e/seed/seed-qa.ts
 *
 * Environment:
 *   QA_SEED_PASSWORD       password for all four seed accounts (required for apply)
 *   RESEND_API_KEY         only needed when an account must be registered
 *   SEED_MODE              "apply" (default) or "check" (read-only: logins, D1 lookups, API reads)
 *   SEED_SKIP_ROLES        "true" to skip the D1 role assignment
 *   SEED_STRICT            "true" to fail the run on soft failures too
 *   SEED_MEDIA_DIR         where generated mp4s are cached (default: $TMPDIR/seed-qa-media)
 *   SEED_PROCESSING_TIMEOUT_SECONDS  max wait for Bunny encoding (default 900)
 *   OPENAUTH_URL / WEB_APP_URL / API_URL / OPENAUTH_CLIENT_ID  target environment (defaults: QA)
 *   D1_DATABASE_NAME / D1_DATABASE_ID  OpenAuth D1 database (defaults: QA)
 *   WRANGLER_BIN           wrangler executable (default: npx --yes wrangler)
 */

import { chromium, type Browser } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ResendTestClient } from '../test-utils/resend-client';
import { ApiClient, ApiError } from './seed-api';
import { loginWithPassword, registerAccount, decodeJwtPayload, type AuthConfig, type SessionTokens } from './seed-auth';
import {
  SEED_ACCOUNTS,
  SEED_CHANNELS,
  VIEWER_CHANNEL,
  COMMUNITY_TEXT_POST,
  COMMUNITY_POLL,
  VIEWER_COMMENTS,
  VIEWER_LIKED_VIDEO_SLUG,
  VIEWER_WATCHED_VIDEO_SLUG,
  SAMPLE_WEBVTT_EN,
  SAMPLE_WEBVTT_AR,
  SAMPLE_CHAPTERS,
  type SeedAccount,
  type SeedRole,
  type SeedVideo,
} from './seed-config';
import { D1Client } from './seed-d1';
import { generateVideo } from './seed-media';
import { seedLogger as log, maskSecret } from './seed-logger';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODE = (process.env.SEED_MODE || 'apply').toLowerCase() === 'check' ? 'check' : 'apply';
const STRICT = process.env.SEED_STRICT === 'true';
const SKIP_ROLES = process.env.SEED_SKIP_ROLES === 'true';
const PASSWORD = process.env.QA_SEED_PASSWORD || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MEDIA_DIR = process.env.SEED_MEDIA_DIR || path.join(os.tmpdir(), 'seed-qa-media');
const PROCESSING_TIMEOUT_MS = Number(process.env.SEED_PROCESSING_TIMEOUT_SECONDS || 900) * 1000;
const STALE_UPLOAD_MS = 30 * 60 * 1000;

const authConfig: AuthConfig = {
  issuerUrl: (process.env.OPENAUTH_URL || 'https://auth.qa.alummahnow.net').replace(/\/$/, ''),
  webUrl: (process.env.WEB_APP_URL || 'https://videos.qa.alummahnow.net').replace(/\/$/, ''),
  clientId: process.env.OPENAUTH_CLIENT_ID || 'e0de3c30-0304-4ac4-86d6-1e185dec0439',
};
const API_URL = (process.env.API_URL || 'https://videos.api.qa.alummahnow.net').replace(/\/$/, '');
const D1_NAME = process.env.D1_DATABASE_NAME || 'al-ummah-now-d1-qa';
const D1_ID = process.env.D1_DATABASE_ID || '28590f3c-dd92-4c26-a803-d73a9bbe2b58';

const api = new ApiClient(API_URL);

// ---------------------------------------------------------------------------
// Summary bookkeeping
// ---------------------------------------------------------------------------

type Status = 'created' | 'exists' | 'updated' | 'skipped' | 'missing' | 'failed-soft' | 'failed';

interface SummaryRow {
  area: string;
  item: string;
  status: Status;
  detail?: string;
}

const summary: SummaryRow[] = [];

function record(area: string, item: string, status: Status, detail?: string): void {
  summary.push({ area, item, status, detail });
  const line = `${area} | ${item} | ${status}${detail ? ` | ${detail}` : ''}`;
  if (status === 'failed' || status === 'failed-soft') log.warn(line);
  else log.info(line);
}

/**
 * Runs a step whose failure should not abort the seed (features with known
 * API limitations). The failure is recorded and, with SEED_STRICT=true, fails
 * the run at the end.
 */
async function soft(area: string, item: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    record(area, item, 'failed-soft', error instanceof Error ? error.message : String(error));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// API shapes (only the fields the seed reads)
// ---------------------------------------------------------------------------

interface ChannelRecord {
  id: string;
  name: string;
  userId: string;
  isDeleted?: boolean;
  subscriptions?: Array<{ channelId?: string; entityId?: string }>;
}

interface VideoRecord {
  id: string;
  title: string;
  userId: string;
  channelId: string;
  isPublic?: boolean;
  uploadStatus?: string;
  dateCreated?: string;
  description?: string;
  titleLocalized?: Record<string, string>;
  descriptionLocalized?: Record<string, string>;
  category?: string;
  tags?: string[];
  language?: string;
  duration?: number;
  scheduledPublishStatus?: string;
  scheduledPublishDate?: string;
  likes?: Array<{ channelId?: string; userId?: string }>;
  comments?: Array<{ text?: string; channelId?: string }>;
}

interface PlaylistRecord {
  id: string;
  title: string;
  userId?: string;
  channelId?: string;
  videos?: string[];
  isDeleted?: boolean;
}

interface CommunityPostRecord {
  id: string;
  type: string;
  content?: string;
  poll?: { question?: string };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type Sessions = Map<SeedRole, SessionTokens>;

async function ensureAccounts(browser: Browser): Promise<Sessions> {
  log.group('Accounts');
  const sessions: Sessions = new Map();
  const resend = RESEND_API_KEY ? new ResendTestClient(RESEND_API_KEY) : null;

  for (const account of SEED_ACCOUNTS) {
    if (!PASSWORD) {
      record('account', account.email, 'skipped', 'QA_SEED_PASSWORD not set');
      continue;
    }
    const login = await loginWithPassword(browser, authConfig, account.email, PASSWORD);
    if (login.ok) {
      sessions.set(account.key, login.session);
      record('account', account.email, 'exists', `userId=${login.session.userId}`);
      continue;
    }
    if (login.reason !== 'invalid_credentials') {
      throw new Error(`Login for ${account.email} failed unexpectedly: ${login.message}`);
    }
    if (MODE === 'check') {
      record('account', account.email, 'missing', `login rejected: ${login.message}`);
      continue;
    }
    if (!resend) {
      throw new Error(`${account.email} cannot log in and RESEND_API_KEY is not set, so it cannot be registered`);
    }
    log.info('Login rejected; registering account', { email: account.email });
    const session = await registerAccount(browser, authConfig, account.email, PASSWORD, resend);
    sessions.set(account.key, session);
    record('account', account.email, 'created', `userId=${session.userId}`);
    await sleep(2000);
  }
  log.groupEnd();
  return sessions;
}

function roleClaimSummary(claims: Record<string, unknown>): string {
  const props = (claims.properties || {}) as Record<string, unknown>;
  const roles = props.roles ?? claims.roles ?? props.role ?? claims.role;
  return roles === undefined ? 'no roles claim' : `roles=${JSON.stringify(roles)}`;
}

async function ensureRoles(browser: Browser, sessions: Sessions): Promise<void> {
  log.group('RBAC roles (D1)');
  if (SKIP_ROLES) {
    record('role', 'all', 'skipped', 'SEED_SKIP_ROLES=true');
    log.groupEnd();
    return;
  }
  const d1 = new D1Client({ databaseName: D1_NAME, databaseId: D1_ID });
  const ids = d1.findUserIdsByEmail(SEED_ACCOUNTS.map((a) => a.email));

  for (const account of SEED_ACCOUNTS) {
    if (!account.rbacRoleId) continue;
    const userId = ids.get(account.email);
    if (!userId) {
      record('role', `${account.email} -> ${account.rbacRoleId}`, MODE === 'check' ? 'missing' : 'failed', 'user not found in D1 users table');
      if (MODE !== 'check') throw new Error(`User ${account.email} not found in D1`);
      continue;
    }
    const session = sessions.get(account.key);
    if (session && session.userId !== userId) {
      log.warn('D1 user id differs from the access token subject', { email: account.email, d1UserId: userId, tokenSub: session.userId });
    }
    if (MODE === 'check') {
      const roles = d1.listRoles(userId);
      record('role', `${account.email} -> ${account.rbacRoleId}`, roles.includes(account.rbacRoleId) ? 'exists' : 'missing', `current=${roles.join(',') || 'none'}`);
      continue;
    }
    const inserted = d1.assignRole(userId, account.rbacRoleId);
    record('role', `${account.email} -> ${account.rbacRoleId}`, inserted ? 'created' : 'exists');

    // Roles are embedded only in tokens issued after the grant: log in again.
    const relogin = await loginWithPassword(browser, authConfig, account.email, PASSWORD);
    if (!relogin.ok) throw new Error(`Re-login after role grant failed for ${account.email}: ${relogin.message}`);
    sessions.set(account.key, relogin.session);
    log.info('Re-issued token after role grant', { email: account.email, claim: roleClaimSummary(relogin.session.claims) });
  }
  log.groupEnd();
}

async function ensureProfiles(sessions: Sessions): Promise<void> {
  log.group('Profiles');
  for (const account of SEED_ACCOUNTS) {
    const session = sessions.get(account.key);
    if (!session) continue;
    const res = await api.get(`/api/profiles/${encodeURIComponent(session.userId)}`, { token: session.accessToken, allowStatus: [404] });
    if (res.status !== 404) {
      record('profile', account.email, 'exists');
      continue;
    }
    if (MODE === 'check') {
      record('profile', account.email, 'missing');
      continue;
    }
    await api.post('/api/profiles', profileInput(account), { token: session.accessToken });
    record('profile', account.email, 'created');
  }
  log.groupEnd();
}

function profileInput(account: SeedAccount) {
  return {
    email: account.email,
    userName: account.email.split('@')[0].replace(/-/g, '_'),
    displayName: account.displayName,
    displayNameLocalized: { en: account.displayName, ar: account.displayNameAr },
    bio: account.bio,
    bioLocalized: { en: account.bio, ar: account.displayNameAr },
    timezone: 'UTC',
  };
}

/**
 * Lists the caller's channels. GET /api/channels filters to the caller's own
 * channels when authenticated, but returns an empty cursor whenever a page has
 * no matches, so a single large page is requested instead of paginating.
 */
async function listOwnChannels(session: SessionTokens): Promise<ChannelRecord[]> {
  const res = await api.get<{ data?: ChannelRecord[] }>('/api/channels?limit=1000', { token: session.accessToken });
  return (res.data.data || []).filter((c) => c.userId === session.userId && !c.isDeleted);
}

async function ensureChannel(
  session: SessionTokens,
  existing: ChannelRecord[],
  def: { name: string; nameAr: string; description: string; descriptionAr: string; isMain: boolean },
): Promise<ChannelRecord | undefined> {
  const found = existing.find((c) => c.name === def.name);
  if (found) {
    record('channel', def.name, 'exists', `id=${found.id}`);
    return found;
  }
  if (MODE === 'check') {
    record('channel', def.name, 'missing');
    return undefined;
  }
  const res = await api.post<{ result?: { channel?: ChannelRecord } }>(
    '/api/channels',
    {
      name: def.name,
      nameLocalized: { en: def.name, ar: def.nameAr },
      description: def.description,
      descriptionLocalized: { en: def.description, ar: def.descriptionAr },
      isMain: def.isMain,
    },
    { token: session.accessToken },
  );
  const channel = res.data.result?.channel;
  if (!channel?.id) throw new Error(`Channel create for "${def.name}" returned no id`);
  record('channel', def.name, 'created', `id=${channel.id}`);
  return channel;
}

async function listChannelVideos(session: SessionTokens, channelId: string): Promise<VideoRecord[]> {
  const all = await api.listAll<VideoRecord>(`/api/videos?channelId=${encodeURIComponent(channelId)}`, {
    token: session.accessToken,
    channelId,
  });
  return all.filter((v) => v.channelId === channelId && v.userId === session.userId);
}

async function getUploadStatus(session: SessionTokens, video: { id: string; channelId: string }) {
  const res = await api.get<{ result?: { status?: string; progress?: number } }>(`/api/videos/${video.id}/upload-status`, {
    token: session.accessToken,
    channelId: video.channelId,
  });
  return res.data.result?.status || 'unknown';
}

async function uploadVideo(session: SessionTokens, channelId: string, def: SeedVideo): Promise<VideoRecord> {
  const filePath = generateVideo(def, MEDIA_DIR);
  const fileSize = fs.statSync(filePath).size;
  const initiate = await api.post<{ success?: boolean; result?: { videoId?: string; tusSessionId?: string } }>(
    '/api/videos/upload/initiate',
    {
      title: def.title,
      description: def.description,
      fileSize,
      mimeType: 'video/mp4',
      isPublic: !def.scheduled,
      tags: def.tags.join(','),
    },
    { token: session.accessToken, channelId },
  );
  const videoId = initiate.data.result?.videoId;
  const tusSessionId = initiate.data.result?.tusSessionId;
  if (!videoId || !tusSessionId) throw new Error(`Upload initiate for "${def.title}" returned no videoId/tusSessionId`);
  maskSecret(tusSessionId);
  log.info('Upload initiated', { title: def.title, videoId, fileSize });

  await api.tusUpload({ token: session.accessToken, tusSessionId, videoId, filePath, mimeType: 'video/mp4' });
  await api.post('/api/videos/upload/complete', { videoId, fileSize, duration: def.durationSeconds }, { token: session.accessToken, channelId });
  log.info('Upload completed', { title: def.title, videoId });
  return { id: videoId, title: def.title, userId: session.userId, channelId, isPublic: !def.scheduled };
}

function sameRecord(a: Record<string, string> | undefined, b: Record<string, string>): boolean {
  return !!a && Object.keys(b).every((k) => a[k] === b[k]);
}

async function ensureVideoMetadata(session: SessionTokens, video: VideoRecord, def: SeedVideo): Promise<void> {
  const desired = {
    description: def.description,
    titleLocalized: { en: def.title, ar: def.titleAr },
    descriptionLocalized: { en: def.description, ar: def.descriptionAr },
    category: def.category,
    tags: def.tags,
    language: def.language,
  };
  const upToDate =
    video.description === desired.description &&
    sameRecord(video.titleLocalized, desired.titleLocalized) &&
    sameRecord(video.descriptionLocalized, desired.descriptionLocalized) &&
    video.category === desired.category &&
    video.language === desired.language &&
    JSON.stringify(video.tags || []) === JSON.stringify(desired.tags);
  if (upToDate) return;
  if (MODE === 'check') {
    record('video-metadata', def.title, 'missing');
    return;
  }
  await api.put(`/api/videos/${video.id}`, desired, { token: session.accessToken, channelId: video.channelId });
  record('video-metadata', def.title, 'updated', 'titleLocalized/descriptionLocalized/category/tags/language');
}

interface SeededVideo {
  def: SeedVideo;
  video: VideoRecord;
  channelId: string;
  fresh: boolean;
}

async function ensureVideos(session: SessionTokens, channelId: string, defs: SeedVideo[]): Promise<SeededVideo[]> {
  const existing = await listChannelVideos(session, channelId);
  const seeded: SeededVideo[] = [];
  for (const def of defs) {
    let video = existing.find((v) => v.title === def.title);
    if (video) {
      const age = Date.now() - new Date(video.dateCreated || 0).getTime();
      const status = await getUploadStatus(session, video);
      const stale = status === 'failed' || status === 'deleted' || (status === 'uploading' && age > STALE_UPLOAD_MS);
      if (!stale) {
        record('video', def.title, 'exists', `id=${video.id} status=${status}`);
        seeded.push({ def, video, channelId, fresh: false });
        await ensureVideoMetadata(session, video, def);
        continue;
      }
      if (MODE === 'check') {
        record('video', def.title, 'missing', `stale upload id=${video.id} status=${status}`);
        continue;
      }
      log.warn('Replacing stale seed upload', { title: def.title, videoId: video.id, status });
      await api.request(`/api/videos/${video.id}`, { method: 'DELETE', token: session.accessToken, channelId });
    } else if (MODE === 'check') {
      record('video', def.title, 'missing');
      continue;
    }
    video = await uploadVideo(session, channelId, def);
    record('video', def.title, 'created', `id=${video.id}`);
    seeded.push({ def, video, channelId, fresh: true });
    await ensureVideoMetadata(session, video, def);
  }
  return seeded;
}

async function waitForProcessing(session: SessionTokens, videos: SeededVideo[]): Promise<void> {
  log.group('Encoding status');
  const pending = new Map(videos.map((v) => [v.video.id, v]));
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  while (pending.size > 0 && Date.now() < deadline) {
    for (const [id, v] of pending) {
      const status = await getUploadStatus(session, v.video);
      if (status === 'ready') {
        pending.delete(id);
        log.info('Video ready', { title: v.def.title, id });
      } else if (status === 'failed' || status === 'deleted') {
        throw new Error(`Video "${v.def.title}" (${id}) ended in status ${status}`);
      }
    }
    if (pending.size > 0) {
      log.info('Waiting for encoding', { pending: [...pending.values()].map((v) => v.def.title) });
      await sleep(15000);
    }
  }
  for (const v of pending.values()) {
    record('encoding', v.def.title, 'failed-soft', `not ready after ${PROCESSING_TIMEOUT_MS / 1000}s (Bunny may still be encoding)`);
  }
  log.groupEnd();
}

async function fetchVideo(session: SessionTokens, id: string): Promise<VideoRecord> {
  const res = await api.get<VideoRecord>(`/api/videos/${id}`, { token: session.accessToken });
  return res.data;
}

async function ensureChaptersAndSubtitles(session: SessionTokens, v: SeededVideo): Promise<void> {
  const res = await api.get<{ success?: boolean; chapters?: unknown[] }>(`/api/videos/${v.video.id}/chapters`, {
    token: session.accessToken,
    allowStatus: [400, 404],
  });
  if (Array.isArray(res.data.chapters) && res.data.chapters.length > 0) {
    record('chapters', v.def.title, 'exists', `${res.data.chapters.length} chapters`);
  } else if (MODE === 'check') {
    record('chapters', v.def.title, 'missing');
  } else {
    await api.put(`/api/videos/${v.video.id}/chapters`, { chapters: SAMPLE_CHAPTERS }, { token: session.accessToken, channelId: v.channelId });
    record('chapters', v.def.title, 'created', `${SAMPLE_CHAPTERS.length} chapters`);
  }

  const list = await api.get<{ data?: { tracks?: Array<{ language?: string }> } }>(`/api/videos/${v.video.id}/subtitles`, {
    token: session.accessToken,
    allowStatus: [404],
  });
  const have = new Set((list.data.data?.tracks || []).map((t) => t.language));
  const tracks = [
    { language: 'en', label: 'English', vtt: SAMPLE_WEBVTT_EN, isDefault: true },
    { language: 'ar', label: 'العربية', vtt: SAMPLE_WEBVTT_AR, isDefault: false },
  ];
  for (const track of tracks) {
    if (have.has(track.language)) {
      record('subtitles', `${v.def.title} [${track.language}]`, 'exists');
      continue;
    }
    if (MODE === 'check') {
      record('subtitles', `${v.def.title} [${track.language}]`, 'missing');
      continue;
    }
    await soft('subtitles', `${v.def.title} [${track.language}]`, async () => {
      const form = new FormData();
      form.append('file', track.vtt);
      form.append('language', track.language);
      form.append('label', track.label);
      form.append('isDefault', String(track.isDefault));
      await api.request(`/api/videos/${v.video.id}/subtitles`, {
        method: 'POST',
        token: session.accessToken,
        channelId: v.channelId,
        body: form,
      });
      record('subtitles', `${v.def.title} [${track.language}]`, 'created');
    });
  }
}

async function ensureSchedule(session: SessionTokens, v: SeededVideo): Promise<void> {
  const video = await fetchVideo(session, v.video.id);
  const status = video.scheduledPublishStatus;
  if (status === 'scheduled' || status === 'publishing' || status === 'published' || video.isPublic) {
    record('schedule', v.def.title, 'exists', `status=${status || (video.isPublic ? 'public' : 'none')}${video.scheduledPublishDate ? ` at ${video.scheduledPublishDate}` : ''}`);
    return;
  }
  if (MODE === 'check') {
    record('schedule', v.def.title, 'missing');
    return;
  }
  const when = new Date(Date.now() + 24 * 60 * 60 * 1000);
  when.setUTCSeconds(0, 0);
  await api.post(
    `/api/videos/${v.video.id}/schedule`,
    { scheduledPublishDate: when.toISOString(), timezone: 'UTC', notifyOnPublish: false },
    { token: session.accessToken, channelId: v.channelId },
  );
  record('schedule', v.def.title, 'created', `publishes at ${when.toISOString()}`);
}

async function ensurePlaylist(session: SessionTokens, channelId: string, title: string, description: string, videoIds: string[]): Promise<void> {
  const all = await api.listAll<PlaylistRecord>('/api/playlists', { token: session.accessToken });
  const found = all.find((p) => p.title === title && p.userId === session.userId && p.channelId === channelId && !p.isDeleted);
  if (!found) {
    if (MODE === 'check') {
      record('playlist', title, 'missing');
      return;
    }
    const res = await api.post<{ result?: { playlist?: PlaylistRecord } }>(
      '/api/playlists',
      { title, description, videos: videoIds, isPublic: true },
      { token: session.accessToken, channelId },
    );
    record('playlist', title, 'created', `id=${res.data.result?.playlist?.id} videos=${videoIds.length}`);
    return;
  }
  const missing = videoIds.filter((id) => !(found.videos || []).includes(id));
  if (missing.length === 0) {
    record('playlist', title, 'exists', `id=${found.id}`);
    return;
  }
  if (MODE === 'check') {
    record('playlist', title, 'missing', `${missing.length} videos not in playlist`);
    return;
  }
  for (const videoId of missing) {
    await api.post(`/api/playlists/${found.id}/videos`, { videoId }, { token: session.accessToken, channelId, allowStatus: [409] });
  }
  record('playlist', title, 'updated', `added ${missing.length} videos`);
}

async function ensureCommunityPosts(session: SessionTokens, channelId: string): Promise<void> {
  const res = await api.get<{ posts?: CommunityPostRecord[] }>(`/api/community/channels/${channelId}/posts?limit=50`, {
    token: session.accessToken,
  });
  const posts = res.data.posts || [];

  const textExists = posts.some((p) => p.type === 'text' && p.content === COMMUNITY_TEXT_POST);
  if (textExists) record('community', 'text post', 'exists');
  else if (MODE === 'check') record('community', 'text post', 'missing');
  else {
    await soft('community', 'text post', async () => {
      await api.post(
        `/api/community/channels/${channelId}/posts`,
        { type: 'text', content: COMMUNITY_TEXT_POST, visibility: 'public', commentsEnabled: true },
        { token: session.accessToken, channelId },
      );
      record('community', 'text post', 'created');
    });
  }

  const pollExists = posts.some((p) => p.type === 'poll' && p.poll?.question === COMMUNITY_POLL.question);
  if (pollExists) record('community', 'poll post', 'exists');
  else if (MODE === 'check') record('community', 'poll post', 'missing');
  else {
    await soft('community', 'poll post', async () => {
      await api.post(
        `/api/community/channels/${channelId}/posts`,
        {
          type: 'poll',
          content: COMMUNITY_POLL.question,
          poll: {
            question: COMMUNITY_POLL.question,
            options: COMMUNITY_POLL.options.map((text) => ({ text })),
            multipleChoice: false,
          },
          visibility: 'public',
          commentsEnabled: true,
        },
        { token: session.accessToken, channelId },
      );
      record('community', 'poll post', 'created');
    });
  }
}

async function viewerInteractions(viewer: SessionTokens, viewerChannelId: string, creatorChannels: ChannelRecord[], videos: SeededVideo[]): Promise<void> {
  log.group('Viewer interactions');
  const bySlug = new Map(videos.map((v) => [v.def.slug, v]));

  // Subscriptions
  for (const channel of creatorChannels) {
    if (MODE === 'check') continue;
    const res = await api.post<{ error?: string }>(`/api/channels/${channel.id}/subscriptions`, {}, { token: viewer.accessToken, channelId: viewerChannelId });
    record('subscribe', channel.name, res.data?.error === 'Already Subscribed' ? 'exists' : 'created');
  }
  await soft('subscribe', 'verify via /api/profile/subscriptions', async () => {
    const subs = await api.get<{ data?: ChannelRecord[] }>('/api/profile/subscriptions?page=1&pageSize=50', { token: viewer.accessToken });
    const subscribed = new Set((subs.data.data || []).map((c) => c.id));
    const missing = creatorChannels.filter((c) => !subscribed.has(c.id)).map((c) => c.name);
    if (missing.length > 0) throw new Error(`profile.subscribedTo is missing: ${missing.join(', ')}`);
    record('subscribe', 'verify via /api/profile/subscriptions', 'exists', `${creatorChannels.length} channels`);
  });

  // Like
  const liked = bySlug.get(VIEWER_LIKED_VIDEO_SLUG);
  if (liked) {
    const video = await fetchVideo(viewer, liked.video.id);
    const already = (video.likes || []).some((l) => l.channelId === viewerChannelId);
    if (already) record('like', liked.def.title, 'exists');
    else if (MODE === 'check') record('like', liked.def.title, 'missing');
    else {
      await api.post(`/api/videos/${liked.video.id}/likes`, {}, { token: viewer.accessToken, channelId: viewerChannelId });
      record('like', liked.def.title, 'created');
    }
  }

  // Comments
  for (const c of VIEWER_COMMENTS) {
    const target = bySlug.get(c.videoSlug);
    if (!target) continue;
    const video = await fetchVideo(viewer, target.video.id);
    const already = (video.comments || []).some((x) => x.text === c.text && x.channelId === viewerChannelId);
    if (already) record('comment', target.def.title, 'exists');
    else if (MODE === 'check') record('comment', target.def.title, 'missing');
    else {
      await api.post(`/api/videos/${target.video.id}/comments`, { text: c.text }, { token: viewer.accessToken, channelId: viewerChannelId });
      record('comment', target.def.title, 'created');
    }
  }

  // View + watch history / progress
  const watched = bySlug.get(VIEWER_WATCHED_VIDEO_SLUG);
  if (watched) {
    await soft('watch', watched.def.title, async () => {
      const history = await api.get<{ entries?: Array<{ videoId?: string }> }>('/api/watch-history?limit=100', { token: viewer.accessToken });
      const inHistory = (history.data.entries || []).some((e) => e.videoId === watched.video.id);
      if (inHistory) {
        record('watch', watched.def.title, 'exists');
        return;
      }
      if (MODE === 'check') {
        record('watch', watched.def.title, 'missing');
        return;
      }
      const duration = watched.def.durationSeconds;
      const progress = Math.round(duration * 0.6);
      await api.post(`/api/videos/${watched.video.id}/view`, { watchTime: progress, deviceType: 'desktop', referrer: 'qa-seed' }, { token: viewer.accessToken, channelId: viewerChannelId });
      await api.post('/api/watch-history', { videoId: watched.video.id, progress, duration }, { token: viewer.accessToken, channelId: viewerChannelId });
      await api.post(`/api/watch-history/${watched.video.id}/progress`, { progress, duration }, { token: viewer.accessToken, channelId: viewerChannelId });
      record('watch', watched.def.title, 'created', `view + history + progress ${progress}/${duration}s`);
    });
  }
  log.groupEnd();
}

async function readOnlyApiProbe(): Promise<void> {
  log.group('API probe (read-only)');
  const channels = await api.get<{ data?: unknown[] }>('/api/channels?limit=1000');
  const videos = await api.get<{ data?: unknown[] }>('/api/videos?limit=100');
  record('api', `GET ${API_URL}/api/channels`, 'exists', `${channels.data.data?.length ?? 0} public channels on first page`);
  record('api', `GET ${API_URL}/api/videos`, 'exists', `${videos.data.data?.length ?? 0} public videos on first page`);
  log.groupEnd();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printSummary(fatal?: unknown): void {
  log.group('Seed summary');
  const width = Math.max(...summary.map((r) => r.area.length), 4);
  for (const r of summary) {
    log.info(`${r.area.padEnd(width)}  ${r.status.padEnd(11)}  ${r.item}${r.detail ? `  (${r.detail})` : ''}`);
  }
  const counts = summary.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  log.info('Totals', counts);
  log.groupEnd();

  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    const esc = (s: string) => s.replace(/\|/g, '\\|');
    const lines = [
      `## QA seed (${MODE})`,
      '',
      fatal ? `**Failed:** ${esc(fatal instanceof Error ? fatal.message : String(fatal))}\n` : '',
      '| Area | Item | Status | Detail |',
      '| --- | --- | --- | --- |',
      ...summary.map((r) => `| ${esc(r.area)} | ${esc(r.item)} | ${r.status} | ${esc(r.detail || '')} |`),
      '',
    ];
    fs.appendFileSync(stepSummary, lines.join('\n'));
  }
}

async function main(): Promise<void> {
  maskSecret(PASSWORD);
  maskSecret(RESEND_API_KEY);
  log.info('QA seed starting', {
    mode: MODE,
    issuer: authConfig.issuerUrl,
    web: authConfig.webUrl,
    api: API_URL,
    d1: D1_NAME,
    skipRoles: SKIP_ROLES,
    strict: STRICT,
    passwordProvided: PASSWORD.length > 0,
    resendKeyProvided: RESEND_API_KEY.length > 0,
  });
  if (MODE === 'apply' && !PASSWORD) throw new Error('QA_SEED_PASSWORD is required in apply mode');

  await readOnlyApiProbe();

  const browser = await chromium.launch({ headless: true });
  let sessions: Sessions;
  try {
    sessions = await ensureAccounts(browser);
    await ensureRoles(browser, sessions);
  } finally {
    await browser.close();
  }

  await ensureProfiles(sessions);

  const creator = sessions.get('creator');
  const viewer = sessions.get('viewer');
  if (!creator) {
    record('content', 'all', MODE === 'check' ? 'skipped' : 'failed', 'creator session unavailable');
    if (MODE !== 'check') throw new Error('Creator session unavailable');
    return;
  }
  log.info('Creator token', { userId: creator.userId, exp: decodeJwtPayload(creator.accessToken).exp });

  log.group('Channels');
  const creatorExisting = await listOwnChannels(creator);
  const creatorChannels: ChannelRecord[] = [];
  const channelByKey = new Map<string, ChannelRecord>();
  for (const def of SEED_CHANNELS) {
    const ch = await ensureChannel(creator, creatorExisting, def);
    if (ch) {
      creatorChannels.push(ch);
      channelByKey.set(def.key, ch);
    }
  }
  let viewerChannel: ChannelRecord | undefined;
  if (viewer) {
    viewerChannel = await ensureChannel(viewer, await listOwnChannels(viewer), { ...VIEWER_CHANNEL, isMain: true });
  }
  log.groupEnd();

  log.group('Videos');
  const allVideos: SeededVideo[] = [];
  for (const def of SEED_CHANNELS) {
    const ch = channelByKey.get(def.key);
    if (!ch) continue;
    allVideos.push(...(await ensureVideos(creator, ch.id, def.videos)));
  }
  log.groupEnd();

  if (MODE === 'apply') {
    await waitForProcessing(creator, allVideos.filter((v) => v.fresh));
  }

  log.group('Chapters, subtitles, schedule');
  for (const v of allVideos) {
    if (v.def.withSubtitlesAndChapters) await ensureChaptersAndSubtitles(creator, v);
    if (v.def.scheduled) await ensureSchedule(creator, v);
  }
  log.groupEnd();

  log.group('Playlists');
  for (const def of SEED_CHANNELS) {
    const ch = channelByKey.get(def.key);
    if (!ch) continue;
    const ids = allVideos.filter((v) => v.channelId === ch.id && !v.def.scheduled).map((v) => v.video.id);
    await ensurePlaylist(creator, ch.id, def.playlistTitle, def.playlistDescription, ids);
  }
  log.groupEnd();

  log.group('Community posts');
  const lectures = channelByKey.get('lectures');
  if (lectures) {
    await soft('community', 'list posts', () => ensureCommunityPosts(creator, lectures.id));
  }
  log.groupEnd();

  if (viewer && viewerChannel) {
    await viewerInteractions(viewer, viewerChannel.id, creatorChannels, allVideos.filter((v) => !v.def.scheduled));
  } else {
    record('viewer', 'interactions', MODE === 'check' ? 'skipped' : 'failed', 'viewer session or channel unavailable');
    if (MODE !== 'check') throw new Error('Viewer session or channel unavailable');
  }
}

main()
  .then(() => {
    printSummary();
    const softFailures = summary.filter((r) => r.status === 'failed-soft').length;
    if (STRICT && softFailures > 0) {
      log.error(`Seed finished with ${softFailures} soft failure(s) and SEED_STRICT=true`);
      process.exit(1);
    }
    log.info(`QA seed finished (${MODE})${softFailures ? ` with ${softFailures} soft failure(s)` : ''}`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    const message = error instanceof ApiError ? `${error.message}` : error instanceof Error ? error.stack || error.message : String(error);
    log.error(`QA seed failed: ${message}`);
    printSummary(error);
    process.exit(1);
  });
