/**
 * R2 backfill end to end (docs/media-delivery/BACKFILL.md), local stack only: a run account's upload is on
 * Bunny only (run accounts skip the upload transcode). A backfill of just that video is estimated from
 * its real size, gets a budget cap and starts; it copies our original from Bunny into R2 in checksummed
 * ranges when there is none, transcodes it (the stack's fake pipeline writes the rendition objects),
 * verifies it and marks it R2-ready. "Play R2 first" for that video puts R2 at the top of its sources, the
 * watch page plays it from the media host, and undo puts Bunny back first.
 *
 * Drives api-videos' internal backfill routes (the ones admin-api's Backfill page calls behind
 * media:manage and audit; their proxying is unit tested in admin-api). The run, the video's override and
 * the video are this spec's own: the override is undone and the video deleted afterwards.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { onLocalStack } from './builders';
import { playFor, watchUrl } from './videos';
import { CONTROL, MEDIA_HOST, createChannelInMenu, freshClip, internal } from './media-providers';

test.use({ trace: 'off', video: 'off' });

type View = { uploadStatus?: string; sources?: Array<{ provider: string; src: string }> };
type Run = { id: string; status: string; estimate: { videos: number; totalUsd: number; egressBytes: number } | null; counts: Record<string, number> };
type Item = { videoId: string; state: string; error: string | null; hasOriginal: boolean; copiedBytes: number; sourceBytes: number | null; checks: { original: { ok: boolean }; renditions: { ok: boolean; rungs?: string[] }; duration: { ok: boolean }; objects: { ok: boolean; checked?: number } } | null };

async function call<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await internal(`/backfill${pathname}`, init);
  const text = await res.text();
  expect(res.ok, `${init.method ?? 'GET'} /backfill${pathname}: ${res.status} ${text.slice(0, 300)}`).toBe(true);
  return (JSON.parse(text) as { result: T }).result;
}

test.describe('R2 backfill: copy, transcode, verify, play R2 first', () => {
  test.skip(!onLocalStack(), 'local stack only (fake Bunny CDN and fake transcode pipeline)');

  test('a one-video backfill verifies the copy; R2 first plays from the media host', async ({ page }) => {
    test.setTimeout(8 * 60_000);
    const user = await signUpOnWeb(page, 'rel-backfill');
    await createProfile(user);
    await grantCreatorTier(user);
    const channelId = await createChannelInMenu(page, user, `Release E2E backfill ${Date.now().toString(36)}`);
    const title = `Release E2E backfill ${Date.now().toString(36)}`;
    let videoId = '';
    let flipped = false;
    try {
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

      const view = async (): Promise<View> => {
        const res = await fetch(`${target().api}/api/videos/${videoId}`);
        if (!res.ok) return {};
        const body = (await res.json()) as { result?: View } & View;
        return body.result ?? body;
      };
      await expect.poll(async () => (await view()).uploadStatus, { message: 'Bunny makes it ready', timeout: 90000 }).toBe('ready');
      expect((await view()).sources?.map((s) => s.provider), 'Bunny only before the backfill').toEqual(['bunny']);

      // Estimate from real sizes: one video, a cost above zero
      let run = (await call<{ run: Run }>('/runs', { method: 'POST', body: JSON.stringify({ scope: { kind: 'videos', videoIds: [videoId], onlyMissing: true }, actorId: 'e2e-backfill' }) })).run;
      await expect
        .poll(async () => (run = (await call<{ run: Run }>(`/runs/${run.id}`)).run).status, { message: 'the estimate finishes', timeout: 90000 })
        .toBe('estimated');
      expect(run.estimate?.videos).toBe(1);
      expect(run.estimate!.totalUsd).toBeGreaterThan(0);

      // A cap from the estimate, then Start
      run = (await call<{ run: Run }>(`/runs/${run.id}/settings`, { method: 'PUT', body: JSON.stringify({ settings: { concurrency: 1, spacingSeconds: 0, budgetUsd: Math.max(1, Math.ceil(run.estimate!.totalUsd * 100) / 100) } }) })).run;
      run = (await call<{ run: Run }>(`/runs/${run.id}/start`, { method: 'POST', body: '{}' })).run;
      expect(run.status).toBe('running');

      // Copy (when there is no original of ours yet), then the transcode the fake pipeline finishes
      const item = async () => (await call<{ items: Item[] }>(`/runs/${run.id}/items`)).items.find((i) => i.videoId === videoId)!;
      await expect
        .poll(async () => { const i = await item(); return i.state === 'failed' ? `failed: ${i.error}` : i.state; }, { message: 'the copy finishes and the transcode is queued', timeout: 120000 })
        .toMatch(/^(transcoding|verifying|verified)$/);
      const transcoded = await fetch(`${CONTROL}/__fake/media/transcode/${videoId}`, { method: 'POST' });
      expect(transcoded.ok, `fake transcode: ${await transcoded.text()}`).toBe(true);
      await expect
        .poll(async () => { const i = await item(); return i.state === 'failed' ? `failed: ${i.error}` : i.state; }, { message: 'the copy is verified', timeout: 120000 })
        .toBe('verified');
      const done = await item();
      expect(done.checks?.original.ok && done.checks.renditions.ok && done.checks.duration.ok && done.checks.objects.ok, JSON.stringify(done.checks)).toBe(true);
      expect(done.checks!.objects.checked).toBeGreaterThan(3);
      if (!done.hasOriginal) expect(done.copiedBytes, 'our original was copied from Bunny').toBe(done.sourceBytes);
      await expect.poll(async () => (run = (await call<{ run: Run }>(`/runs/${run.id}`)).run).status, { message: 'the run is done', timeout: 60000 }).toBe('done');

      // Bunny still plays first until the flip (R2 is listed after it only where the playback order names R2)
      await expect.poll(async () => (await view()).sources?.[0]?.provider ?? '', { timeout: 30000 }).toBe('bunny');

      // Play R2 first for this video
      const flip = await call<{ flipped: string[]; refused: unknown[] }>('/flip', { method: 'POST', body: JSON.stringify({ target: 'videos', videoIds: [videoId], actorId: 'e2e-backfill' }) });
      expect(flip.flipped).toEqual([videoId]);
      flipped = true;
      let v: View = {};
      await expect.poll(async () => (v = await view()).sources?.map((s) => s.provider).join(',') ?? '', { message: 'R2 first', timeout: 30000 }).toBe('r2,bunny');
      expect(new URL(v.sources![0]!.src).host).toBe(MEDIA_HOST);

      const mediaRequests: number[] = [];
      page.on('response', (res) => {
        if (new URL(res.url()).host === MEDIA_HOST) mediaRequests.push(res.status());
      });
      await page.goto(watchUrl(videoId));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
      expect(await playFor(page, 2), 'plays').toBeGreaterThan(2);
      expect(mediaRequests.some((s) => s === 200), 'played from the media host').toBe(true);
      await expect(page.getByTestId('video-error')).toHaveCount(0);

      // Undo: Bunny first again
      expect((await call<{ flipped: string[] }>('/flip', { method: 'POST', body: JSON.stringify({ target: 'videos', videoIds: [videoId], undo: true, actorId: 'e2e-backfill' }) })).flipped).toEqual([videoId]);
      flipped = false;
      await expect.poll(async () => (await view()).sources?.[0]?.provider ?? '', { message: 'Bunny first again', timeout: 30000 }).toBe('bunny');
    } finally {
      if (videoId && flipped) await internal('/backfill/flip', { method: 'POST', body: JSON.stringify({ target: 'videos', videoIds: [videoId], undo: true, actorId: 'e2e-backfill' }) }).catch(() => undefined);
      if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
