#!/usr/bin/env npx tsx
/**
 * Prototype only: seeds the theme demo content into QA.
 *
 * Reads demo-content/manifest.json (openly licensed clips with attribution),
 * creates one dedicated account and channel per demo channel, uploads every
 * clip through the normal TUS path, sets bilingual metadata, thumbnails,
 * avatars, covers and playlists, then writes demo-content/demo-set.json (the
 * ids the demo list filter allows) and checks that every clip really plays.
 *
 * Items are matched by natural key (email, channel name, video title, playlist
 * title), so re-runs skip what exists.
 *
 * Usage (from apps/web):
 *   QA_SEED_PASSWORD=… RESEND_API_KEY=… npx tsx e2e/seed/seed-demo.ts
 *
 * Environment:
 *   QA_SEED_PASSWORD     password of the demo accounts (required)
 *   RESEND_API_KEY       needed only while a demo account must be registered
 *   SEED_MODE            "apply" (default) or "check" (read-only)
 *   SEED_MEDIA_DIR       cache for downloads and transcodes
 *   SEED_DEMO_SET_OUT    where to write the demo set (default demo-content/demo-set.json)
 *   SEED_PROCESSING_TIMEOUT_SECONDS  max wait for encoding (default 2400)
 */

import { chromium } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ResendTestClient } from '../test-utils/resend-client';
import { ApiClient } from './seed-api';
import { decodeJwtPayload, loginWithPassword, registerAccount, type AuthConfig, type SessionTokens } from './seed-auth';
import { seedLogger as log, maskSecret } from './seed-logger';
import { ensureProfile, listOwnChannels } from './seed-users';

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

interface LocalizedCopy {
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
}

interface ClipSource {
  file: string;
  url: string;
  page: string;
  author: string;
  licence: string;
  licenceUrl?: string;
  attribution: string;
}

interface Clip extends LocalizedCopy {
  slug: string;
  channel: string;
  category: string;
  tags: string[];
  language: 'en' | 'ar';
  orientation: 'landscape' | 'portrait';
  /** Keep the source audio (adhan, recitation, ambience); otherwise the clip is uploaded silent */
  audio: boolean;
  trim?: { start: number; duration: number };
  source: ClipSource;
}

interface SectionDef {
  type: string;
  title: string;
  titleAr: string;
  /** featured_videos: clip slugs (the shorts shelf is a featured section of vertical clips) */
  clips?: string[];
  /** single_playlist / multiple_playlists: playlist keys */
  playlists?: string[];
}

interface ChannelDef {
  key: string;
  sections: SectionDef[];
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  /** Clip whose frame becomes the avatar and banner */
  artClip: string;
  artAttribution: string;
}

interface PlaylistDef {
  key: string;
  channel: string;
  title: string;
  description: string;
  clips: string[];
}

interface Manifest {
  channels: ChannelDef[];
  clips: Clip[];
  playlists: PlaylistDef[];
  /** Deliberately unplayable video, for reviewing the player error state */
  unplayable: LocalizedCopy & { slug: string; channel: string; category: string; tags: string[]; language: 'en' | 'ar'; thumbnailClip: string };
  /** Existing QA videos kept in the demo as they are */
  keep: string[];
  engagement: {
    subscriptions: Array<{ by: string; to: string[] }>;
    comments: Array<{ clip: string; by: string; text: string }>;
    likes: Array<{ clip: string; by: string[] }>;
  };
}

const manifestPath = path.join(__dirname, '../../demo-content/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODE = (process.env.SEED_MODE || 'apply').toLowerCase() === 'check' ? 'check' : 'apply';
const PASSWORD = process.env.QA_SEED_PASSWORD || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_DOMAIN = process.env.SEED_EMAIL_DOMAIN || 'delivered.resend.dev';
const MEDIA_DIR = process.env.SEED_MEDIA_DIR || path.join(os.tmpdir(), 'seed-demo-media');
const DEMO_SET_OUT = process.env.SEED_DEMO_SET_OUT || path.join(__dirname, '../../demo-content/demo-set.json');
const PROCESSING_TIMEOUT_MS = Number(process.env.SEED_PROCESSING_TIMEOUT_SECONDS || 2400) * 1000;
// The seed uploads one clip at a time, so an unfinished older upload is abandoned
const STALE_UPLOAD_MS = 10 * 60 * 1000;
/** Access tokens last about 15 minutes; refresh well before that. */
const TOKEN_MARGIN_S = 6 * 60;
const MAX_CLIP_SECONDS = 120;
const USER_AGENT = 'AlUmmahNowDemoSeed/1.0 (openly licensed clips for a private QA demo)';

const authConfig: AuthConfig = {
  issuerUrl: (process.env.OPENAUTH_URL || 'https://auth.qa.alummahnow.net').replace(/\/$/, ''),
  webUrl: (process.env.WEB_APP_URL || 'https://videos.qa.alummahnow.net').replace(/\/$/, ''),
  clientId: process.env.OPENAUTH_CLIENT_ID || 'e0de3c30-0304-4ac4-86d6-1e185dec0439',
};
const API_URL = (process.env.API_URL || 'https://videos.api.qa.alummahnow.net').replace(/\/$/, '');
if (!/\.qa\.alummahnow\.net$/.test(new URL(API_URL).hostname)) {
  throw new Error('The demo seed only runs against QA');
}

const api = new ApiClient(API_URL);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

const failures: string[] = [];
const notes: string[] = [];

function note(line: string): void {
  notes.push(line);
  log.info(line);
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

let lastDownloadAt = 0;

/** Wikimedia rate-limits hard: one request at a time, spaced, honouring Retry-After. */
async function politeFetch(url: string): Promise<Response | null> {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const wait = lastDownloadAt + 6000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastDownloadAt = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } }).catch(() => null);
    if (res?.ok) return res;
    if (res?.status === 404) return null;
    const retryAfter = Number(res?.headers.get('Retry-After')) || 0;
    // Honour Retry-After in full: retrying early only extends the block
    const delay = Math.max(retryAfter * 1000 + 5000, attempt * 10000);
    log.warn('Download retry', { status: res?.status ?? 'network', delaySeconds: delay / 1000 });
    await sleep(delay);
  }
  return null;
}

