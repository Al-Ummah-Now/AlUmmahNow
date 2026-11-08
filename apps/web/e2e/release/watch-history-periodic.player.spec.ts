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
import { findPlayableVideo, NO_PLAYABLE_VIDEO, playFor, watchUrl } from './videos';
import { apiFetch, createProfile, signUpOnWeb } from './web-session';

interface HistoryEntry {
  videoId: string;
  progress?: number;
}

test.describe('Release: periodic watch progress', () => {
  test('a signed-in watch is saved to history while it plays, without pausing', async ({ page }) => {
    const video = await findPlayableVideo(20);
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
});
