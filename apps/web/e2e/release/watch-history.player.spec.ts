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

interface HistoryEntry {
  videoId: string;
  videoTitle?: string;
}

test.describe('Release: watch history', () => {
  test('a signed-in watch is listed in the user\'s history', async ({ page }) => {
    const video = await findPlayableVideo(HISTORY_MIN_SECONDS);
    test.skip(!video, NO_PLAYABLE_VIDEO);

    const user = await signUpOnWeb(page, 'rel-history');
    await createProfile(user);

    await page.goto(watchUrl(video!.id));
    await playFor(page, 3);
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

    await page.goto(`${target().web}/en/history`);
    await expect(page.getByText(video!.title, { exact: false }).first()).toBeVisible({ timeout: 30000 });
  });
});
