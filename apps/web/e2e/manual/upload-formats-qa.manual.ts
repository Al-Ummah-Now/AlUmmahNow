/**
 * REAL upload of every accepted video format on QA (issue #1938), by hand. Not part of any CI job
 * or release: it is not in test-utils/placement.ts and playwright.release.config.ts does not see it.
 * Run it once the format fix is on QA:
 *
 *   cd apps/web
 *   E2E_FORMATS_REAL=1 E2E_ENV=qa E2E_RUN_ID=formats-$(date +%s)-1 \
 *     E2E_RUN_USERS_FILE=$(mktemp) E2E_RUN_RESOURCES_FILE=$(mktemp) \
 *     E2E_CODE_SINK_SECRET=... TEST_PROMOTE_SECRET=... \
 *     pnpm exec playwright test -c playwright.formats-qa.config.ts
 *
 * Needs ffmpeg and ffprobe on the PATH: it makes a real 5 s clip (test pattern and tone) in each
 * format in a temp folder. A throwaway run account named …-media-gate (the one account api-videos
 * transcodes, so our own encoder is tried as well as Bunny) signs up on QA, is made a Creator, makes
 * a channel and uploads each clip through /upload (the single form), the same way a creator does.
 * For each format it records the type the browser reported, what the form did, Bunny's encode result
 * and our R2 transcode result, and prints a table at the end. 6 Bunny uploads, 6 R2 transcodes.
 *
 * Everything it made is deleted in `finally`: each video (trash, then permanent, with its R2 objects
 * and Bunny video), then the temp clips. The run account and its channel go with the run's own
 * teardown: `node --experimental-strip-types scripts/e2e/teardown-run-users.ts $E2E_RUN_USERS_FILE`
 * (and, to be sure nothing is left, scripts/e2e/run-leftovers.ts with the run id).
 * Refuses to run against anything but QA (E2E_ENV=qa) and never touches stage or production.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { releaseEnv, target } from '../release/targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from '../release/web-session';
import { grantCreatorTier } from '../release/creator-tier';
import { submitNewChannelInMenu } from '../release/account-menu';
import { trackRunUploads } from '../release/run-videos';

test.use({ trace: 'off' });
test.describe.configure({ retries: 0, mode: 'serial' });

interface Format {
  label: string;
  file: string;
  /** ffmpeg arguments after the two inputs (video 320x180 test pattern, 440 Hz tone, 5 s) */
  args: string[];
}

const H264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-b:a', '64k'];
const FORMATS: Format[] = [
  { label: 'MP4 (H.264)', file: 'clip-h264.mp4', args: [...H264, '-movflags', '+faststart'] },
  { label: 'MP4 (HEVC)', file: 'clip-hevc.mp4', args: ['-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '32', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '64k'] },
  { label: 'M4V', file: 'clip-h264.m4v', args: [...H264, '-f', 'ipod'] },
  { label: 'MOV (H.264)', file: 'clip-h264.mov', args: [...H264, '-f', 'mov'] },
  { label: 'MOV (HEVC, as an iPhone records)', file: 'clip-hevc.MOV', args: ['-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '32', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '64k', '-f', 'mov'] },
  { label: 'WebM (VP9)', file: 'clip-vp9.webm', args: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '48k'] },
  { label: 'MKV (H.264)', file: 'clip-h264.mkv', args: H264 },
  { label: 'AVI (MPEG-4)', file: 'clip-mpeg4.avi', args: ['-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'libmp3lame', '-b:a', '64k'] },
];

interface Outcome {
  format: string;
  file: string;
  formAccepted: boolean | null;
  bunny: string;
  r2: string;
  note: string;
}

const BUNNY_TIMEOUT_MS = 12 * 60_000;

async function channelIn(page: Page, user: WebUser, name: string): Promise<string> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, name);
  let channelId = '';
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/channels?limit=100');
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === name)?.id ?? '';
      return channelId;
    }, { timeout: 30_000 })
    .not.toBe('');
  return channelId;
}

