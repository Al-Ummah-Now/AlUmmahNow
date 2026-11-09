/**
 * Release regression: a signed-in user's watch reaches their watch history
 * (#234: the player only saved progress when an authToken prop was passed, so
 * every signed-in watch went to device storage and the history stayed empty).
 * Plays for real, so it runs in the branded-Chrome "player" project.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { findPlayableVideo, HISTORY_MIN_SECONDS, NO_PLAYABLE_VIDEO, pause, playFor, watchUrl } from './videos';
import { apiFetch, createProfile, signUpOnWeb } from './web-session';

// This file signs users in through the auth server: its traces would hold the
// typed password and email code (fillSecret args, form POST bodies). Trace off.
test.use({ trace: 'off' });

interface HistoryEntry {
  videoId: string;
  videoTitle?: string;
  channelName?: string;
}

/** The channel's display name, or null for a video without a (still existing) channel. */
async function channelName(channelId: string | undefined): Promise<string | null> {
  if (!channelId) return null;
  const res = await fetch(`${target().api}/api/channels/${encodeURIComponent(channelId)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: { name?: string }; name?: string };
  return (body.result ?? body).name || null;
}

test.describe('Release: watch history', () => {
  test('a signed-in watch is listed in the user\'s history', async ({ page }) => {
    const video = await findPlayableVideo(HISTORY_MIN_SECONDS);
    test.skip(!video, NO_PLAYABLE_VIDEO);

    const user = await signUpOnWeb(page, 'rel-history');
    await createProfile(user);

    await page.goto(watchUrl(video!.id));
    // Nothing is saved before 10s of real playback (#242, RESUME_MIN_WATCHED_SECONDS)
    await playFor(page, 12);
    // Pausing saves the progress right away (otherwise every 10s)
    await pause(page);

    await expect
      .poll(
        async () => {
          const res = await apiFetch(user, '/api/watch-history');
          if (!res.ok) return `GET /api/watch-history ${res.status}`;
          const body = (await res.json()) as { entries?: HistoryEntry[] };
          return (body.entries ?? []).map((e) => e.videoId);
        },
        { message: 'the watched video never reached /api/watch-history', timeout: 30000 },
      )
      .toContain(video!.id);

    // #294: channel uploads carry only channelId; the entry must name the channel
    const expectedChannel = await channelName(video!.channelId);
    if (expectedChannel) {
      const res = await apiFetch(user, '/api/watch-history');
      const entry = ((await res.json()) as { entries?: HistoryEntry[] }).entries?.find((e) => e.videoId === video!.id);
      expect(entry?.channelName, 'history entry channel name (#294)').toBe(expectedChannel);
    }

    await page.goto(`${target().web}/en/history`);
    await expect(page.getByText(video!.title, { exact: false }).first()).toBeVisible({ timeout: 30000 });

    // Continue watching shows the picture: a loaded image can still sit in a
    // zero-height box (aspect-video produces no CSS), so the rendered size counts.
    await page.goto(`${target().web}/en`);
    const tile = page.locator(`[data-testid="continue-watching-video"][data-video-id="${video!.id}"]`);
    await expect(tile).toBeVisible({ timeout: 30000 });
    await tile.scrollIntoViewIfNeeded();
    await expect
      .poll(
        () =>
          tile.evaluate((a) => {
            const img = a.querySelector('img');
            const picture = img ?? a.querySelector('[data-testid="video-thumbnail-placeholder"]');
            if (!picture) return 'no thumbnail element';
            const { width, height } = picture.getBoundingClientRect();
            if (width === 0 || height === 0) return `collapsed thumbnail box ${width}x${height}`;
            if (!img) return 'placeholder';
            return img.complete && img.naturalWidth > 0 ? 'loaded' : `image did not load: ${img.currentSrc}`;
          }),
        { message: 'Continue watching tile shows its thumbnail', timeout: 20000 },
      )
      .toBe(video!.thumbnailUrl ? 'loaded' : 'placeholder');
  });
});