/** Commons serves 720p/480p derivatives; the original is the fallback. */
async function downloadSource(clip: Clip): Promise<string> {
  const out = path.join(MEDIA_DIR, `${clip.slug}.source`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  const original = clip.source.url.split('?')[0];
  const name = original.slice(original.lastIndexOf('/') + 1);
  const derivative = `${original.replace('/commons/', '/commons/transcoded/')}/${name}`;
  for (const url of [`${derivative}.720p.vp9.webm`, `${derivative}.720p.webm`, `${derivative}.480p.vp9.webm`, original]) {
    const res = await politeFetch(url);
    if (!res) continue;
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    log.info('Downloaded source', { slug: clip.slug, bytes: fs.statSync(out).size });
    return out;
  }
  throw new Error(`Could not download ${clip.source.file}`);
}

function probeDuration(file: string): number {
  const out = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Math.round(Number(out.trim()) || 0);
}

/** H.264 at up to 720p, trimmed to the manifest window, silent unless the clip keeps its audio. */
function transcode(clip: Clip, source: string): string {
  const out = path.join(MEDIA_DIR, `${clip.slug}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  const scale = clip.orientation === 'portrait' ? "scale=-2:'min(1280,ih)'" : "scale='min(1280,iw)':-2";
  execFileSync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...(clip.trim ? ['-ss', String(clip.trim.start)] : []),
      '-i', source,
      '-t', String(Math.min(clip.trim?.duration ?? MAX_CLIP_SECONDS, MAX_CLIP_SECONDS)),
      '-vf', scale,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
      ...(clip.audio ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']),
      '-movflags', '+faststart',
      out,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  log.info('Transcoded', { slug: clip.slug, bytes: fs.statSync(out).size });
  return out;
}

function frameStats(file: string, at: number): { brightness: number; range: number } {
  const out = execFileSync(
    ffmpeg,
    ['-hide_banner', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const read = (key: string) => Number(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`).exec(out)?.[1] ?? 0);
  return { brightness: read('YAVG'), range: read('YHIGH') - read('YLOW') };
}

/** The best-exposed, highest-contrast of several evenly spaced frames: never a black one. */
function bestFrameTime(file: string): number {
  const duration = Math.max(probeDuration(file), 1);
  const candidates = [0.12, 0.25, 0.4, 0.55, 0.7, 0.85].map((f) => Math.round(duration * f * 10) / 10);
  const scored = candidates.map((at) => ({ at, ...frameStats(file, at) }));
  const usable = scored.filter((f) => f.brightness >= 55 && f.brightness <= 200);
  const pool = usable.length > 0 ? usable : scored;
  return pool.sort((a, b) => b.range - a.range)[0].at;
}

function extractImage(file: string, out: string, filter: string, at = bestFrameTime(file)): string {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', filter, '-q:v', '3', out], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return out;
}

function thumbnailFor(clip: Clip, video: string): string {
  const width = clip.orientation === 'portrait' ? 720 : 1280;
  return extractImage(video, path.join(MEDIA_DIR, `${clip.slug}.thumb.jpg`), `scale=${width}:-2`);
}

async function mediaFor(clip: Clip): Promise<{ video: string; thumbnail: string }> {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const video = transcode(clip, await downloadSource(clip));
  return { video, thumbnail: thumbnailFor(clip, video) };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface ChannelRecord {
  id: string;
  name: string;
  avatarUrl?: string;
  coverUrl?: string;
}

interface VideoRecord {
  id: string;
  title: string;
  channelId: string;
  userId?: string;
  dateCreated?: string;
  uploadStatus?: string;
  thumbnailType?: string;
  thumbnailUrl?: string;
  playUrl?: string;
  description?: string;
  titleLocalized?: Record<string, string>;
  descriptionLocalized?: Record<string, string>;
  category?: string;
}

function imageForm(field: string, file: string): FormData {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(fs.readFileSync(file))], { type: 'image/jpeg' }), path.basename(file));
  return form;
}

