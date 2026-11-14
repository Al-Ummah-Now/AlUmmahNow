/**
 * Media providers (docs/media-delivery/PROVIDERS.md §Ingest): with Bunny off for a channel's uploads,
 * an upload on /upload goes to our own TUS target (the originals bucket), the R2 transcode makes it
 * ready and published, and the watch page plays it from the media host. Bunny never hears of it.
 *
 * Local stack only: the transcoder Container and the media Worker are not in the stack, so the stack's
 * fake media pipeline (scripts/local-stack/fake-external.ts, POST /__fake/media/transcode/<id>) sends
 * the job events a real transcode sends and serves the player fixture on media.local-stack.test.
 * The real transcode and /priv/ edge are covered on stage by media-delivery.spec.ts.
 *
 * The R2-only rule is this spec's channel override only (the rest of the stack keeps the defaults),
 * set through the same internal route admin-api's Delivery settings call, and removed afterwards.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { submitNewChannelInMenu } from './account-menu';
import { onLocalStack } from './builders';
import { playFor, watchUrl } from './videos';

test.use({ trace: 'off', video: 'off' });

const CLIP = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');
const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
/** The local stack's internal key (scripts/local-stack/stack.ts LOCAL_SECRETS): never a deployed value */
const LOCAL_INTERNAL_KEY = 'local-stack-internal-key';
const MEDIA_HOST = 'media.local-stack.test';

function freshClip(): string {
  const file = path.join(os.tmpdir(), `e2e-r2-only-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.mp4`);
  fs.copyFileSync(CLIP, file);
  return file;
}

async function internal(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${target().api}/internal/media${pathname}`, { ...init, headers: { 'content-type': 'application/json', 'X-API-Key': LOCAL_INTERNAL_KEY, ...(init.headers ?? {}) } });
}

type Settings = { channels?: Record<string, unknown> } & Record<string, unknown>;

async function readSettings(): Promise<Settings> {
  const res = await internal('/providers');
  expect(res.ok, `GET providers: ${res.status}`).toBe(true);
  return ((await res.json()) as { settings: Settings }).settings;
}

async function writeSettings(settings: Settings): Promise<void> {
  const res = await internal('/providers', { method: 'PUT', body: JSON.stringify({ settings, actorId: 'e2e-r2-only' }) });
  expect(res.ok, `PUT providers: ${res.status} ${await res.text()}`).toBe(true);
}

async function createChannelInMenu(page: Page, user: WebUser, name: string): Promise<string> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, name);
  let channelId = '';
  await expect
    .poll(async () => {
      const body = (await (await apiFetch(user, '/api/channels?limit=100')).json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === name)?.id ?? '';
      return channelId;
    }, { timeout: 30000 })
    .not.toBe('');
  return channelId;
}

test.describe('Media providers: an R2-only upload', () => {
  test.skip(!onLocalStack(), 'local stack only (its fake media pipeline); stage runs the real transcode in media-delivery.spec.ts');

  test('uploads through our own target, turns ready and published from the R2 transcode, and plays from R2', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const user = await signUpOnWeb(page, 'rel-r2-only');
    await createProfile(user);
    await grantCreatorTier(user);
    const channelId = await createChannelInMenu(page, user, `Release E2E R2 only ${Date.now().toString(36)}`);
    const title = `Release E2E R2 only ${Date.now().toString(36)}`;

    const before = await readSettings();
    let videoId = '';
    try {
      // This channel only: uploads to R2 alone, played from R2 first
      await writeSettings({ ...before, channels: { ...(before.channels ?? {}), [channelId]: { ingest: ['r2'], strategy: 'priority', order: ['r2', 'bunny'], note: 'e2e r2-only' } } });

      await page.goto(`${target().web}/en/upload?channel=${encodeURIComponent(channelId)}`);
      await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('upload-file-input').setInputFiles(freshClip());
      await expect(page.getByTestId('upload-details')).toBeVisible();
      await page.getByTestId('upload-title-en').fill(title);
      await page.getByTestId('upload-submit').click();
      await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });

      await expect
        .poll(async () => {
          const body = (await (await apiFetch(user, `/api/channels/${channelId}/videos?limit=100`)).json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> };
          videoId = body.data?.find((v) => v.title === title)?.id ?? '';
          return videoId;
        }, { message: 'the owner\'s channel list has the upload', timeout: 60000 })
        .not.toBe('');

      // Bunny never got a video for it
      const fakeBunny = (await (await fetch(`${CONTROL}/__fake/bunny/videos`)).json()) as Array<{ title: string }>;
      expect(fakeBunny.filter((v) => v.title.includes(title)), 'no Bunny video for an R2-only upload').toEqual([]);

      // Not visible to a visitor before it is ready
      expect((await fetch(`${target().api}/api/videos/${videoId}`)).status, 'a visitor cannot open it before it is ready').not.toBe(200);

      // The R2 transcode (the stack's fake pipeline sends the job events)
      const transcoded = await fetch(`${CONTROL}/__fake/media/transcode/${videoId}`, { method: 'POST' });
      expect(transcoded.ok, `fake transcode: ${await transcoded.text()}`).toBe(true);

      // Ready and published, playable from R2, with R2's own frame
      let view: { uploadStatus?: string; playUrl?: string; thumbnailUrl?: string; delivery?: { source?: string }; sources?: Array<{ provider: string; src: string }> } = {};
      await expect
        .poll(async () => {
          const res = await fetch(`${target().api}/api/videos/${videoId}`);
          view = res.ok ? ((await res.json()) as { result?: typeof view }).result ?? {} : {};
          return view.uploadStatus ?? `HTTP ${res.status}`;
        }, { message: 'the video turns ready for a visitor', timeout: 60000 })
        .toBe('ready');
      expect(view.delivery?.source).toBe('r2');
      expect(view.sources?.map((s) => s.provider)).toEqual(['r2']);
      expect(new URL(view.playUrl!).host).toBe(MEDIA_HOST);
      expect(new URL(view.thumbnailUrl!).host).toBe(MEDIA_HOST);
      // Our API only: no provider internals in the view
      for (const field of ['r2', 'media', 'bunnyLibraryId', 'tusUpload']) expect(view, field).not.toHaveProperty(field);

      await page.goto(watchUrl(videoId));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
      expect(await playFor(page, 2)).toBeGreaterThan(2);
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
      const now = await readSettings();
      const { [channelId]: _mine, ...others } = (now.channels ?? {}) as Record<string, unknown>;
      await writeSettings({ ...now, channels: others });
    }
  });
});