async function status(user: WebUser, id: string, channelId: string): Promise<{ status?: string; r2?: { status?: string; error?: string } }> {
  const res = await apiFetch(user, `/api/videos/${id}/upload-status`, { headers: { channelId } });
  return ((await res.json().catch(() => ({}))) as { result?: { status?: string; r2?: { status?: string; error?: string } } }).result ?? {};
}

test('every accepted format uploads on QA, is encoded by Bunny and by our transcoder, and is deleted', async ({ page }) => {
  test.skip(process.env.E2E_FORMATS_REAL !== '1', 'set E2E_FORMATS_REAL=1 to run this real-upload check by hand');
  expect(releaseEnv(), 'this check runs on QA only').toBe('qa');
  test.setTimeout(90 * 60_000);
  trackRunUploads(page);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aun-formats-'));
  const made: Array<{ id: string; channelId: string }> = [];
  const outcomes: Outcome[] = [];
  let user: WebUser | undefined;
  try {
    for (const f of FORMATS) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=5', ...f.args, path.join(dir, f.file)]);
    }
    user = await signUpOnWeb(page, 'media-gate');
    await createProfile(user);
    await grantCreatorTier(user);
    const channelId = await channelIn(page, user, `Formats check ${Date.now().toString(36)}`);

    for (const f of FORMATS) {
      const out: Outcome = { format: f.label, file: f.file, formAccepted: null, bunny: '-', r2: '-', note: '' };
      outcomes.push(out);
      const title = `Formats check ${f.file} ${Date.now().toString(36)}`;
      await page.goto(`${target().web}/en/upload`);
      await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('upload-file-input').setInputFiles(path.join(dir, f.file));
      out.formAccepted = await page.getByTestId('upload-details').isVisible().catch(() => false);
      if (!out.formAccepted) {
        out.note = `refused: ${(await page.getByTestId('upload-page-error').textContent().catch(() => '')) ?? ''}`;
        continue;
      }
      await page.getByTestId('upload-title-en').fill(title);
      await page.getByTestId('upload-is-public').uncheck();
      await page.getByTestId('upload-submit').click();
      await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150_000 });

      let id = '';
      await expect
        .poll(async () => {
          const res = await apiFetch(user!, `/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
          id = ((await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> }).data?.find((v) => v.title === title)?.id ?? '';
          return id;
        }, { timeout: 60_000 })
        .not.toBe('');
      made.push({ id, channelId });

      const deadline = Date.now() + BUNNY_TIMEOUT_MS;
      let s = await status(user, id, channelId);
      while (Date.now() < deadline && !(/^(ready|failed)$/.test(s.status ?? '') && /^(ready|failed|undefined)$/.test(String(s.r2?.status)))) {
        await page.waitForTimeout(10_000);
        s = await status(user, id, channelId);
      }
      out.bunny = s.status ?? 'unknown';
      out.r2 = s.r2 ? `${s.r2.status}${s.r2.error ? `: ${s.r2.error}` : ''}` : 'no r2';
    }
  } finally {
    for (const v of made) {
      if (!user) break;
      await apiFetch(user, `/api/videos/${v.id}`, { method: 'DELETE', headers: { channelId: v.channelId } }).catch(() => undefined);
      await apiFetch(user, `/api/videos/${v.id}/permanent`, { method: 'DELETE', headers: { channelId: v.channelId } }).catch(() => undefined);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    const rows = outcomes.map((o) => `${o.format.padEnd(36)} form:${String(o.formAccepted).padEnd(5)} bunny:${o.bunny.padEnd(8)} r2:${o.r2} ${o.note}`);
    process.stdout.write(`\n[formats] ${made.length} videos made and deleted\n${rows.join('\n')}\n`);
  }
  expect(outcomes.filter((o) => o.formAccepted === false), 'formats the form refused').toEqual([]);
});