async function uploadStatus(session: SessionTokens, video: { id: string; channelId: string }): Promise<string> {
  const res = await api.get<{ result?: { status?: string } }>(`/api/videos/${video.id}/upload-status`, {
    token: session.accessToken,
    channelId: video.channelId,
  });
  return res.data.result?.status || 'unknown';
}

async function listVideos(session: SessionTokens, channelId: string): Promise<VideoRecord[]> {
  const all = await api.listAll<VideoRecord>(`/api/videos?channelId=${encodeURIComponent(channelId)}`, { token: session.accessToken, channelId });
  return all.filter((v) => v.channelId === channelId);
}

async function uploadFile(session: SessionTokens, channelId: string, copy: LocalizedCopy, tags: string[], file: string, duration?: number): Promise<VideoRecord> {
  const fileSize = fs.statSync(file).size;
  const initiate = await api.post<{ result?: { videoId?: string; tusSessionId?: string } }>(
    '/api/videos/upload/initiate',
    { title: copy.title, description: copy.description, fileSize, mimeType: 'video/mp4', isPublic: true, tags: tags.join(',') },
    { token: session.accessToken, channelId },
  );
  const videoId = initiate.data.result?.videoId;
  const tusSessionId = initiate.data.result?.tusSessionId;
  if (!videoId || !tusSessionId) throw new Error(`Upload initiate for "${copy.title}" returned no ids`);
  maskSecret(tusSessionId);
  await api.tusUpload({ token: session.accessToken, tusSessionId, videoId, filePath: file, mimeType: 'video/mp4' });
  await api.post('/api/videos/upload/complete', { videoId, fileSize, ...(duration ? { duration } : {}) }, { token: session.accessToken, channelId });
  return { id: videoId, title: copy.title, channelId };
}

async function setMetadata(
  session: SessionTokens,
  video: VideoRecord,
  copy: LocalizedCopy,
  extra: { category: string; tags: string[]; language: string },
): Promise<void> {
  const current = video.titleLocalized?.ar === copy.titleAr && video.descriptionLocalized?.ar === copy.descriptionAr && video.description === copy.description && video.category === extra.category;
  if (current || MODE === 'check') return;
  await api.put(
    `/api/videos/${video.id}`,
    {
      description: copy.description,
      titleLocalized: { en: copy.title, ar: copy.titleAr },
      descriptionLocalized: { en: copy.description, ar: copy.descriptionAr },
      ...extra,
    },
    { token: session.accessToken, channelId: video.channelId },
  );
}

async function setThumbnail(session: SessionTokens, video: VideoRecord, thumbnail: string): Promise<void> {
  await api.request(`/api/videos/${video.id}/thumbnail`, {
    method: 'POST',
    token: session.accessToken,
    channelId: video.channelId,
    body: imageForm('thumbnail', thumbnail),
  });
}

/** The description shown on the watch page always carries the licence attribution. */
function withAttribution(clip: Clip): LocalizedCopy {
  return {
    title: clip.title,
    titleAr: clip.titleAr,
    description: `${clip.description}\n\nCredit: ${clip.source.attribution}`,
    descriptionAr: `${clip.descriptionAr}\n\nالمصدر: ${clip.source.attribution}`,
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type Sessions = Map<string, SessionTokens>;

const emailFor = (key: string) => `demo-${key}@${EMAIL_DOMAIN}`;

async function ensureAccounts(): Promise<Sessions> {
  log.group('Accounts');
  const sessions: Sessions = new Map();
  const browser = await chromium.launch({ headless: true });
  const resend = RESEND_API_KEY ? new ResendTestClient(RESEND_API_KEY) : null;
  const readCode = async (email: string) => {
    const html = await resend!.getVerificationEmail(email, 15, 3000);
    const code = html ? resend!.extractVerificationCode(html) : null;
    if (code) maskSecret(code);
    return code;
  };
  try {
    for (const channel of manifest.channels) {
      const email = emailFor(channel.key);
      const login = await loginWithPassword(browser, authConfig, email, PASSWORD);
      if (login.ok) {
        sessions.set(channel.key, login.session);
        continue;
      }
      if (login.reason !== 'invalid_credentials') throw new Error(`Login for ${email} failed: ${login.message}`);
      if (MODE === 'check') {
        failures.push(`account missing: ${email}`);
        continue;
      }
      if (!resend) throw new Error(`${email} does not exist and RESEND_API_KEY is not set`);
      sessions.set(channel.key, await registerAccount(browser, authConfig, email, PASSWORD, readCode));
      note(`account created: ${email}`);
      await sleep(2000);
    }
  } finally {
    await browser.close();
  }
  log.groupEnd();
  return sessions;
}

/** Re-logs in any session close to expiry, updating it in place. */
async function freshen(sessions: Sessions): Promise<void> {
  const soon = Date.now() / 1000 + TOKEN_MARGIN_S;
  const expiring = manifest.channels.filter((c) => {
    const session = sessions.get(c.key);
    return session && Number(decodeJwtPayload(session.accessToken).exp) < soon;
  });
  if (expiring.length === 0) return;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const channel of expiring) {
      const login = await loginWithPassword(browser, authConfig, emailFor(channel.key), PASSWORD);
      if (!login.ok) throw new Error(`Re-login failed for ${emailFor(channel.key)}: ${login.message}`);
      Object.assign(sessions.get(channel.key)!, login.session);
    }
  } finally {
    await browser.close();
  }
  log.info('Refreshed tokens', { accounts: expiring.length });
}

