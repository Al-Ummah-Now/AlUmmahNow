/**
 * The retried upload resumes even when Bunny's TUS HEAD answers 404 for a moment (v2026.11.13.3 on
 * stage: the retry's HEAD of the earlier upload got a 404 and tus-js-client started a second upload
 * from byte 0). On the local stack the fake Bunny answers the retry's first two HEADs with 404
 * while it still holds the bytes; the upload must still resume at its offset, with no second TUS
 * upload and one video (resilient-tus.ts HEAD_GONE_CONFIRMATIONS).
 */
import { test, expect } from '@playwright/test';
import { interruptedUploadIsReused } from './upload-reuse-flow';

const LOCAL_CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';

test.use({ trace: 'off' });
test.describe.configure({ retries: 0 });

test.describe('Release: a retried upload survives a Bunny HEAD blip', () => {
  test.describe.configure({ timeout: 360000 });

  test('interrupted, retried while Bunny answers HEAD 404 twice: one video, resumed at its offset', async ({ browser }, testInfo) => {
    await interruptedUploadIsReused(browser, testInfo, {
      afterInterrupt: async (_videoId, title) => {
        // The video's Bunny GUID is not our video id (media providers): find it by the upload's title
        const videos = (await (await fetch(`${LOCAL_CONTROL}/__fake/bunny/videos`)).json()) as Array<{ guid: string; title: string }>;
        const guid = videos.find((v) => v.title.includes(title))?.guid;
        expect(guid, 'the fake Bunny has the interrupted upload').toBeTruthy();
        const res = await fetch(`${LOCAL_CONTROL}/__fake/bunny/videos/${guid}/tus-head-404?count=2`, { method: 'POST' });
        expect(res.status, 'the fake Bunny took the HEAD blip').toBe(200);
      },
    });
  });
});
