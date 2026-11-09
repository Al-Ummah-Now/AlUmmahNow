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
import type { Page } from '@playwright/test';
import { findPlayableVideo, HISTORY_MIN_SECONDS, NO_PLAYABLE_VIDEO, pause, playFor, RESUME_MIN_VIDEO_SECONDS, watchUrl } from './videos';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';

// This file signs users in through the auth server: its traces would hold the
// typed password and email code (fillSecret args, form POST bodies). Trace off.
test.use({ trace: 'off' });

/** Saved resume position for the user, 0 when nothing is stored. */
async function savedProgress(user: WebUser, videoId: string): Promise<number> {
  const res = await apiFetch(user, `/api/watch-history/${videoId}/progress`);
  return res.ok ? ((await res.json()) as { progress?: number }).progress ?? 0 : 0;
}

function videoTime(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.currentTime ?? 0);
}

/**
 * Whether the target serves the #242 player: its resume live region
 * (data-testid="player-resume-announcement") is rendered on every watch page,
 * played or not, and the old prompt build has no such element.
 */
async function resumeUiDeployed(page: Page, videoId: string): Promise<boolean> {
  await page.goto(watchUrl(videoId));
  await page.waitForSelector('.video-js', { timeout: 45000 });
  return (await page.getByTestId('player-resume-announcement').count()) > 0;
}

/**
 * PR runs target QA, which still runs main until the PR merges: skip there
 * when the new player is not deployed yet. Stage (release) runs deploy the
 * candidate first and are not pull_request events, so they never skip.
 */
async function skipIfResumeUiNotDeployedOnPr(page: Page, videoId: string): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request' || process.env.E2E_ENV === 'stage') return;
  test.skip(
    !(await resumeUiDeployed(page, videoId)),
    'the #242 resume player (Start from beginning) is not deployed on the target yet (it lands with the PR that adds it)'
  );
}

/** The consent banner can cover the player controls. */
async function dismissConsent(page: Page): Promise<void> {
  const reject = page.getByRole('button', { name: 'Reject all' });
  if (await reject.isVisible().catch(() => false)) await reject.click();
}

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
    // Two 10s save intervals: the first tick can land before the 10s of real
    // playback a save needs (#242); the video is never paused or sought
    await playFor(page, 22);
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

  test('a watched video reopens at the saved time with Start from beginning (#242)', async ({ page }) => {
    const video = await findPlayableVideo(RESUME_MIN_VIDEO_SECONDS);
    test.skip(!video, NO_PLAYABLE_VIDEO);
    await skipIfResumeUiNotDeployedOnPr(page, video!.id);

    const user = await signUpOnWeb(page, 'rel-resume');
    await createProfile(user);

    await page.goto(watchUrl(video!.id));
    // Past the 10s of real playback that a resume point needs; pausing saves
    const played = await playFor(page, 13);
    await pause(page);
    await expect
      .poll(() => savedProgress(user, video!.id), { message: 'the watched position was never saved', timeout: 30000 })
      .toBeGreaterThan(played - 3);
    const saved = await savedProgress(user, video!.id);

    await page.reload();
    await dismissConsent(page);
    // Opens already at the saved time: no dialog, a persistent pill on the player
    const startOver = page.getByTestId('player-start-over');
    await expect(startOver).toBeVisible({ timeout: 45000 });
    await expect(startOver).toHaveAccessibleName('Start from beginning');
    await expect(page.getByRole('dialog', { name: /continue watching/i })).toHaveCount(0);
    await expect.poll(() => videoTime(page)).toBeGreaterThan(saved - 2);
    expect(await videoTime(page)).toBeLessThan(saved + 2);
    await expect(page.getByTestId('player-resume-announcement')).toContainText('Resuming at');
    // Nothing hides it on a timer
    await page.waitForTimeout(5000);
    await expect(startOver).toBeVisible();

    await startOver.click();
    await expect.poll(() => videoTime(page)).toBeLessThan(1);
    await expect(startOver).toBeHidden();
  });

  test('a video that was opened but never played has no Start from beginning (#242)', async ({ page }) => {
    const video = await findPlayableVideo(RESUME_MIN_VIDEO_SECONDS);
    test.skip(!video, NO_PLAYABLE_VIDEO);
    await skipIfResumeUiNotDeployedOnPr(page, video!.id);

    const user = await signUpOnWeb(page, 'rel-resume-none');
    await createProfile(user);

    // Opened at ?t=30 (a share or comment link) and left open past the 10s
    // save interval without pressing play: this used to save 0:30.
    await page.goto(`${watchUrl(video!.id)}?t=30`);
    await dismissConsent(page);
    await expect.poll(() => videoTime(page), { timeout: 45000 }).toBeGreaterThan(29);
    await page.waitForTimeout(12000);

    await page.goto(watchUrl(video!.id));
    await dismissConsent(page);
    await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('.video-js video')?.readyState ?? 0) >= 1, null, { timeout: 45000 });
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('player-start-over')).toHaveCount(0);
    expect(await videoTime(page)).toBeLessThan(1);
    expect(await savedProgress(user, video!.id), 'progress saved without playback').toBe(0);
  });
});