async function ensureChannel(session: SessionTokens, def: ChannelDef): Promise<ChannelRecord | undefined> {
  const existing = (await listOwnChannels(api, session)) as ChannelRecord[];
  const found = existing.find((c) => c.name === def.name);
  if (found) return found;
  if (MODE === 'check') {
    failures.push(`channel missing: ${def.name}`);
    return undefined;
  }
  const res = await api.post<{ result?: { channel?: ChannelRecord } }>(
    '/api/channels',
    {
      name: def.name,
      nameLocalized: { en: def.name, ar: def.nameAr },
      description: def.description,
      descriptionLocalized: { en: def.description, ar: def.descriptionAr },
      isMain: true,
    },
    { token: session.accessToken },
  );
  const channel = res.data.result?.channel;
  if (!channel?.id) throw new Error(`Channel create for "${def.name}" returned no id`);
  note(`channel created: ${def.name}`);
  return channel;
}

async function ensureChannelArt(session: SessionTokens, channel: ChannelRecord, def: ChannelDef): Promise<void> {
  if (MODE === 'check' || (channel.avatarUrl && channel.coverUrl)) return;
  const clip = manifest.clips.find((c) => c.slug === def.artClip);
  if (!clip) throw new Error(`Channel ${def.key} art clip ${def.artClip} is not in the manifest`);
  const { video } = await mediaFor(clip);
  const at = bestFrameTime(video);
  if (!channel.avatarUrl) {
    const avatar = extractImage(video, path.join(MEDIA_DIR, `${def.key}.avatar.jpg`), "crop='min(iw,ih)':'min(iw,ih)',scale=400:400", at);
    await api.request(`/api/channels/${channel.id}/avatar`, { method: 'PUT', token: session.accessToken, channelId: channel.id, body: imageForm('photo', avatar) });
  }
  if (!channel.coverUrl) {
    const filter = "scale=1920:-2,crop=1920:'min(ih,480)'";
    const cover = extractImage(video, path.join(MEDIA_DIR, `${def.key}.cover.jpg`), filter, at);
    await api.request(`/api/channels/${channel.id}/cover`, { method: 'PUT', token: session.accessToken, channelId: channel.id, body: imageForm('photo', cover) });
  }
  note(`channel art set: ${def.name}`);
}

interface Seeded {
  slug: string;
  video: VideoRecord;
  channelKey: string;
  fresh: boolean;
}

async function ensureClip(session: SessionTokens, channelId: string, existing: VideoRecord[], clip: Clip): Promise<Seeded | undefined> {
  const copy = withAttribution(clip);
  const found = existing.find((v) => v.title === clip.title);
  if (found) {
    const status = await uploadStatus(session, found);
    const age = Date.now() - new Date(found.dateCreated || 0).getTime();
    const stale = status === 'failed' || status === 'deleted' || (status === 'uploading' && age > STALE_UPLOAD_MS);
    if (!stale) {
      await setMetadata(session, found, copy, clip);
      return { slug: clip.slug, video: found, channelKey: clip.channel, fresh: false };
    }
    if (MODE === 'check') {
      failures.push(`stale upload: ${clip.slug} (${status})`);
      return undefined;
    }
    log.warn('Replacing stale upload', { slug: clip.slug, status });
    await api.request(`/api/videos/${found.id}`, { method: 'DELETE', token: session.accessToken, channelId });
  } else if (MODE === 'check') {
    failures.push(`video missing: ${clip.slug}`);
    return undefined;
  }
  const { video } = await mediaFor(clip);
  const record = await uploadFile(session, channelId, copy, clip.tags, video, probeDuration(video));
  await setMetadata(session, record, copy, clip);
  note(`uploaded: ${clip.slug}`);
  return { slug: clip.slug, video: record, channelKey: clip.channel, fresh: true };
}

async function waitForEncoding(sessions: Sessions, seeded: Seeded[]): Promise<void> {
  log.group('Encoding');
  const pending = new Map(seeded.filter((s) => s.fresh).map((s) => [s.video.id, s]));
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  while (pending.size > 0 && Date.now() < deadline) {
    await freshen(sessions);
    for (const [id, item] of pending) {
      const status = await uploadStatus(sessions.get(item.channelKey)!, item.video);
      if (status === 'ready') pending.delete(id);
      else if (status === 'failed' || status === 'deleted') {
        pending.delete(id);
        failures.push(`encoding ${status}: ${item.slug}`);
      }
    }
    if (pending.size > 0) {
      log.info('Waiting for encoding', { pending: pending.size });
      await sleep(20000);
    }
  }
  for (const item of pending.values()) failures.push(`encoding timed out: ${item.slug}`);
  log.groupEnd();
}

