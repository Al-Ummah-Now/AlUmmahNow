/**
 * Playback fallback across providers (docs/media-delivery/PROVIDERS.md §Playback), local stack only:
 * a video held by both Bunny and R2, on a channel whose override plays R2 first. The view lists both
 * sources, R2 first. With the media host down (the stack's fake media pipeline answers 503), the
 * watch page's player moves to Bunny by itself and plays, never showing an error; its QoE reports
 * (the live heartbeat once it plays) say it started on R2 and fell back to Bunny, with the failure's
 * class as the reason. With the media host up again it plays from R2.
 *
 * The transcoder Container and the media Worker are not in the stack: POST /__fake/media/transcode
 * sends the job events and the fake media host serves the player fixture. The channel override is
 * this spec's only and removed afterwards. The media host goes down for this spec's video only
 * (?video=), so specs running beside it keep theirs, and /__fake/media/up is always restored.
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { onLocalStack } from './builders';
import { playFor, watchUrl } from './videos';
import { CONTROL, MEDIA_HOST, createChannelInMenu, freshClip, internal, readSettings, removeChannelOverride, writeSettings } from './media-providers';

test.use({ trace: 'off', video: 'off' });

type View = { uploadStatus?: string; playUrl?: string; delivery?: { source?: string }; sources?: Array<{ provider: string; src: string }> };
type Qoe = { videoId?: string; requested?: string; actual?: string; fallback?: boolean; fallbackReason?: string; started?: boolean };

/**
 * Records the QoE reports the page sends for this video, in the page: a sendBeacon body is a Blob,
 * which Playwright's request events do not carry, so the reports never reached a request listener.
 */
async function recordQoe(page: Page, videoId: string): Promise<() => Promise<Qoe[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __qoe?: string[] };
    w.__qoe = [];
    const send = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      if (String(url).endsWith('/api/analytics/qoe') && data instanceof Blob) void data.text().then((t) => w.__qoe!.push(t));
      return send(url, data);
    };
  });
  return async () => {
    const raw = await page.evaluate(() => (window as unknown as { __qoe?: string[] }).__qoe ?? []).catch(() => [] as string[]);
    return raw.map((t) => JSON.parse(t) as Qoe).filter((r) => r.videoId === videoId);
  };
}

async function mediaHost(state: 'down' | 'up', videoId: string): Promise<void> {
  const res = await fetch(`${CONTROL}/__fake/media/${state}?video=${encodeURIComponent(videoId)}`, { method: 'POST' });
  expect(res.ok, `media host ${state}: ${res.status}`).toBe(true);
}

test.describe('Media providers: playback falls back to the next provider', () => {
  test.skip(!onLocalStack(), 'local stack only (its fake media pipeline can take the media host down)');

  test('R2 first; with the media host down the player moves to Bunny and plays, then R2 again', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const user = await signUpOnWeb(page, 'rel-fallback');
    await createProfile(user);
    await grantCreatorTier(user);
    const channelId = await createChannelInMenu(page, user, `Release E2E fallback ${Date.now().toString(36)}`);
    const title = `Release E2E fallback ${Date.now().toString(36)}`;

    const before = await readSettings();
    let videoId = '';
    try {
      // This channel only: uploads to both providers, plays R2 first
      await writeSettings({ ...before, channels: { ...(before.channels ?? {}), [channelId]: { ingest: ['bunny', 'r2'], strategy: 'priority', order: ['r2', 'bunny'], note: 'e2e fallback' } } });

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
        }, { message: "the owner's channel list has the upload", timeout: 60000 })
        .not.toBe('');

      // Bunny's copy turns ready (the fake encodes on its own)
      const view = async (): Promise<View> => {
        const res = await fetch(`${target().api}/api/videos/${videoId}`);
        if (!res.ok) return {};
        // GET /api/videos/:id answers the view itself (no result wrapper)
        const body = (await res.json()) as { result?: View } & View;
        return body.result ?? body;
      };
      await expect.poll(async () => (await view()).uploadStatus, { message: 'Bunny makes it ready', timeout: 90000 }).toBe('ready');

      // R2's copy: run accounts skip the upload transcode unless R2 is the only copy, so ask for it
      // the way the admin's "Transcode again" does, then let the fake pipeline finish it
      const queued = await internal('/retry', { method: 'POST', body: JSON.stringify({ ids: [videoId] }) });
      expect(queued.ok, `transcode again: ${queued.status}`).toBe(true);
      const transcoded = await fetch(`${CONTROL}/__fake/media/transcode/${videoId}`, { method: 'POST' });
      expect(transcoded.ok, `fake transcode: ${await transcoded.text()}`).toBe(true);

      let v: View = {};
      await expect
        .poll(async () => {
          v = await view();
          return v.sources?.map((s) => s.provider).join(',') ?? '';
        }, { message: 'both copies play, R2 first', timeout: 60000 })
        .toBe('r2,bunny');
      expect(new URL(v.sources![0]!.src).host).toBe(MEDIA_HOST);
      expect(v.delivery?.source).toBe('r2');

      // Media host down: the player starts on R2, gets a 503, moves to Bunny and plays
      await mediaHost('down', videoId);
      const qoe = await recordQoe(page, videoId);
      const mediaRequests: number[] = [];
      const bunnyPlaylists: string[] = [];
      page.on('response', (res) => {
        const host = new URL(res.url()).host;
        if (host === MEDIA_HOST) mediaRequests.push(res.status());
        if (host === new URL(v.sources![1]!.src).host && res.url().includes('.m3u8')) bunnyPlaylists.push(res.url());
      });
      await page.goto(watchUrl(videoId));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
      expect(await playFor(page, 2), 'plays after falling back').toBeGreaterThan(2);
      expect(mediaRequests, 'R2 was tried first').toContain(503);
      expect(bunnyPlaylists.length, 'then Bunny served the playlist').toBeGreaterThan(0);
      await expect(page.getByTestId('video-error')).toHaveCount(0);

      // The session's reports (the heartbeat once it plays): requested R2, ended on Bunny, and why.
      // A 503 master playlist reads as manifest_5xx when VHS exposes the status, else as network.
      // The fallback sends its own heartbeat at once; when play was already
      // requested it goes out before the first frame (honestly `started: false`).
      // The first-frame heartbeat that follows is the one that proves the
      // fallback played, so wait for a report that says both.
      const playedAfterFallback = (r: Qoe) => r.fallback === true && r.started === true;
      await expect.poll(async () => (await qoe()).some(playedAfterFallback), { message: 'a QoE report names the fallback and the first frame', timeout: 15000 }).toBe(true);
      const report = (await qoe()).filter(playedAfterFallback).at(-1)!;
      expect(report).toMatchObject({ requested: 'r2', actual: 'bunny', started: true });
      expect(['manifest_5xx', 'network']).toContain(report.fallbackReason);

      // Media host up: R2 plays again
      await mediaHost('up', videoId);
      const r2Playlists: number[] = [];
      page.on('response', (res) => {
        if (new URL(res.url()).host === MEDIA_HOST && res.url().includes('.m3u8')) r2Playlists.push(res.status());
      });
      await page.goto(watchUrl(videoId));
      expect(await playFor(page, 2)).toBeGreaterThan(2);
      expect(r2Playlists, 'R2 served the playlist').toContain(200);
    } finally {
      if (videoId) await mediaHost('up', videoId).catch(() => undefined);
      if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
      await removeChannelOverride(channelId);
    }
  });
});
