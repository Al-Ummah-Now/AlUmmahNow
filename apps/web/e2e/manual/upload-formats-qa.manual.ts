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
 * WMV and FLV are not on the web list, so the form refuses them; they go through the same API calls
 * the form makes (initiate, TUS, complete) to learn whether Bunny and our transcoder take them: if
 * Bunny does, they can be added to the website as they are in Desktop Studio.
 * For each format it records the type the browser reported, what the form did, Bunny's encode result
 * and our R2 transcode result, and prints a table at the end. 10 Bunny uploads (the run's cap), 10 R2 transcodes.
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
  /** Not on the web list: uploaded through the API with this type, since the form refuses it */
  viaApi?: string;
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
  { label: 'WMV (not on the web list)', file: 'clip-wmv2.wmv', args: ['-c:v', 'wmv2', '-q:v', '8', '-c:a', 'wmav2', '-b:a', '64k'], viaApi: 'video/x-ms-wmv' },
  { label: 'FLV (not on the web list)', file: 'clip-flv1.flv', args: ['-c:v', 'flv', '-q:v', '8', '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100'], viaApi: 'video/x-flv' },
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

/** The form's own calls (initiate, TUS create and PATCH, complete) for a file the form refuses. Returns the video id. */
async function uploadViaApi(user: WebUser, channelId: string, file: string, mimeType: string, title: string): Promise<string> {
  const bytes = fs.readFileSync(file);
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', channelId }, body: JSON.stringify(body) });
  const initiate = await apiFetch(user, '/api/videos/upload/initiate', json({ title, description: 'Formats check', fileSize: bytes.length, mimeType, isPublic: false }));
  expect(initiate.status, `initiate for ${mimeType}: ${await initiate.clone().text()}`).toBeLessThan(300);
  const { result } = (await initiate.json()) as { result?: { videoId?: string; tusSessionId?: string } };
  const id = result?.videoId ?? '';
  expect(id && result?.tusSessionId, 'initiate returned no video id or TUS session').toBeTruthy();
  const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64');
  const create = await apiFetch(user, '/api/videos/tus', {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(bytes.length),
      'Upload-Metadata': [`tusSessionId ${b64(result!.tusSessionId!)}`, `videoId ${b64(id)}`, `filename ${b64(path.basename(file))}`, `filetype ${b64(mimeType)}`].join(','),
    },
  });
  expect(create.status, `TUS create: ${await create.clone().text()}`).toBeLessThan(300);
  const location = create.headers.get('Location');
  expect(location, 'TUS create returned no Location').toBeTruthy();
  const patch = await fetch(new URL(location as string, target().api), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${user.accessToken}`, 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
    body: new Uint8Array(bytes),
  });
  expect(patch.status, `TUS PATCH: ${await patch.clone().text()}`).toBeLessThan(300);
  const complete = await apiFetch(user, '/api/videos/upload/complete', json({ videoId: id, fileSize: bytes.length, duration: 5 }));
  expect(complete.status, `complete: ${await complete.clone().text()}`).toBeLessThan(300);
  return id;
}

const terminal = (v: string | undefined) => v === 'ready' || v === 'failed';

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
      let id = '';
      if (f.viaApi) {
        // The web list does not take it: say what the form does, then upload the way the form would
        await page.goto(`${target().web}/en/upload`);
        await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('upload-file-input').setInputFiles(path.join(dir, f.file));
        out.formAccepted = await page.getByTestId('upload-details').isVisible().catch(() => false);
        out.note = out.formAccepted ? 'the form took it' : 'the form refuses it (expected); uploaded through the API';
        id = await uploadViaApi(user, channelId, path.join(dir, f.file), f.viaApi, title);
      } else {
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
      }

      await expect
        .poll(async () => {
          const res = await apiFetch(user!, `/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
          id = ((await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> }).data?.find((v) => v.title === title)?.id ?? id;
          return id;
        }, { timeout: 60_000 })
        .not.toBe('');
      made.push({ id, channelId });

      // Done when Bunny has an answer AND our transcoder has one. A video whose upload-status has no `r2`
      // yet is not done: the dual write can lag the upload. If Bunny answered and `r2` is still absent a
      // minute later, this account has no R2 transcode and "no r2" is the answer.
      const deadline = Date.now() + BUNNY_TIMEOUT_MS;
      let bunnyAnsweredAt = 0;
      let s = await status(user, id, channelId);
      for (;;) {
        if (terminal(s.status) && !bunnyAnsweredAt) bunnyAnsweredAt = Date.now();
        const r2Done = terminal(s.r2?.status);
        const noR2 = !s.r2 && bunnyAnsweredAt > 0 && Date.now() - bunnyAnsweredAt > 60_000;
        if ((terminal(s.status) && r2Done) || noR2 || Date.now() > deadline) break;
        await page.waitForTimeout(10_000);
        s = await status(user, id, channelId);
      }
      out.bunny = s.status ?? 'unknown';
      out.r2 = s.r2 ? `${s.r2.status}${s.r2.error ? `: ${s.r2.error}` : ''}` : 'no r2';
      if (!terminal(s.status) || (s.r2 && !terminal(s.r2.status))) out.note += ' (still encoding at the deadline)';
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
  expect(outcomes.filter((o) => o.formAccepted === false && !FORMATS.find((f) => f.file === o.file)?.viaApi), 'formats on the web list that the form refused').toEqual([]);
});