/**
 * The deliberate failure: real upload path, but the file is not a video, so
 * Bunny rejects it and playback has no working stream.
 */
async function ensureUnplayable(sessions: Sessions, channels: Map<string, ChannelRecord>, seeded: Seeded[]): Promise<VideoRecord | undefined> {
  const def = manifest.unplayable;
  await freshen(sessions);
  const session = sessions.get(def.channel);
  const channel = channels.get(def.channel);
  if (!session || !channel) return undefined;
  const copy: LocalizedCopy = def;
  let video = (await listVideos(session, channel.id)).find((v) => v.title === def.title);
  if (!video) {
    if (MODE === 'check') {
      failures.push('unplayable video missing');
      return undefined;
    }
    const file = path.join(MEDIA_DIR, `${def.slug}.mp4`);
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(64 * 1024, 'not a video '));
    video = await uploadFile(session, channel.id, copy, def.tags, file, 30);
    note('uploaded deliberately unplayable video');
  }
  await setMetadata(session, video, copy, { category: def.category, tags: def.tags, language: def.language });
  if (MODE === 'apply') {
    const full = await fetchVideo(video.id);
    if (full?.thumbnailType !== 'custom') {
      const clip = manifest.clips.find((c) => c.slug === def.thumbnailClip);
      if (!clip) throw new Error(`Unplayable thumbnail clip ${def.thumbnailClip} is not in the manifest`);
      const { thumbnail } = await mediaFor(clip);
      await setThumbnail(session, video, thumbnail);
    }
  }
  seeded.push({ slug: def.slug, video, channelKey: def.channel, fresh: false });
  return video;
}

async function fetchVideo(id: string): Promise<VideoRecord | null> {
  const res = await api.get<VideoRecord>(`/api/videos/${id}`, { allowStatus: [404] });
  return res.status === 404 ? null : res.data;
}

async function ensureThumbnails(sessions: Sessions, seeded: Seeded[]): Promise<void> {
  if (MODE === 'check') return;
  log.group('Thumbnails');
  for (const item of seeded) {
    const clip = manifest.clips.find((c) => c.slug === item.slug);
    if (!clip) continue;
    const full = await fetchVideo(item.video.id);
    if (full?.thumbnailType === 'custom') continue;
    const { thumbnail } = await mediaFor(clip);
    await freshen(sessions);
    await setThumbnail(sessions.get(item.channelKey)!, item.video, thumbnail);
    note(`thumbnail set: ${clip.slug}`);
  }
  log.groupEnd();
}

interface PlaylistRecord {
  id: string;
  title: string;
  channelId?: string;
  videos?: string[];
  isDeleted?: boolean;
}

async function ensurePlaylists(sessions: Sessions, channels: Map<string, ChannelRecord>, seeded: Seeded[]): Promise<Map<string, string>> {
  log.group('Playlists');
  await freshen(sessions);
  const ids = new Map<string, string>();
  const idOf = new Map(seeded.map((s) => [s.slug, s.video.id]));
  for (const def of manifest.playlists) {
    const session = sessions.get(def.channel);
    const channel = channels.get(def.channel);
    if (!session || !channel) continue;
    const videos = def.clips.map((slug) => idOf.get(slug)).filter((id): id is string => Boolean(id));
    const all = await api.listAll<PlaylistRecord>('/api/playlists', { token: session.accessToken });
    const found = all.find((p) => p.title === def.title && p.channelId === channel.id && !p.isDeleted);
    if (found) {
      ids.set(def.key, found.id);
      const missing = videos.filter((id) => !(found.videos || []).includes(id));
      if (MODE === 'apply') {
        for (const videoId of missing) {
          await api.post(`/api/playlists/${found.id}/videos`, { videoId }, { token: session.accessToken, channelId: channel.id, allowStatus: [409] });
        }
      }
      continue;
    }
    if (MODE === 'check') {
      failures.push(`playlist missing: ${def.title}`);
      continue;
    }
    const res = await api.post<{ result?: { playlist?: PlaylistRecord } }>(
      '/api/playlists',
      { title: def.title, description: def.description, videos, isPublic: true },
      { token: session.accessToken, channelId: channel.id },
    );
    const id = res.data.result?.playlist?.id;
    if (id) ids.set(def.key, id);
    note(`playlist created: ${def.title}`);
  }
  log.groupEnd();
  return ids;
}

// ---------------------------------------------------------------------------
// Channel pages and community activity
// ---------------------------------------------------------------------------

interface SectionRecord {
  id: string;
  type: string;
  title: string;
  position?: number;
  content?: { videoIds?: string[]; playlistId?: string; playlistIds?: string[] };
  populatedContent?: { videos?: unknown[]; channels?: unknown[] };
}

