/**
 * Release gate for video delivery on R2 + the Cloudflare CDN (epic #687, #960;
 * docs/media-delivery/R2-DELIVERY-PLAN.md and RUNBOOK.md). Nothing else gates it:
 * player.spec.ts plays whatever the watch page serves, which is Bunny while the
 * delivery switch says so.
 *
 * A new run account uploads a short private clip on /upload. End to end:
 * - upload complete → api-videos queues a transcode (al-ummah-now-transcode-<env>)
 *   → apps/media's consumer runs the Containers transcode → its events land on
 *   the video record: the owner's upload-status shows r2 queued/transcoding →
 *   ready, with startedAt/readyAt and the renditions written (the queue path ran);
 * - the media Worker serves the signed /priv/ master playlist, a rendition
 *   playlist and its init and first segment from the media host (200, HLS and
 *   segment content types, x-media-cache from the Worker, CORS for players);
 * - a tampered token gets 403 from the Worker (private renditions are never
 *   served without a valid signature).
 *
 * E2E run accounts are never transcoded (container time), except one named
 * …-media-gate (api-videos lib/media/r2-delivery.ts): this spec's.
 * A slow transcode skips with #929; a failed one, or wrong output, fails.
 * Production has no R2 delivery yet: skipped there, and wherever upload-status
 * has no `r2` (no dual write). The video is deleted at the end (its R2 objects
 * with it).
 */
import * as path from 'path';
import { encoding, untilEncoded } from './encode';
import { test, expect, type Page } from '@playwright/test';
import { trackRunUploads } from './run-videos';
import { releaseEnv, target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { submitNewChannelInMenu } from './account-menu';
import { fetchRetry } from './net';

// Signs in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });
// Real Bunny uploads: no retry (a failed upload is reported, never uploaded again) and every
// upload recorded for the run's upload cap (run-videos.ts, release-e2e.yml)
test.describe.configure({ retries: 0 });
test.beforeEach(({ page }) => trackRunUploads(page));

// The 3 s sample: the least container time
const CLIP = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');
/** Bunny encodes first (the transcode reads Bunny's file), then the container starts and runs */
const R2_READY_TIMEOUT_MS = 10 * 60_000;
/** r2 is written when the upload completes; a little slack for the record to be read back */
const R2_PRESENT_TIMEOUT_MS = 60_000;

const MEDIA_HOST: Partial<Record<ReturnType<typeof releaseEnv>, string>> = {
  qa: 'media.qa.alummahnow.net',
  stage: 'media.stage.alummahnow.net',
};

const HLS_TYPE = /^application\/(vnd\.apple\.mpegurl|x-mpegurl)/i;
const SEGMENT_TYPE = /^(video\/(iso\.segment|mp4|mp2t)|audio\/mp4)/i;

interface R2View {
  status: 'queued' | 'transcoding' | 'ready' | 'failed';
  access: 'pub' | 'priv';
  rev: string;
  attempts: number;
  queuedAt: string;
  startedAt?: string;
  readyAt?: string;
  error?: string;
  renditions: string[];
  playUrl?: string;
}

async function createChannelInMenu(page: Page, user: WebUser, name: string): Promise<string> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, name);
  let channelId = '';
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/channels?limit=100');
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === name)?.id ?? '';
      return channelId;
    }, { message: 'the new channel is not in GET /api/channels', timeout: 30000 })
    .not.toBe('');
  return channelId;
}

/** The owner's upload status: Bunny's state and, where there is a dual write, the R2 side. */
async function uploadStatus(user: WebUser, id: string, channelId: string): Promise<{ status?: string; r2?: R2View }> {
  const res = await apiFetch(user, `/api/videos/${id}/upload-status`, { headers: { channelId } });
  const body = (await res.json().catch(() => ({}))) as { result?: { status?: string; r2?: R2View } };
  return body.result ?? {};
}

