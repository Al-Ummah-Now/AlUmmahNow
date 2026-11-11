/**
 * Studio Live (issue #771, D3): a new creator creates a live stream, opens its
 * Go live page, sees the encoder settings (either provider: RTMP for Bunny,
 * HTTPS HLS push for self-hosted), presses Go live, ends the stream through the
 * in-app confirm, and deletes it. No video is ever sent: CI never streams.
 */
import { expect, test } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';
import { apiFetch, expectHydrated, type WebUser } from './web-session';
import { confirmInApp, webConfirm } from './in-app-confirm';

// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

test.describe('Release: Studio Go live', () => {
  test.beforeEach(skipUntilStudioDeployed);

  let owner: WebUser | null = null;
  let streamId: string | null = null;

  test.afterEach(async () => {
    // A failed run still removes its stream (ends its session at the provider first)
    if (owner && streamId) await apiFetch(owner, `/api/live-streams/${streamId}`, { method: 'DELETE' }).catch(() => undefined);
    owner = null;
    streamId = null;
  });

  test('creates a stream, shows its encoder settings, goes live, ends and deletes it', async ({ page }) => {
    const { user, channelId } = await studioOwner(page, 'rel-live-golive');
    owner = user;
    const listUrl = `${target().web}/en/studio/${channelId}/content/live`;
    const res = await page.goto(listUrl);
    test.skip(res?.status() === 404, 'Studio Live is not deployed to this environment yet');

    const title = `Release live ${Date.now().toString(36)}`;
    const titleField = page.getByTestId('studio-live-title');
    await expectHydrated(titleField);
    await titleField.fill(title);
    await page.getByTestId('studio-live-create').click();

    // Either the Go live page opens, or the environment has no live provider configured
    const opened = page.waitForURL(/\/content\/live\/[0-9a-f-]{36}$/, { timeout: 30000 }).then(() => 'opened' as const);
    const refused = page.getByTestId('studio-live-error').waitFor({ timeout: 30000 }).then(() => 'refused' as const);
    const outcome = await Promise.race([opened, refused]);
    if (outcome === 'refused') {
      const message = (await page.getByTestId('studio-live-error').textContent()) ?? '';
      test.skip(/not available|capacity|limit/i.test(message), `No live provider may take a stream here: ${message}`);
      throw new Error(`Creating a live stream failed: ${message}`);
    }
    streamId = page.url().split('/').pop() ?? null;

    // Encoder settings, the same layout for both providers
    const encoder = page.getByTestId('studio-golive-encoder');
    await expect(encoder).toBeVisible({ timeout: 30000 });
    const protocol = await encoder.getAttribute('data-protocol');
    test.info().annotations.push({ type: 'live-protocol', description: protocol ?? 'unknown' });
    expect(['rtmp', 'https-hls']).toContain(protocol);
    await expect(page.getByTestId('studio-golive-server')).toHaveValue(protocol === 'rtmp' ? /^rtmps?:\/\// : /^https:\/\//);
    const key = page.getByTestId('studio-golive-key');
    await expect(key).toHaveAttribute('type', 'password');
    const keyValue = await key.inputValue();
    expect(keyValue.length).toBeGreaterThan(8);
    await expect(page.getByTestId('studio-golive-ffmpeg')).not.toContainText(keyValue);
    await page.getByTestId('studio-golive-reveal').click();
    await expect(key).toHaveAttribute('type', 'text');
    await expect(page.getByTestId('studio-golive-ffmpeg')).toContainText('ffmpeg');
    await expect(page.getByTestId('studio-golive-help')).not.toBeEmpty();

    // Go live opens ingest; with no encoder the page waits for one
    await expectHydrated(page.getByTestId('studio-golive-start'));
    await page.getByTestId('studio-golive-start').click();
    await expect(page.getByTestId('studio-golive-status')).toHaveText('Waiting for your encoder…', { timeout: 30000 });

    // End stream asks in the app's own dialog (never a browser prompt)
    const browserDialogs: string[] = [];
    page.on('dialog', (dialog) => {
      browserDialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.getByTestId('studio-golive-end').click();
    await expect(page.getByTestId('studio-golive-end-dialog')).toBeVisible();
    await confirmInApp(page, webConfirm('studio-golive-end-dialog'));
    await expect(page.getByTestId('studio-golive-status')).toHaveText('Stream ended', { timeout: 30000 });
    await expect(page.getByTestId('studio-golive-recording')).toBeVisible();
    expect(browserDialogs, 'End stream must not use a browser prompt').toEqual([]);

    // The watch page answers for it (ended: the recording or its notice)
    await page.goto(`${target().web}/en/live/${streamId}`);
    await expect(page.getByTestId('live-watch')).toHaveAttribute('data-mode', /ended|recording/, { timeout: 30000 });

    // Delete from the list, through the in-app confirm
    await page.goto(listUrl);
    const row = page.locator(`[data-testid="studio-live-row"][data-stream-id="${streamId}"]`);
    await expect(row).toBeVisible({ timeout: 30000 });
    await expectHydrated(row.getByTestId('studio-live-delete'));
    await row.getByTestId('studio-live-delete').click();
    await confirmInApp(page, webConfirm('studio-live-delete-dialog'));
    await expect(row).toHaveCount(0, { timeout: 30000 });
    await expect.poll(async () => (await apiFetch(user, `/api/live-streams/${streamId}`)).status, { timeout: 30000 }).toBe(404);
    streamId = null;
  });
});