const HIDDEN_TABS = ['live', 'community', 'channels'];
const visibleTabs = (hasShorts: boolean) => ['home', 'videos', ...(hasShorts ? ['shorts'] : []), 'playlists', 'about'];
const hasShorts = (key: string) => manifest.clips.some((c) => c.channel === key && c.orientation === 'portrait');
/** The web renders section.title only, so the visible title carries both languages. */
const sectionTitle = (def: SectionDef) => `${def.title} | ${def.titleAr}`;

async function listSections(session: SessionTokens | undefined, channelId: string): Promise<SectionRecord[]> {
  const res = await api.get<{ result?: { sections?: SectionRecord[] } }>(`/api/channels/${channelId}/sections/populated`, session ? { token: session.accessToken } : {});
  return res.data.result?.sections ?? [];
}

async function ensureSections(sessions: Sessions, channels: Map<string, ChannelRecord>, seeded: Seeded[], playlistIds: Map<string, string>): Promise<void> {
  log.group('Channel sections');
  const videoOf = new Map(seeded.map((s) => [s.slug, s.video.id]));
  for (const def of manifest.channels) {
    await freshen(sessions);
    const session = sessions.get(def.key);
    const channel = channels.get(def.key);
    if (!session || !channel) continue;
    const existing = await listSections(session, channel.id);
    const ordered: string[] = [];
    for (const section of def.sections) {
      const title = sectionTitle(section);
      let found = existing.find((s) => s.title === title && s.type === section.type);
      if (!found) {
        if (MODE === 'check') {
          failures.push(`section missing: ${def.key} / ${section.title}`);
          continue;
        }
        const playlists = (section.playlists ?? []).map((key) => playlistIds.get(key)).filter((id): id is string => Boolean(id));
        if ((section.playlists?.length ?? 0) !== playlists.length) throw new Error(`Section ${title}: playlist not seeded`);
        const videoIds = (section.clips ?? []).map((slug) => videoOf.get(slug)).filter((id): id is string => Boolean(id));
        if ((section.clips?.length ?? 0) !== videoIds.length) throw new Error(`Section ${title}: clip not seeded`);
        const res = await api.post<{ result?: { section?: SectionRecord } }>(
          `/api/channels/${channel.id}/sections`,
          {
            type: section.type,
            title,
            titleLocalized: { en: section.title, ar: section.titleAr },
            ...(videoIds.length ? { videoIds } : {}),
            ...(section.type === 'single_playlist' ? { playlistId: playlists[0] } : {}),
            ...(section.type === 'multiple_playlists' ? { playlistIds: playlists } : {}),
          },
          { token: session.accessToken, channelId: channel.id },
        );
        found = res.data.result?.section;
        if (!found?.id) throw new Error(`Section ${title} returned no id`);
        note(`section created: ${def.key} / ${section.title}`);
      }
      ordered.push(found.id);
    }
    const current = (await listSections(session, channel.id)).map((s) => s.id);
    if (MODE === 'apply' && JSON.stringify(current) !== JSON.stringify(ordered) && current.length === ordered.length) {
      await api.request(`/api/channels/${channel.id}/sections/reorder`, { method: 'PATCH', token: session.accessToken, channelId: channel.id, json: { sectionIds: ordered } });
      note(`sections reordered: ${def.key}`);
    }
  }
  log.groupEnd();
}

interface TabsResponse {
  result?: { config?: { tabs?: Array<{ id: string; visible: boolean }> } };
}

async function ensureTabs(sessions: Sessions, channels: Map<string, ChannelRecord>): Promise<void> {
  log.group('Channel tabs');
  for (const def of manifest.channels) {
    await freshen(sessions);
    const session = sessions.get(def.key);
    const channel = channels.get(def.key);
    if (!session || !channel) continue;
    const wanted = new Set(visibleTabs(hasShorts(def.key)));
    const res = await api.get<TabsResponse>(`/api/channels/${channel.id}/tabs`, { token: session.accessToken, allowStatus: [404] });
    const tabs = res.data.result?.config?.tabs ?? [];
    const correct = tabs.length > 0 && tabs.every((t) => t.visible === wanted.has(t.id));
    if (correct) continue;
    if (MODE === 'check') {
      failures.push(`tabs not configured: ${def.key}`);
      continue;
    }
    const ids = tabs.length > 0 ? tabs.map((t) => t.id) : [...wanted, ...HIDDEN_TABS, 'shorts'];
    await api.put(
      `/api/channels/${channel.id}/tabs`,
      { defaultTab: 'home', tabs: [...new Set(ids)].map((id) => ({ id, visible: wanted.has(id) })) },
      { token: session.accessToken, channelId: channel.id },
    );
    note(`tabs configured: ${def.key}`);
  }
  log.groupEnd();
}

interface CommentRecord {
  text?: string;
  channelId?: string;
}