/** Every URI line of a playlist (tags and blanks skipped), plus URI="…" attributes (init segments). */
function playlistUris(text: string): string[] {
  const uris: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const attr = /URI="([^"]+)"/.exec(line);
      if (attr && /^#EXT-X-MAP/.test(line)) uris.push(attr[1]!);
      continue;
    }
    uris.push(line);
  }
  return uris;
}

async function fetchMedia(url: string, what: string, type: RegExp): Promise<Response> {
  const res = await fetchRetry(url);
  expect(res.status, `${what}: ${url.replace(/\/priv\/[^/]+\//, '/priv/<token>/')}`).toBe(200);
  expect(res.headers.get('content-type') ?? '', `${what} content type`).toMatch(type);
  // Served by the media Worker (the /priv/ route), with CORS for players on other origins
  expect(res.headers.get('x-media-cache') ?? '', `${what} comes through the media Worker`).toMatch(/^(HIT|MISS)$/);
  expect(res.headers.get('access-control-allow-origin'), `${what} CORS`).toBe('*');
  return res;
}

test.describe('Release: R2 delivery', () => {
  test('an upload is transcoded through the queue and its signed HLS is served by the media Worker', async ({ page }) => {
    const env = releaseEnv();
    const mediaHost = MEDIA_HOST[env] ?? '';
    test.skip(!mediaHost, `${env} has no media host (R2 delivery is not wired for this target)`);
    test.setTimeout(16 * 60_000);

    // …-media-gate: the one run account api-videos transcodes
    const user = await signUpOnWeb(page, 'media-gate');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);
    const channelId = await createChannelInMenu(page, user, `Release E2E media ${Date.now().toString(36)}`);

    await page.goto(`${target().web}/en/upload`);
    await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('upload-file-input').setInputFiles(CLIP);
    await expect(page.getByTestId('upload-details')).toBeVisible();
    const title = `Release E2E media ${Date.now().toString(36)}`;
    await page.getByTestId('upload-title-en').fill(title);
    // Private: renditions go to the private bucket and are served only through the Worker, signed
    await page.getByTestId('upload-is-public').uncheck();
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

      // The dual write queued a job when the upload completed
      let first: R2View | undefined;
      await expect
        .poll(async () => (first = (await uploadStatus(user, videoId, channelId)).r2)?.status ?? 'none', { timeout: R2_PRESENT_TIMEOUT_MS, intervals: [3_000] })
        .not.toBe('none')
        .catch(() => undefined);
      // QA, stage and production all deliver from R2 (#948, v2026.11.12.3). Only a PR run may skip here (its
      // target can predate a change); a release or main run fails, so a transcode switched off in the admin
      // Delivery settings (global_settings/ops/media-delivery.json) can never pass a release silently.
      const noR2 = `${env}: upload-status has no r2 for a new upload: no R2 transcode queued (Delivery settings "transcode" off, or api-videos predates #960)`;
      if (process.env.GITHUB_EVENT_NAME === 'pull_request') test.skip(!first, noR2);
      expect(first, noR2).toBeTruthy();
      expect(first!.access, 'a private upload is transcoded to the private prefix').toBe('priv');
      test.info().annotations.push({ type: 'r2-first-status', description: first!.status });

      // Queue → container → events → record. Still queued/transcoding at the deadline = slow (#929)
      let r2: R2View | undefined;
      await untilEncoded('the R2 transcode of the media clip',
        () => expect
          .poll(async () => (r2 = (await uploadStatus(user, videoId, channelId)).r2)?.status, {
            message: 'the R2 transcode did not finish (r2.status)',
            timeout: R2_READY_TIMEOUT_MS,
            intervals: [10_000],
          })
          .toMatch(/^(ready|failed)$/),
        async () => encoding((await uploadStatus(user, videoId, channelId)).r2?.status),
        'the R2 transcode (Containers)');
      expect(r2!.status, `the R2 transcode failed: ${r2!.error ?? 'no error recorded'}`).toBe('ready');

      // The queue path ran: the container reported started and ready, with what it wrote
      expect(r2!.startedAt, 'started event (the consumer picked the job up)').toBeTruthy();
      expect(r2!.readyAt, 'ready event').toBeTruthy();
      expect(Date.parse(r2!.readyAt!)).toBeGreaterThanOrEqual(Date.parse(r2!.startedAt!));
      expect(r2!.renditions.length, 'renditions written').toBeGreaterThan(0);
      const readyAfter = Math.round((Date.parse(r2!.readyAt!) - Date.parse(r2!.queuedAt)) / 1000);
      test.info().annotations.push({ type: 'r2-ready-after-queue', description: `${readyAfter}s (${r2!.renditions.join(', ')})` });
      process.stdout.write(`[media] R2 ready ${readyAfter}s after queueing: ${r2!.renditions.join(', ')}\n`);

      // Signed private master playlist on the media host
      const playUrl = r2!.playUrl ?? '';
      // Parsed, not a regex built from the host: scheme and host compared exactly, then the path's parts
      const play = new URL(playUrl);
      expect(`${play.protocol}//${play.host}`, 'the play URL is on the media host').toBe(`https://${mediaHost}`);
      const [, priv, token, playVideoId, playRev, file, ...rest] = play.pathname.split('/');
      expect(priv, 'a signed /priv/ play URL').toBe('priv');
      expect(token, 'the path token (expiry.signature)').toMatch(/^\d{10}\.[A-Za-z0-9_-]{32}$/);
      expect([playVideoId, playRev, file, rest.length], 'video id, revision and master playlist').toEqual([
        videoId,
        r2!.rev,
        'master.m3u8',
        0,
      ]);
      expect(play.search, 'no query on the signed play URL').toBe('');
      const master = await (await fetchMedia(playUrl, 'master playlist', HLS_TYPE)).text();
      expect(master.startsWith('#EXTM3U'), 'master playlist starts with #EXTM3U').toBe(true);
      expect(master, 'master playlist lists its renditions').toContain('#EXT-X-STREAM-INF');
      const variants = playlistUris(master).filter((u) => /\.m3u8(\?|$)/.test(u));
      expect(variants.length, 'rendition playlists in the master').toBeGreaterThan(0);

      // A rendition playlist and its first segments, resolved like a player does (token in the path)
      const variantUrl = new URL(variants[0]!, playUrl).toString();
      expect(variantUrl.startsWith(`https://${mediaHost}/priv/`), 'the rendition stays under the signed path').toBe(true);
      const media = await (await fetchMedia(variantUrl, 'rendition playlist', HLS_TYPE)).text();
      expect(media.startsWith('#EXTM3U'), 'rendition playlist starts with #EXTM3U').toBe(true);
      expect(media, 'rendition playlist has segments').toContain('#EXTINF');
      expect(media, 'a finished (VOD) playlist').toContain('#EXT-X-ENDLIST');
      const segments = playlistUris(media);
      expect(segments.length, 'segment URIs in the rendition playlist').toBeGreaterThan(0);
      for (const uri of segments.slice(0, 2)) {
        const res = await fetchMedia(new URL(uri, variantUrl).toString(), `segment ${uri}`, SEGMENT_TYPE);
        expect((await res.arrayBuffer()).byteLength, `segment ${uri} has bytes`).toBeGreaterThan(0);
      }

      // Without a valid signature the Worker refuses (never served from the private bucket)
      const tampered = playUrl.replace(/(\/priv\/\d{10}\.)([A-Za-z0-9_-])/, (_m, head: string, c: string) => `${head}${c === 'A' ? 'B' : 'A'}`);
      expect(tampered).not.toBe(playUrl);
      expect((await fetchRetry(tampered)).status, 'a tampered token is refused').toBe(403);
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
