/**
 * Fixture builders: every spec creates the data it needs and removes it afterwards (owner rule
 * 2026-11-12, scripts/e2e/placement-doc.ts "Data"). No spec reads the global seed, a demo video,
 * "the newest public video" or a hard-coded id (scripts/qa/__tests__/own-data.test.ts).
 *
 *   const data = useOwnData(test);                         // afterAll: data.cleanup()
 *   test.beforeAll(async ({ browser }) => {
 *     const page = await browser.newPage();
 *     const owner = await data.createUser(page, 'watch');  // real sign-up (issuer + code sink)
 *     await data.grantCreator(owner);
 *     const channelId = await data.createChannel(owner);
 *     const video = await data.createVideo(owner, channelId, { clip: 'landscape90', chapters: true });
 *   });
 *
 * - Everything goes through the real APIs (initiate → TUS through the api-videos proxy → complete
 *   for videos). On the local stack (E2E_ENV=local) the fake Bunny encodes right after the upload;
 *   on QA/stage the real encode is awaited and a slow one skips with #929 (encode.ts).
 * - Names carry ns(): run id, spec file and worker, so parallel shards and runs never share rows.
 * - A DataScope records what it created; cleanup() deletes it in reverse order and is idempotent
 *   (404 = already gone): videos permanently (DELETE /api/videos/:id/permanent: record, media, the
 *   Bunny video and their index rows), then playlists/posts/comments, channels, and last each user:
 *   the privacy erase (everything the user owns) and the auth account with its sessions.
 * - Teardown always runs: useOwnData(test) is a per-file afterAll; the `test` export's `ownData` /
 *   `workerData` fixtures clean up after use(), also on failure, timeout or retry. Users' ids go to
 *   E2E_RUN_USER_IDS_FILE for the end-of-job leftover check. Everything belongs to run accounts
 *   (sinkEmail → run-users.ts in CI), so if a worker crashes before afterAll the run's teardown
 *   (cleanup-test-content.ts --run-users, then teardown-run-users.ts) still erases the content and
 *   deletes the accounts on QA/stage; the local stack is discarded with the job.
 *
 * Imports stay inside e2e/release, e2e/test-utils/{code-sink,run-users,placement}.ts and
 * e2e/test-fixtures (the release suite runs from a copy, CLAUDE.md "Release regressions").
 */
import { appendFileSync, readFileSync } from 'fs';
import * as path from 'path';
import { expect, test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { releaseEnv, target } from './targets';
import { apiFetch, createProfile, signInAgain, signUpOnWeb, type Locale, type WebUser } from './web-session';
import { grantCreatorTier, setCreatorTier } from './creator-tier';
import { encoding, untilEncoded } from './encode';
import { isRunUserEmail, runId } from '../test-utils/run-users';

const FIXTURES = path.join(__dirname, '..', 'test-fixtures');

/**
 * Upload clips. Lengths match what the local fake Bunny serves for them (the player's HLS
 * fixtures: landscape 90 s, vertical 12 s), so duration-sensitive specs agree with playback.
 */
export const CLIPS = {
  /** 160x90, 90 s: long enough for watch history and resume (≥ 75 s) */
  landscape90: { file: 'e2e-sample-90s.mp4', duration: 90 },
  /** 160x90, 40 s */
  landscape40: { file: 'e2e-sample-40s.mp4', duration: 40 },
  /** 90x160 portrait: a Short */
  vertical: { file: 'e2e-sample-vertical.mp4', duration: 4 },
  /** 240x240: a square video */
  square: { file: 'e2e-sample-square.mp4', duration: 4 },
} as const;
export type Clip = keyof typeof CLIPS;

/** Chapters every chaptered video gets (four, inside the shortest landscape clip). */
export const CHAPTERS = [
  { startTime: 0, endTime: 10, title: 'Introduction', titleLocalized: { en: 'Introduction', ar: 'المقدمة' } },
  { startTime: 10, endTime: 20, title: 'Part one', titleLocalized: { en: 'Part one', ar: 'الجزء الأول' } },
  { startTime: 20, endTime: 30, title: 'Part two', titleLocalized: { en: 'Part two', ar: 'الجزء الثاني' } },
  { startTime: 30, endTime: 40, title: 'Closing', titleLocalized: { en: 'Closing', ar: 'الخاتمة' } },
];

const VTT = {
  en: 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nWelcome to this E2E sample.\n\n00:00:05.000 --> 00:00:15.000\nCreated by the spec that uses it.\n',
  ar: 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nمرحبا بكم في هذا المثال.\n\n00:00:05.000 --> 00:00:15.000\nأنشأه الاختبار الذي يستخدمه.\n',
};

/** The local stack's control API (scripts/local-stack/fake-external.ts). */
const LOCAL_CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
export const onLocalStack = () => releaseEnv() === 'local';

/** Namespace for names: run, spec file and worker (parallel shards never share rows). */
export function ns(): string {
  let spec = 'spec';
  let worker = 0;
  try {
    const info = base.info();
    spec = path.basename(info.file).replace(/\.spec\.ts$/, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 24);
    worker = info.parallelIndex;
  } catch {
    /* outside a test (global setup): no spec */
  }
  return `${runId() || process.env.E2E_RUN_TAG || 'local'}-${spec}-w${worker}`;
}

/** A browser storage state (cookies + origins) a test context can start from. */
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/** A creator with channels and a web session that knows them (createCreator). */
export interface Creator {
  user: WebUser;
  channelIds: string[];
  /** Signed in as the creator: `test.use({ storageState: async ({}, use) => use(creator.state) })` */
  state: StorageState;
}

export interface CreatedVideo {
  id: string;
  title: string;
  channelId: string;
  clip: Clip;
}

async function ok(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  expect(res.status, `${what}: ${text.slice(0, 300)}`).toBeLessThan(300);
  return text ? JSON.parse(text) : {};
}

const json = (body: unknown, channelId?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) },
  body: JSON.stringify(body),
});

