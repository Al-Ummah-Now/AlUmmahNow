/**
 * Release regression: a signed-in watch is saved while it plays, with no pause.
 *
 * The 10s periodic save never started: CustomVideoPlayer re-renders with the
 * player only after video.js 'ready', when readyState is usually still 0, and
 * useWatchProgress then waited with player.one('ready'), an event that had
 * already fired. Pause/seek/ended still saved, so only watches that were never
 * paused (closed tab, navigation) were lost. Plays for real, so it runs in the
 * branded-Chrome "player" project.
 */
import { test, expect } from '@playwright/test';
import { findPlayableVideo, HISTORY_MIN_SECONDS, NO_PLAYABLE_VIDEO, playFor, watchUrl } from './videos';
import { apiFetch, createProfile, signUpOnWeb } from './web-session';

/** ResumePrompt's heading (lib/video/i18n translations, resume.title, en). */
const RESUME_TITLE = 'Continue watching?';

interface HistoryEntry {
  videoId: string;
  progress?: number;
}

test.describe('Release: periodic watch progress', () => {
  test('a signed-in watch is saved to history while it plays, without pausing', async ({ page }) => {
    const video = await findPlayableVideo(HISTORY_MIN_SECONDS);
    test.skip(!video, NO_PLAYABLE_VIDEO);

    const user = await signUpOnWeb(page, 'rel-history-tick');
    await createProfile(user);

    const calls: string[] = [];
    page.on('response', (res) => {
      const url = new URL(res.url());
      if (url.pathname === '/api/auth/token' || url.pathname.startsWith('/api/watch-history')) {
        calls.push(`${res.request().method()} ${url.host}${url.pathname} ${res.status()}`);
      }
    });

    await page.goto(watchUrl(video!.id));
    // Longer than the 10s save interval; the video is never paused or sought
    await playFor(page, 15);
    console.log(`[watch-history-periodic] calls while playing:\n  ${calls.join('\n  ') || '(none)'}`);

    const saves = calls.filter((c) => c.startsWith('POST') && /\/api\/watch-history/.test(c));
    expect(saves, `no watch-history save while playing; calls: ${calls.join(' | ')}`).not.toHaveLength(0);
    expect(saves.some((c) => / 20\d$/.test(c)), `no successful save: ${saves.join(' | ')}`).toBe(true);

    const res = await apiFetch(user, '/api/watch-history');
    expect(res.ok, `GET /api/watch-history ${res.status}`).toBe(true);
    const body = (await res.json()) as { entries?: HistoryEntry[] };
    const entry = (body.entries ?? []).find((e) => e.videoId === video!.id);
    expect(entry, 'the playing video is not in /api/watch-history').toBeTruthy();
    expect(entry!.progress ?? 0).toBeGreaterThan(5);
  });

  test('a signed-in watch offers to resume from the saved position (#242)', async ({ page }) => {
    const video = await findPlayableVideo(HISTORY_MIN_SECONDS);
    test.skip(!video, NO_PLAYABLE_VIDEO);

    const user = await signUpOnWeb(page, 'rel-resume');
    await createProfile(user);

    await page.goto(watchUrl(video!.id));
    await playFor(page, 2);
    // Seek to 30% (inside the 5-95% resume window for any length); 'seeked' saves
    const target = await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
      v.currentTime = Math.floor(v.duration * 0.3);
      return v.currentTime;
    });
    await expect
      .poll(async () => {
        const res = await apiFetch(user, `/api/watch-history/${video!.id}/progress`);
        return res.ok ? ((await res.json()) as { progress?: number }).progress ?? 0 : 0;
      }, { message: 'the seek position was never saved', timeout: 30000 })
      .toBeGreaterThan(target - 5);

    await page.reload();
    // The consent banner (also a dialog) can cover the prompt's buttons
    const reject = page.getByRole('button', { name: 'Reject all' });
    if (await reject.isVisible().catch(() => false)) await reject.click();
    // By name: the consent banner is a dialog too
    const dialog = page.getByRole('dialog', { name: RESUME_TITLE });
    await expect(dialog).toBeVisible({ timeout: 45000 });
    await dialog.getByRole('button', { name: /Resume from/ }).click();
    await expect
      .poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.currentTime ?? 0))
      .toBeGreaterThan(target - 5);
  });
});
