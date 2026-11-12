import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { qaLecture } from './test-utils/watch-page';

/**
 * Uploaded-video playback
 *
 * Opens a fully processed QA seed lecture (override with E2E_PLAYBACK_VIDEO_ID)
 * and checks the player loads the HLS
 * stream without a MediaError. Firefox has no native HLS, so this exercises the
 * Video.js MSE path (the filename matches the per-browser CI job's
 * `*video-upload*` glob so it runs on chromium, firefox and webkit).
 */

// A seed lecture, never a fixed id: the old hard-coded video was deleted from QA and the page
// showed "Video not found" (WebKit, the only engine here with H.264, failed on it every run)
async function playbackVideoId(request: Parameters<typeof qaLecture>[0]): Promise<string> {
  return process.env.E2E_PLAYBACK_VIDEO_ID || (await qaLecture(request, 1)).id;
}

test.describe('Video playback', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('processed video loads without a format error', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`/en/video?vid=${await playbackVideoId(request)}`);

    // Playwright's bundled Chromium ships without proprietary codecs, so an
    // H.264/AAC stream can never play there; skip on capability, not name.
    const h264 = await page.evaluate(
      () =>
        typeof MediaSource !== 'undefined' &&
        MediaSource.isTypeSupported('video/mp4; codecs="avc1.64001e,mp4a.40.2"'),
    );
    test.skip(!h264, 'Browser build has no H.264/AAC support');

    const video = page.locator('video').first();
    await expect(video).toBeAttached();

    // HAVE_METADATA (1) or better means the stream was parsed and accepted.
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    expect(await video.evaluate((el: HTMLVideoElement) => el.error?.code ?? null)).toBeNull();

    await expect(page.getByText(/format is not supported/i)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