/** The videos web app's OAuth client per environment (apps/web wrangler configs; the local stack seeds prod's ids). */
const WEB_CLIENT_ID: Record<string, string> = {
  qa: 'e0de3c30-0304-4ac4-86d6-1e185dec0439',
  stage: 'f0de3c30-0304-4ac4-86d6-1e185dec0439',
  local: 'f0de3c30-0304-4ac4-86d6-1e185dec0439',
  production: 'f0de3c30-0304-4ac4-86d6-1e185dec0439',
};

/** The refresh token in the web app's session cookie (plain JSON, possibly nested per account). */
function findRefreshToken(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.refreshToken === 'string') return record.refreshToken;
  for (const nested of Object.values(record)) {
    const found = findRefreshToken(nested);
    if (found) return found;
  }
  return undefined;
}

/**
 * A fresh access token for cleanup: access tokens live 15 minutes on QA, longer than many specs
 * run, and an expired token would fail every delete (and leak the data). Refresh tokens rotate.
 */
async function refreshUser(user: WebUser, refreshToken: string | undefined): Promise<string | undefined> {
  if (!refreshToken) return undefined;
  try {
    const res = await fetch(`${target().auth}/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: WEB_CLIENT_ID[releaseEnv()] }),
    });
    if (!res.ok) return refreshToken;
    const body = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (body.access_token) user.accessToken = body.access_token;
    return body.refresh_token ?? refreshToken;
  } catch {
    return refreshToken;
  }
}

/**
 * Cleanup is bounded so it can never time out a test that passed. Stage, v2026.11.12.7: the
 * teardown of a user with no content ran past the 3-minute test timeout (header-name.spec.ts);
 * the privacy erase scans every channel, video and community object of the environment, so its
 * resumable rounds grow with the environment, not with the user.
 * Each request has REQUEST_TIMEOUT_MS, the erase loop ERASE_BUDGET_MS, a whole cleanup
 * CLEANUP_BUDGET_MS; the fixtures get their own teardown time on top of the test's. Whatever is
 * left belongs to a run account: the run teardown (cleanup-test-content.ts --run-users, then
 * teardown-run-users.ts) erases it and the leftover check reports it.
 */
const REQUEST_TIMEOUT_MS = 30_000;
const ERASE_BUDGET_MS = 60_000;
const CLEANUP_BUDGET_MS = 120_000;
/** The budget, plus one request that started just before the deadline, plus room to spare. */
const FIXTURE_TIMEOUT_MS = CLEANUP_BUDGET_MS + REQUEST_TIMEOUT_MS + 30_000;

/**
 * Erases a user completely: DELETE /api/privacy/data (profile, channels, videos with their Bunny
 * media, playlists, posts, history, subscriptions, likes; resumable) as the user, then the account
 * and its sessions on the auth server (QA/stage/local test route, run accounts only). 404 = gone.
 * The erase stops after ERASE_BUDGET_MS; the account is deleted either way.
 */
async function eraseUser(user: WebUser): Promise<Response | undefined> {
  let resumeToken: string | undefined;
  const deadline = Date.now() + ERASE_BUDGET_MS;
  for (let round = 0; round < 20; round++) {
    const left = deadline - Date.now();
    if (left <= 0) {
      console.warn(`[builders] privacy erase of ${user.email} still incomplete after ${ERASE_BUDGET_MS / 1000} s: left to the run teardown`);
      break;
    }
    const res = await apiFetch(user, '/api/privacy/data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE', ...(resumeToken ? { resumeToken } : {}) }),
      signal: AbortSignal.timeout(Math.min(left, REQUEST_TIMEOUT_MS)),
    }).catch((error: Error) => {
      console.warn(`[builders] privacy erase of ${user.email} failed: ${error.message} (left to the run teardown)`);
      return undefined;
    });
    if (!res) break;
    if (res.status >= 300) {
      if (res.status !== 404 && res.status !== 401) console.warn(`[builders] privacy erase of ${user.email} answered ${res.status}`);
      break;
    }
    const body = (await res.json().catch(() => ({}))) as { complete?: boolean; resumeToken?: string; result?: { complete?: boolean; resumeToken?: string } };
    const result = body.result ?? body;
    if (result.complete !== false) break;
    resumeToken = result.resumeToken;
  }
  return deleteAccount(user.email);
}

/** The run account on the auth server (soft delete + immediate purge, sessions revoked). Run accounts only. */
async function deleteAccount(email: string): Promise<Response | undefined> {
  const sink = process.env.E2E_CODE_SINK_SECRET;
  const promote = process.env.TEST_PROMOTE_SECRET;
  if (!isRunUserEmail(email) || !sink || !promote || releaseEnv() === 'production') return undefined;
  return fetch(`${target().auth}/test/run-users/delete/${encodeURIComponent(email)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'X-E2E-Secret': sink, 'X-Test-Secret': promote, 'User-Agent': 'al-ummah-e2e-builders' },
  });
}