async function ensureEngagement(sessions: Sessions, channels: Map<string, ChannelRecord>, seeded: Seeded[]): Promise<void> {
  if (MODE === 'check') return;
  log.group('Community activity');
  const { subscriptions, comments, likes } = manifest.engagement;
  const videoOf = new Map(seeded.map((s) => [s.slug, s.video.id]));
  const actor = (key: string) => {
    const session = sessions.get(key);
    const channel = channels.get(key);
    if (!session || !channel) throw new Error(`Demo account ${key} is unavailable`);
    return { session, channelId: channel.id };
  };

  let created = 0;
  for (const { by, to } of subscriptions) {
    await freshen(sessions);
    const { session, channelId } = actor(by);
    for (const target of to) {
      const res = await api.post<{ error?: string }>(`/api/channels/${channels.get(target)!.id}/subscriptions`, {}, { token: session.accessToken, channelId, allowStatus: [400, 409] });
      if (res.status < 300 && !res.data?.error) created++;
    }
  }
  note(`subscriptions created: ${created}`);

  created = 0;
  for (const { clip, by, text } of comments) {
    await freshen(sessions);
    const videoId = videoOf.get(clip);
    if (!videoId) throw new Error(`Comment target ${clip} not seeded`);
    const { session, channelId } = actor(by);
    const res = await api.get<{ result?: { comments?: CommentRecord[] } }>(`/api/videos/${videoId}/comments?limit=100`, { token: session.accessToken });
    if ((res.data.result?.comments ?? []).some((c) => c.text === text && c.channelId === channelId)) continue;
    await api.post(`/api/videos/${videoId}/comments`, { text }, { token: session.accessToken, channelId });
    created++;
  }
  note(`comments created: ${created}`);

  created = 0;
  for (const { clip, by } of likes) {
    await freshen(sessions);
    const videoId = videoOf.get(clip);
    if (!videoId) throw new Error(`Like target ${clip} not seeded`);
    const video = await api.get<{ likes?: Array<{ channelId?: string }> }>(`/api/videos/${videoId}`);
    const liked = new Set((video.data.likes ?? []).map((l) => l.channelId));
    for (const key of by) {
      const { session, channelId } = actor(key);
      if (liked.has(channelId)) continue;
      const res = await api.post(`/api/videos/${videoId}/likes`, {}, { token: session.accessToken, channelId, allowStatus: [400, 409] });
      if (res.status < 300) created++;
    }
  }
  note(`likes created: ${created}`);
  log.groupEnd();
}

/** Every section must resolve to real items, the way the channel Home tab loads them. */
async function verifyChannelPages(channels: Map<string, ChannelRecord>): Promise<void> {
  log.group('Channel page verification');
  const rows: string[] = [];
  for (const def of manifest.channels) {
    const channel = channels.get(def.key);
    if (!channel) continue;
    const sections = await listSections(undefined, channel.id);
    if (sections.length !== def.sections.length) failures.push(`${def.key}: ${sections.length} sections, expected ${def.sections.length}`);
    for (const section of sections) {
      let items = 0;
      if (section.type === 'recent_uploads' || section.type === 'popular_uploads') items = section.populatedContent?.videos?.length ?? 0;
      else if (section.type === 'subscribed_channels') items = section.populatedContent?.channels?.length ?? 0;
      else if (section.type === 'liked_videos') items = (await api.get<{ data?: unknown[] }>(`/api/videos?channelId=${channel.id}&limit=12`)).data.data?.length ?? 0;
      else if (section.type === 'featured_videos') {
        for (const id of section.content?.videoIds ?? []) if (await fetchVideo(id)) items++;
      } else {
        const ids = section.content?.playlistIds ?? (section.content?.playlistId ? [section.content.playlistId] : []);
        for (const id of ids) {
          const playlist = await api.get<{ videos?: unknown[]; result?: { playlist?: { videos?: unknown[] } } }>(`/api/playlists/${id}`, { allowStatus: [404] });
          if ((playlist.data.videos ?? playlist.data.result?.playlist?.videos ?? []).length > 0) items++;
        }
      }
      rows.push(`${def.key} | ${section.position} | ${section.type} | ${section.title} | items=${items}`);
      if (items === 0) failures.push(`${def.key}: section "${section.title}" has no items`);
    }
    const tabs = await api.get<TabsResponse>(`/api/channels/${channel.id}/tabs`);
    const shown = (tabs.data.result?.config?.tabs ?? []).filter((t) => t.visible).map((t) => t.id).sort();
    const expected = visibleTabs(hasShorts(def.key)).sort();
    rows.push(`${def.key} | tabs | ${shown.join(',')}`);
    if (JSON.stringify(shown) !== JSON.stringify(expected)) failures.push(`${def.key}: tabs ${shown.join(',')}, expected ${expected.join(',')}`);
    const detail = await api.get<{ subscribersCount?: number }>(`/api/channels/${channel.id}`);
    rows.push(`${def.key} | subscribers | ${detail.data.subscribersCount ?? 0}`);
  }
  log.info(`Channel pages:\n${rows.join('\n')}`);
  log.groupEnd();
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function status(url: string): Promise<{ code: number; text: string; type: string }> {
  const res = await fetch(url).catch(() => null);
  if (!res) return { code: 0, text: '', type: '' };
  const type = res.headers.get('content-type') || '';
  const text = /mpegurl|text/i.test(type) || url.includes('.m3u8') ? await res.text() : (await res.arrayBuffer(), '');
  return { code: res.status, text, type };
}

const firstUri = (playlist: string) => playlist.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));

