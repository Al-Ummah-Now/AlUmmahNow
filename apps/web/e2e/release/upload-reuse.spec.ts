/**
 * A retried upload reuses its video (owner, 2026-11-10: every retry created a
 * new Bunny video and the old ones stayed forever).
 *
 * The upload is interrupted (the browser context is closed mid-upload), then
 * retried in a FRESH context (no cookies, no localStorage: nothing remembers
 * the file). Upload initiate keys the unfinished upload on channel + uploader
 * + file fingerprint, so the retry:
 * - gets the same video id back (`reused: true`), not a new Bunny video;
 * - resumes the earlier Bunny upload at its offset (no second TUS POST);
 * - finishes, and the channel has exactly one video for the file.
 *
 * Small file in 5 MB chunks (the `aun:tus-chunk-size` override). The first
 * attempt is cut after exactly two chunks (later chunks are held), so the
 * retry always has an unfinished upload to resume (#799).
 */
import { test } from '@playwright/test';
import { interruptedUploadIsReused } from './upload-reuse-flow';

// Signs users in through the auth server: traces would hold the password.
test.use({ trace: 'off' });
// Real Bunny uploads: no retry (a failed upload is reported, never uploaded again) and every
// upload recorded for the run's upload cap (run-videos.ts, release-e2e.yml)
test.describe.configure({ retries: 0 });

test.describe('Release: retried uploads reuse their video', () => {
  test.describe.configure({ timeout: 360000 });

  test('interrupted, then retried in a fresh browser context: one video, resumed at its offset', async ({ browser }, testInfo) => {
    await interruptedUploadIsReused(browser, testInfo);
  });
});