/**
 * Records a created resource ("<kind> <id>", one per line) in E2E_RUN_RESOURCES_FILE: the
 * end-of-job leftover checks look for its Bunny video, collection and R2 objects even after the
 * D1 rows are gone (scripts/e2e/run-leftovers.ts).
 */
export function recordResource(kind: 'video' | 'channel', id: string): void {
  if (process.env.E2E_RUN_RESOURCES_FILE) appendFileSync(process.env.E2E_RUN_RESOURCES_FILE, `${kind} ${id}\n`);
}

/** Everything one spec (or worker) created, deleted again by cleanup(). */
export class DataScope {
  private undo: { what: string; run: () => Promise<unknown> }[] = [];
  /** Users this scope created or acts for, with their refresh tokens (cleanup refreshes first). */
  private sessions = new Map<WebUser, string | undefined>();

  /** A new user signed up through the real issuer (code sink), with a videos profile. */
  async createUser(page: Page, prefix: string, locale: Locale = 'en'): Promise<WebUser> {
    const user = await signUpOnWeb(page, prefix, locale);
    const cookie = (await page.context().cookies(target().web)).find((c) => c.name === 'al_ummah_session');
    let refreshToken: string | undefined;
    try {
      refreshToken = findRefreshToken(JSON.parse(decodeURIComponent(cookie?.value ?? '{}')));
    } catch {
      /* not JSON: cleanup keeps the original token */
    }
    this.sessions.set(user, refreshToken);
    // The id, for the end-of-job leftover check (rows keyed only by user id; the account is gone by then)
    if (process.env.E2E_RUN_USER_IDS_FILE) appendFileSync(process.env.E2E_RUN_USER_IDS_FILE, `${user.userId}\n`);
    // Runs last (cleanup is newest first): the user's data, then the account and its sessions
    this.undo.push({ what: `user ${user.email}`, run: () => eraseUser(user) });
    await createProfile(user);
    return user;
  }

