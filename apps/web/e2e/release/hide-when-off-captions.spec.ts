/**
 * Hidden when off: caption minutes and extra audio tracks in the video editor (wiki "Product rules
 * → Hidden when off", HIDE-V PR3). Both come with the channel owner's plan: the Unlimited tier has
 * them, the Creator tier leaves them out. Off, Transcribe and "Add audio track" are not rendered at
 * all (no "your plan doesn't include", no contact link), and their APIs answer 404 feature_off.
 *
 * Own data: a run account, its channel and one video record (no upload), deleted afterwards. Each
 * part skips where this stack has it unconfigured for everyone (unit tests cover that).
 */
import { expect, test, type Page } from '@playwright/test';
import { switchCreatorTier } from './creator-tier';
import { skipUntilStudioDeployed, studioDraftRecord, studioOwner } from './studio';
import { target } from './targets';
import { apiFetch, type WebUser } from './web-session';

test.use({ trace: 'off', video: 'off' });

type Flags = { captionsTranscribe: boolean; audioTracks: boolean };

async function flags(user: WebUser, channelId: string): Promise<Flags> {
  const res = await apiFetch(user, `/api/me/features?channelId=${encodeURIComponent(channelId)}`);
  expect(res.status, 'GET /api/me/features').toBe(200);
  const f = ((await res.json()) as { features?: Partial<Flags> }).features ?? {};
  return { captionsTranscribe: f.captionsTranscribe === true, audioTracks: f.audioTracks === true };
}

async function openEditor(page: Page, channelId: string, videoId: string, locale: 'en' | 'ar'): Promise<void> {
  // The editor asks for the video's audio tracks whether or not Add is on: once that has answered
  // (and the features with it), what is not rendered stays that way
  const tracks = page.waitForResponse((res) => res.request().method() === 'GET' && /\/audio-tracks(\?|$)/.test(res.url()), { timeout: 30000 });
  await page.goto(`${target().web}/${locale}/studio/${channelId}/content/videos/${videoId}/edit`);
  await tracks;
  await page.waitForLoadState('load');
}

test.describe('Release: hidden when off, captions and audio tracks', () => {
  test.beforeEach(skipUntilStudioDeployed);

  let owner: WebUser | null = null;
  let channel: string | null = null;
  let video: string | null = null;
  test.afterEach(async () => {
    if (owner && channel && video) await apiFetch(owner, `/api/videos/${video}`, { method: 'DELETE', headers: { channelId: channel } }).catch(() => undefined);
    owner = channel = video = null;
  });

  test('Transcribe and Add audio track follow the plan: on with Unlimited, gone with Creator', async ({ page }) => {
    await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    const { user, channelId } = await studioOwner(page, 'rel-hide-captions');
    owner = user;
    channel = channelId;
    video = await studioDraftRecord(user, channelId, `Hidden when off ${Date.now().toString(36)}`);

    await switchCreatorTier(user, 'unlimited');
    const on = await flags(user, channelId);
    test.skip(!on.captionsTranscribe && !on.audioTracks, 'Transcription and audio tracks are unconfigured on this stack');

    await openEditor(page, channelId, video, 'en');
    if (on.captionsTranscribe) await expect(page.getByTestId('caption-transcribe')).toBeVisible({ timeout: 30000 });
    if (on.audioTracks) await expect(page.getByTestId('audio-track-add')).toBeVisible({ timeout: 30000 });

    await switchCreatorTier(user, 'creator');
    await expect.poll(() => flags(user, channelId), { message: 'features off with the Creator tier', timeout: 30000 }).toEqual({ captionsTranscribe: false, audioTracks: false });

    for (const locale of ['en', 'ar'] as const) {
      await openEditor(page, channelId, video, locale);
      await expect(page.getByTestId('caption-transcribe')).toHaveCount(0);
      await expect(page.getByTestId('caption-minutes-short')).toHaveCount(0);
      await expect(page.getByTestId('audio-track-add')).toHaveCount(0);
      await expect(page.getByTestId('audio-tracks')).toHaveCount(0);
      await expect(page.locator('main a[href$="/contact"], main a[href*="/upgrade"]')).toHaveCount(0);
    }

    // The APIs say the same, with no message for a person
    if (on.captionsTranscribe) {
      const job = await apiFetch(user, `/api/videos/${video}/captions/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'ar' }) });
      expect(job.status, 'starting a transcription with the Creator tier').toBe(404);
      // The error envelope (FEAT-3): code, the switched-off feature and a message for a person
      const off = await job.json();
      expect(off).toMatchObject({ success: false, code: 'feature_off', feature: 'captionsTranscribe', action: 'none' });
      expect(typeof off.message === 'string' && off.message.length > 0).toBe(true);
    }
    if (on.audioTracks) {
      const track = await apiFetch(user, `/api/videos/${video}/audio-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'en', label: 'English', kind: 'dub', source: { type: 'upload', bytes: 5, fileName: 'en.mp3' } }),
      });
      expect(track.status, 'adding an audio track with the Creator tier').toBe(404);
      expect(((await track.json()) as { code?: string }).code).toBe('feature_off');
    }

    // On again
    await switchCreatorTier(user, 'unlimited');
    await expect.poll(() => flags(user, channelId), { timeout: 30000 }).toEqual(on);
    await openEditor(page, channelId, video, 'ar');
    if (on.captionsTranscribe) await expect(page.getByTestId('caption-transcribe')).toBeVisible({ timeout: 30000 });
    if (on.audioTracks) await expect(page.getByTestId('audio-track-add')).toBeVisible({ timeout: 30000 });
  });
});
