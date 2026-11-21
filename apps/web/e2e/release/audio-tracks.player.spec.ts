/**
 * Multiple audio tracks (wiki AUN-MULTI-AUDIO) end to end on a deployed target:
 * - a run account named …-media-gate (the one api-videos transcodes to R2) on the Unlimited tier
 *   uploads the 3 s clip and waits for its R2 rendition;
 * - it adds an English dub through the Studio API (POST audio-tracks, the file in a chunk, complete):
 *   the media container normalises it and writes the demuxed package (audio_track then
 *   audio_package jobs on the transcode queue);
 * - viewers get two tracks and the package master (master_a<n>.m3u8);
 * - on /en the dub plays first (the site's language); the player's Audio menu switches to the
 *   original and the player loads the original's audio rendition (a/orig/);
 * - deleting the track gives viewers the original alone again. The video is deleted at the end.
 *
 * Review is off on QA and stage (VIDEO_REVIEW_ALLOWED=false), so a track is audible once ready.
 * A slow encode or transcode skips with #929. Skipped where there is no media host (production,
 * local stack: no container) and while the target's API predates the audio tracks routes.
 */
import * as path from 'path';
import * as fs from 'fs';
import { test, expect, type Page } from '@playwright/test';
import { encoding, untilEncoded } from './encode';
import { trackRunUploads } from './run-videos';
import { providerAttempts } from './provider-retry';
import { releaseEnv, target } from './targets';
import { apiFetch, contextAccessToken, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { ownerUploadStatus } from './builders';
import { setCreatorTier } from './creator-tier';
import { submitNewChannelInMenu } from './account-menu';
import { watchUrl } from './videos';

test.use({ trace: 'off' });
test.describe.configure({ retries: 0 });
test.beforeEach(({ page }) => trackRunUploads(page));

const CLIP = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');
const TONE = path.join(__dirname, '..', 'test-fixtures', 'e2e-audio-tone.m4a');
const MEDIA_HOSTS = ['media.qa.alummahnow.net', 'media.stage.alummahnow.net'];
const R2_READY_TIMEOUT_MS = 10 * 60_000;
const TRACK_READY_TIMEOUT_MS = 6 * 60_000;

interface StudioTrack { id: string; state: string; source: string; language: string; isDefault: boolean }
interface StudioView { tracks: StudioTrack[]; package: { status: string; playing: boolean }; ready: boolean }
interface PublicView { uploadStatus?: string; playUrl?: string; audioTracks?: Array<{ id: string; language: string; kind: string; label: string }> }

async function createChannel(page: Page, user: WebUser, name: string): Promise<string> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, name);
  let channelId = '';
  await expect
    .poll(async () => {
      const body = (await (await apiFetch(user, '/api/channels?limit=100')).json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === name)?.id ?? '';
      return channelId;
    }, { message: 'the new channel is not in GET /api/channels', timeout: 30000 })
    .not.toBe('');
  return channelId;
}

async function studio(user: WebUser, videoId: string, channelId: string): Promise<{ status: number; view?: StudioView }> {
  const res = await apiFetch(user, `/api/videos/${videoId}/audio-tracks`, { headers: { channelId } });
  const body = (await res.json().catch(() => ({}))) as { data?: StudioView };
  return { status: res.status, view: body.data };
}

async function publicView(videoId: string): Promise<PublicView> {
  const res = await fetch(`${target().api}/api/videos/${videoId}`, { cache: 'no-store' });
  const body = res.ok ? ((await res.json()) as { result?: PublicView } & PublicView) : null;
  return body ? body.result ?? body : {};
}

/** Every audio rendition playlist the page requested (…/a/<trackId>/index.m3u8). */
function audioRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const m = /\/a\/(orig|t[a-z0-9]{6,24})\/index\.m3u8/.exec(r.url());
    if (m) seen.push(m[1]!);
  });
  return seen;
}