  /**
   * The Creator tier (uploads and channels are by invitation). Local stack: written directly to
   * the stack's database (a fast path; the tier UI has its own specs). QA/stage: the admin-web control.
   */
  async grantCreator(user: WebUser, tierId = 'creator'): Promise<void> {
    const id = user.userId.replace(/[^A-Za-z0-9_:-]/g, '');
    const tier = tierId.replace(/[^A-Za-z0-9_:-]/g, '');
    // The assignment is removed again (before the user is erased: cleanup runs newest first)
    this.undo.push({
      what: `tier ${tier} of ${id}`,
      run: () =>
        onLocalStack()
          ? fetch(`${LOCAL_CONTROL}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: `DELETE FROM creator_tier_assignments WHERE user_id = '${id}'` })
          : setCreatorTier(user, null),
    });
    if (onLocalStack()) {
      const sql = `INSERT OR REPLACE INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('${id}', '${tier}', 'admin', 'e2e-builder-${ns()}', '${new Date().toISOString()}')`;
      const res = await fetch(`${LOCAL_CONTROL}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: sql });
      expect(res.ok, `local stack tier write: ${await res.text()}`).toBe(true);
    } else if (tier === 'creator') {
      await grantCreatorTier(user);
    } else {
      await setCreatorTier(user, tier);
    }
    await expect
      .poll(async () => ((await (await apiFetch(user, '/api/me/creator')).json().catch(() => ({}))) as { result?: { canUpload?: boolean } }).result?.canUpload, {
        message: 'GET /api/me/creator never allowed uploads',
        timeout: 20000,
      })
      .toBe(true);
  }

  async createChannel(user: WebUser, opts: { name?: string; isMain?: boolean } = {}): Promise<string> {
    const body = (await ok(
      await apiFetch(user, '/api/channels', json({ name: opts.name ?? `E2E ${ns()} ${Date.now().toString(36)}`, description: `Created by ${ns()}`, isMain: opts.isMain ?? true })),
      'POST /api/channels',
    )) as { result?: { channel?: { id?: string } } };
    const id = body.result?.channel?.id;
    expect(id, 'channel create returned no id').toBeTruthy();
    recordResource('channel', id as string);
    this.undo.push({ what: `channel ${id}`, run: () => apiFetch(user, `/api/channels/${id}`, { method: 'DELETE' }) });
    return id as string;
  }