/** Master playlist, a variant playlist and its first segment must all return 200. */
async function checkPlayback(playUrl: string): Promise<string> {
  const master = await status(playUrl);
  if (master.code !== 200) return `playlist ${master.code}`;
  const variantUri = firstUri(master.text);
  if (!variantUri) return 'playlist empty';
  const variantUrl = new URL(variantUri, playUrl).toString();
  const variant = await status(variantUrl);
  if (variant.code !== 200) return `variant ${variant.code}`;
  const segmentUri = firstUri(variant.text);
  if (!segmentUri) return 'variant empty';
  const segment = await status(new URL(segmentUri, variantUrl).toString());
  return segment.code === 200 ? 'ok' : `segment ${segment.code}`;
}

async function verify(seeded: Seeded[], unplayableId: string | undefined): Promise<void> {
  log.group('Verification');
  const rows: string[] = [];
  const ids = [...seeded.map((s) => ({ slug: s.slug, id: s.video.id })), ...manifest.keep.map((id) => ({ slug: `kept:${id.slice(0, 8)}`, id }))];
  for (const { slug, id } of ids) {
    const video = await fetchVideo(id);
    const thumb = video?.thumbnailUrl ? await status(video.thumbnailUrl) : { code: 0, text: '', type: '' };
    const thumbOk = thumb.code === 200 && /^image\//.test(thumb.type);
    const playback = video?.playUrl ? await checkPlayback(video.playUrl) : 'no playUrl';
    rows.push(`${slug}: playback=${playback} thumbnail=${thumb.code}`);
    if (id === unplayableId) {
      if (playback === 'ok') failures.push(`${slug}: expected to be unplayable but plays`);
      if (!thumbOk) failures.push(`${slug}: thumbnail ${thumb.code}`);
      continue;
    }
    if (playback !== 'ok') failures.push(`${slug}: ${playback}`);
    if (!thumbOk) failures.push(`${slug}: thumbnail ${thumb.code}`);
  }
  log.info(`Verification results:\n${rows.join('\n')}`);
  log.groupEnd();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!PASSWORD) throw new Error('QA_SEED_PASSWORD is required');
  maskSecret(PASSWORD);
  const sessions = await ensureAccounts();

  log.group('Channels');
  const channels = new Map<string, ChannelRecord>();
  for (const def of manifest.channels) {
    const session = sessions.get(def.key);
    if (!session) continue;
    await freshen(sessions);
    if (MODE === 'apply') await ensureProfile(api, session, { email: emailFor(def.key), displayName: def.name });
    const channel = await ensureChannel(session, def);
    if (!channel) continue;
    channels.set(def.key, channel);
    await ensureChannelArt(session, channel, def);
  }
  log.groupEnd();

  log.group('Videos');
  const seeded: Seeded[] = [];
  for (const def of manifest.channels) {
    const session = sessions.get(def.key);
    const channel = channels.get(def.key);
    if (!session || !channel) continue;
    const existing = await listVideos(session, channel.id);
    for (const clip of manifest.clips.filter((c) => c.channel === def.key)) {
      try {
        await freshen(sessions);
        const item = await ensureClip(session, channel.id, existing, clip);
        if (item) seeded.push(item);
      } catch (error) {
        failures.push(`${clip.slug}: ${error instanceof Error ? error.message : String(error)}`);
        log.warn('Clip failed; continuing', { slug: clip.slug });
      }
    }
  }
  log.groupEnd();

  if (MODE === 'apply') await waitForEncoding(sessions, seeded);
  await ensureThumbnails(sessions, seeded);
  const unplayable = await ensureUnplayable(sessions, channels, seeded);
  const playlists = await ensurePlaylists(sessions, channels, seeded);

  const shorts = new Set(manifest.clips.filter((c) => c.orientation === 'portrait').map((c) => c.slug));
  const demoSet = {
    channels: [...channels.values()].map((c) => c.id),
    videos: [...seeded.map((s) => s.video.id), ...manifest.keep],
    shorts: seeded.filter((s) => shorts.has(s.slug)).map((s) => s.video.id),
    extraVideos: manifest.keep,
    playlists: [...playlists.values()],
  };
  fs.writeFileSync(DEMO_SET_OUT, `${JSON.stringify(demoSet, null, 2)}\n`);
  log.info('Wrote demo set', { path: DEMO_SET_OUT, videos: demoSet.videos.length });

  await ensureEngagement(sessions, channels, seeded);
  await ensureSections(sessions, channels, seeded, playlists);
  await ensureTabs(sessions, channels);

  await verify(seeded, unplayable?.id);
  await verifyChannelPages(channels);
}

main()
  .then(() => {
    if (notes.length) log.info(`Changes:\n${notes.join('\n')}`);
    if (failures.length) {
      log.error(`Demo seed finished with ${failures.length} problem(s):\n${failures.join('\n')}`);
      process.exit(1);
    }
    log.info(`Demo seed finished (${MODE})`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    log.error(`Demo seed failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exit(1);
  });