test.describe('Release: multiple audio tracks', () => {
  test('a dub added in Studio is packaged, plays first in its language and switches in the Audio menu', async ({ browser }, testInfo) =>
    providerAttempts(browser, testInfo, { perAttemptMs: 22 * 60_000 }, async ({ page }) => {
      const env = releaseEnv();
      test.skip(env !== 'qa' && env !== 'stage', `${env} has no media container (R2 delivery and packaging run on QA and stage)`);

      const user = await signUpOnWeb(page, 'audio-media-gate');
      await createProfile(user);
      // Extra audio tracks are a tier entitlement (0 on Creator): the Unlimited tier allows them
      await setCreatorTier(user, 'unlimited');
      const channelId = await createChannel(page, user, `Release E2E audio ${Date.now().toString(36)}`);

      await page.goto(`${target().web}/en/upload`);
      await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('upload-file-input').setInputFiles(CLIP);
      await expect(page.getByTestId('upload-details')).toBeVisible();
      const title = `Release E2E audio ${Date.now().toString(36)}`;
      await page.getByTestId('upload-title-en').fill(title);
      await page.getByTestId('upload-submit').click();
      await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });
      await page.goto('about:blank');

      let videoId = '';
      try {
        await expect
          .poll(async () => {
            const res = await apiFetch(user, `/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
            const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> };
            videoId = body.data?.find((v) => v.title === title)?.id ?? '';
            return videoId;
          }, { message: 'the upload is not in the owner\'s video search', timeout: 60000 })
          .not.toBe('');

        const first = await studio(user, videoId, channelId);
        test.skip(first.status === 404 && !first.view, `${env}: the API predates the audio tracks routes`);
        expect(first.status, 'GET audio-tracks').toBe(200);

        // The rendition first (Bunny encode, then the R2 transcode): tracks can be added once it is ready
        await untilEncoded('the video and its R2 rendition',
          () => expect.poll(async () => (await studio(user, videoId, channelId)).view?.ready ?? false, { message: 'the video never became ready for tracks', timeout: R2_READY_TIMEOUT_MS, intervals: [10_000] }).toBe(true),
          // Not ready yet is 404 to anyone but the owner (#1241): ask as the owner, with a fresh token
          async () => encoding((await publicView(videoId)).uploadStatus ?? (await ownerUploadStatus(videoId, { accessToken: (await contextAccessToken(page.context())) ?? user.accessToken }))),
          'the encode and R2 transcode');

        // Add the English dub and send its file (one chunk) the way Studio does
        const bytes = fs.readFileSync(TONE);
        const added = await apiFetch(user, `/api/videos/${videoId}/audio-tracks`, {
          method: 'POST',
          headers: { channelId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: 'en', kind: 'dub', label: 'English', originalLanguage: 'ar', source: { type: 'upload', bytes: bytes.length, fileName: 'e2e-audio-tone.m4a', contentType: 'audio/mp4' } }),
        });
        const addedBody = (await added.json().catch(() => ({}))) as { data?: { track?: StudioTrack }; error?: string };
        expect(added.status, `add the track: ${addedBody.error ?? ''}`).toBe(201);
        const trackId = addedBody.data!.track!.id;
        const chunk = await apiFetch(user, `/api/videos/${videoId}/audio-tracks/${trackId}/upload?offset=0`, { method: 'PUT', headers: { channelId, 'Content-Type': 'application/octet-stream' }, body: bytes });
        expect(chunk.status, 'the chunk is stored').toBe(200);
        const done = await apiFetch(user, `/api/videos/${videoId}/audio-tracks/${trackId}/complete`, { method: 'POST', headers: { channelId } });
        expect(done.status, 'processing starts').toBe(202);

        // Normalised, then packaged with the original: viewers hear both
        let view: StudioView | undefined;
        await untilEncoded('the dub and the audio package',
          () => expect
            .poll(async () => {
              view = (await studio(user, videoId, channelId)).view;
              const t = view?.tracks.find((x) => x.id === trackId);
              return t?.state === 'failed' || view?.package.status === 'failed' ? 'failed' : t?.state === 'ready' && view?.package.playing ? 'playing' : `${t?.state}/${view?.package.status}`;
            }, { message: 'the dub never played (track state / package status)', timeout: TRACK_READY_TIMEOUT_MS, intervals: [10_000] })
            .toMatch(/^(playing|failed)$/),
          async () => true,
          'the audio track and package jobs (Containers)');
        expect(view!.tracks.find((x) => x.id === trackId)!.state, 'the dub was prepared').toBe('ready');
        expect(view!.package.status, 'the package was written').toBe('ready');

        const pub = await publicView(videoId);
        expect(pub.audioTracks?.map((t) => [t.id, t.language, t.kind]), 'viewers get both tracks, the original first').toEqual([
          ['orig', 'ar', 'original'],
          [trackId, 'en', 'dub'],
        ]);
        const play = new URL(pub.playUrl!);
        expect(MEDIA_HOSTS).toContain(play.host);
        expect(play.pathname, 'the package master').toMatch(/\/master_a\d+\.m3u8$/);
        const master = await (await fetch(pub.playUrl!)).text();
        expect(master).toContain('#EXT-X-MEDIA:TYPE=AUDIO');
        expect(master).toContain(`URI="a/${trackId}/index.m3u8"`);
        expect(master).toContain('URI="a/orig/index.m3u8"');

        // The watch page in English: the dub first (site language), then the original from the menu
        const requested = audioRequests(page);
        await page.goto(watchUrl(videoId, 'en'));
        await page.waitForSelector('.video-js video', { timeout: 45000 });
        await page.evaluate(async () => {
          const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
          v.muted = true;
          await v.play().catch(() => undefined);
        });
        await expect.poll(() => requested.includes(trackId), { message: 'the English dub is loaded first on /en', timeout: 30000 }).toBe(true);
        await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.currentTime), { timeout: 30000 }).toBeGreaterThan(1);

        await page.locator('.video-js .vjs-fanous-settings').click();
        const menu = page.getByTestId('player-settings-menu');
        await expect(menu).toBeVisible();
        await menu.locator('[data-row="audio"]').click();
        const options = menu.getByRole('menuitemradio');
        await expect(options).toHaveCount(2);
        await expect(options.nth(1), 'the dub is the current track').toHaveAttribute('aria-checked', 'true');
        await expect(options.nth(1)).toHaveAttribute('lang', 'en');
        await options.nth(0).click();
        await expect.poll(() => requested.includes('orig'), { message: 'switching loads the original audio rendition', timeout: 30000 }).toBe(true);
        const t0 = await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.currentTime);
        await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.currentTime), { message: 'it keeps playing after the switch', timeout: 30000 }).not.toBe(t0);

        // Deleting the dub: the original alone again
        const removed = await apiFetch(user, `/api/videos/${videoId}/audio-tracks/${trackId}`, { method: 'DELETE', headers: { channelId } });
        expect(removed.status, 'delete the track').toBe(200);
        await expect.poll(async () => (await publicView(videoId)).audioTracks ?? [], { message: 'viewers no longer get the dub', timeout: 60000 }).toEqual([]);
        expect(new URL((await publicView(videoId)).playUrl!).pathname).not.toMatch(/master_a\d+\.m3u8$/);
      } finally {
        if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
      }
    }));
});