  /** Uploads a clip (initiate → TUS → complete), optionally with chapters/subtitles, and waits until it is ready. */
  async createVideo(
    user: WebUser,
    channelId: string,
    opts: { clip?: Clip; title?: string; isPublic?: boolean; chapters?: boolean; subtitles?: boolean; waitReady?: boolean } = {},
  ): Promise<CreatedVideo> {
    const clip = opts.clip ?? 'landscape90';
    const bytes = readFileSync(path.join(FIXTURES, CLIPS[clip].file));
    const title = opts.title ?? `E2E ${clip} ${ns()} ${Date.now().toString(36)}`;
    const initiate = (await ok(
      await apiFetch(user, '/api/videos/upload/initiate', json({ title, description: `Created by ${ns()}`, fileSize: bytes.length, mimeType: 'video/mp4', isPublic: opts.isPublic ?? true }, channelId)),
      'POST /api/videos/upload/initiate',
    )) as { result?: { videoId?: string; tusSessionId?: string } };
    const id = initiate.result?.videoId as string;
    const tusSessionId = initiate.result?.tusSessionId as string;
    expect(id && tusSessionId, 'upload initiate returned no videoId/tusSessionId').toBeTruthy();
    recordResource('video', id);
    // Cleanup deletes for good (record, media, the Bunny video, search/ownership rows), even mid-encode
    // or after an interrupted upload: trash first (the owner's delete), then the permanent delete
    this.undo.push({
      what: `video ${id}`,
      run: async () => {
        await apiFetch(user, `/api/videos/${id}`, { method: 'DELETE', headers: { channelId } });
        return apiFetch(user, `/api/videos/${id}/permanent`, { method: 'DELETE', headers: { channelId } });
      },
    });

    const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64');
    const create = await apiFetch(user, '/api/videos/tus', {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(bytes.length),
        'Upload-Metadata': [`tusSessionId ${b64(tusSessionId)}`, `videoId ${b64(id)}`, `filename ${b64(CLIPS[clip].file)}`, `filetype ${b64('video/mp4')}`].join(','),
      },
    });
    expect(create.status, `TUS create: ${await create.clone().text()}`).toBeLessThan(300);
    const location = create.headers.get('Location');
    expect(location, 'TUS create returned no Location').toBeTruthy();
    const patch = await fetch(new URL(location as string, target().api), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${user.accessToken}`, 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
      body: new Uint8Array(bytes),
    });
    expect(patch.status, `TUS PATCH: ${await patch.clone().text()}`).toBeLessThan(300);
    await ok(await apiFetch(user, '/api/videos/upload/complete', json({ videoId: id, fileSize: bytes.length, duration: CLIPS[clip].duration }, channelId)), 'POST /api/videos/upload/complete');

    if (opts.chapters) {
      await ok(
        await apiFetch(user, `/api/videos/${id}/chapters`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', channelId },
          // Every chapter needs its own id
          body: JSON.stringify({ chapters: CHAPTERS.map((chapter) => ({ id: crypto.randomUUID(), ...chapter })) }),
        }),
        'PUT chapters',
      );
    }
    if (opts.subtitles) {
      for (const [language, vtt] of Object.entries(VTT)) {
        const form = new FormData();
        form.append('file', new Blob([vtt], { type: 'text/vtt' }), `${language}.vtt`);
        form.append('language', language);
        form.append('label', language === 'ar' ? 'العربية' : 'English');
        form.append('isDefault', String(language === 'en'));
        await ok(await apiFetch(user, `/api/videos/${id}/subtitles`, { method: 'POST', headers: { channelId }, body: form }), `POST subtitles ${language}`);
      }
    }
    if (opts.waitReady ?? true) await this.waitReady(id, title);
    return { id, title, channelId, clip };
  }

  /** Waits until the video is ready (encoded). QA/stage: a slow third-party encode skips with #929. */
  async waitReady(id: string, title = id): Promise<void> {
    // A reset socket (Node reusing a keep-alive connection the server already closed) is "not known yet":
    // the poll asks again; only a video that never becomes ready fails
    const status = async () => {
      const res = await fetch(`${target().api}/api/videos/${id}`, { cache: 'no-store' }).catch(() => null);
      return ((await res?.json().catch(() => ({}))) as { uploadStatus?: string } | undefined)?.uploadStatus;
    };
    const ready = () => expect.poll(status, { message: `"${title}" never became ready`, timeout: onLocalStack() ? 60000 : 9 * 60000, intervals: [1000, 2000, 5000] }).toBe('ready');
    if (onLocalStack()) await ready();
    else await untilEncoded(`"${title}"`, ready, async () => encoding(await status()));
  }

  async createPlaylist(user: WebUser, channelId: string, opts: { title?: string; videoIds?: string[]; isPublic?: boolean } = {}): Promise<string> {
    const body = (await ok(
      await apiFetch(user, '/api/playlists', json({ title: opts.title ?? `E2E playlist ${ns()}`, description: `Created by ${ns()}`, videos: opts.videoIds ?? [], isPublic: opts.isPublic ?? true }, channelId)),
      'POST /api/playlists',
    )) as { result?: { playlist?: { id?: string } } };
    const id = body.result?.playlist?.id;
    expect(id, 'playlist create returned no id').toBeTruthy();
    this.undo.push({ what: `playlist ${id}`, run: () => apiFetch(user, `/api/playlists/${id}`, { method: 'DELETE', headers: { channelId } }) });
    return id as string;
  }

  async createPost(user: WebUser, channelId: string, opts: { text?: string } = {}): Promise<string> {
    const body = (await ok(
      await apiFetch(user, `/api/community/channels/${channelId}/posts`, json({ type: 'text', content: opts.text ?? `E2E post ${ns()}`, visibility: 'public', commentsEnabled: true }, channelId)),
      'POST community post',
    )) as { result?: { post?: { id?: string } }; post?: { id?: string } };
    const id = body.result?.post?.id ?? body.post?.id;
    expect(id, 'post create returned no id').toBeTruthy();
    this.undo.push({ what: `post ${id}`, run: () => apiFetch(user, `/api/community/channels/${channelId}/posts/${id}`, { method: 'DELETE', headers: { channelId } }) });
    return id as string;
  }

  async createComment(user: WebUser, videoId: string, text = `E2E comment ${ns()}`): Promise<string> {
    const body = (await ok(await apiFetch(user, `/api/videos/${videoId}/comments`, json({ content: text })), 'POST comment')) as { result?: { comment?: { id?: string } }; comment?: { id?: string } };
    const id = body.result?.comment?.id ?? body.comment?.id;
    expect(id, 'comment create returned no id').toBeTruthy();
    this.undo.push({ what: `comment ${id}`, run: () => apiFetch(user, `/api/videos/${videoId}/comments/${id}`, { method: 'DELETE' }) });
    return id as string;
  }

  /**
   * A creator for UI specs: signs up, gets the Creator tier and `channels` channels (the first is
   * main), then signs in again so the web session lists those channels (channels made through the
   * API are not in the session the sign-up made; the app would rewrite it on the first page, in the
   * middle of the test). Runs in its own context, closed afterwards.
   */
  async createCreator(browser: Browser, prefix: string, opts: { channels?: number; locale?: Locale } = {}): Promise<Creator> {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const first = await this.createUser(page, prefix, opts.locale);
      await this.grantCreator(first);
      const channelIds: string[] = [];
      for (let i = 0; i < (opts.channels ?? 1); i++) {
        channelIds.push(await this.createChannel(first, { name: `E2E ${prefix} ${i + 1} ${ns()} ${Date.now().toString(36)}`, isMain: i === 0 }));
      }
      const user = await signInAgain(page, first.email, opts.locale);
      return { user, channelIds, state: await context.storageState() };
    } finally {
      await context.close();
    }
  }

  /**
   * Registers a cleanup step for something the spec made another way (through the UI, say), run
   * by cleanup() in the same newest-first order. Register it as soon as the id is known, or
   * register a sweep (e.g. "every playlist of this spec's channel") before the UI step runs.
   */
  onCleanup(what: string, run: () => Promise<Response | unknown>): void {
    this.undo.push({ what, run });
  }

  /**
   * Deletes everything this scope created, newest first, within CLEANUP_BUDGET_MS. Failures are
   * reported, never thrown; a step still running at the deadline is reported and left to the run
   * teardown, and so are the steps after it.
   */
  async cleanup(): Promise<void> {
    const deadline = Date.now() + CLEANUP_BUDGET_MS;
    for (const [user, refreshToken] of this.sessions) {
      if (Date.now() < deadline) this.sessions.set(user, await refreshUser(user, refreshToken));
    }
    for (const step of this.undo.reverse()) {
      const left = deadline - Date.now();
      if (left <= 0) {
        console.warn(`[builders] cleanup budget (${CLEANUP_BUDGET_MS / 1000} s) spent: ${step.what} left to the run teardown`);
        continue;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const overrun = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`still running after ${Math.round(left / 1000)} s, left to the run teardown`)), left);
      });
      try {
        const res = (await Promise.race([step.run(), overrun])) as Response | undefined;
        if (res && res.status >= 400 && res.status !== 404) console.warn(`[builders] cleanup of ${step.what} answered ${res.status}`);
      } catch (error) {
        console.warn(`[builders] cleanup of ${step.what} failed: ${(error as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    }
    this.undo = [];
    this.sessions.clear();
  }
}

/** A DataScope for this spec file, cleaned up after its tests (test.afterAll: also after a failure). */
export function useOwnData(test: typeof base): DataScope {
  const scope = new DataScope();
  test.afterAll(async () => scope.cleanup());
  return scope;
}

/**
 * The same as Playwright fixtures, torn down after use() whatever happened (pass, fail, timeout,
 * retry): `ownData` per test, `workerData` per worker.
 *
 *   import { test } from './builders';
 *   test('…', async ({ page, ownData }) => { const user = await ownData.createUser(page, 'x'); … });
 */
export const test = base.extend<{ ownData: DataScope }, { workerData: DataScope }>({
  // (the fixture callback is not React's use(): named `provide` for the hooks lint rule)
  // A fixture timeout gives the teardown its own time: cleanup never counts against the test's
  ownData: [
    async ({}, provide) => {
      const scope = new DataScope();
      try {
        await provide(scope);
      } finally {
        await scope.cleanup();
      }
    },
    { timeout: FIXTURE_TIMEOUT_MS },
  ],
  workerData: [
    async ({}, provide) => {
      const scope = new DataScope();
      try {
        await provide(scope);
      } finally {
        await scope.cleanup();
      }
    },
    { scope: 'worker', timeout: FIXTURE_TIMEOUT_MS },
  ],
});
