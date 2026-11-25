/**
 * REAL upload of every accepted video format on QA (issue #1938), by hand. Not part of any CI job
 * or release: it is not in test-utils/placement.ts and playwright.release.config.ts does not see it.
 * In CI it is the "Upload formats on QA" workflow (workflow_dispatch, main, QA only: the secrets are
 * only in GitHub Actions). By hand, with the QA secrets, once the format fix is on QA:
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
 * Every format on the web list goes through the form. A format the form does not take yet (`viaApi`) goes
 * through the same API calls the form makes (initiate, TUS, complete) to learn whether Bunny and our
 * transcoder take it before it is added to the website; none is probed at the moment (WMV and FLV, probed
 * this way on QA in run 45531275468, are on the list now).
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
import { apiFetch, contextAccessToken, createProfile, signUpOnWeb, type WebUser } from '../release/web-session';
import { grantCreatorTier } from '../release/creator-tier';
import { submitNewChannelInMenu } from '../release/account-menu';
import { trackRunUploads } from '../release/run-videos';
import { recordResource, sessionRefreshToken } from '../release/builders';

test.use({ trace: 'off' });
test.describe.configure({ retries: 0, mode: 'serial' });

/**
 * The account's access token lives 15 minutes on QA and this check runs longer, so every API call goes
 * through api(): when the token's own `exp` is less than 3 minutes away the token is renewed through the
 * web session (contextAccessToken: the web app renews it from 2 minutes before expiry and keeps the
 * cookie's refresh token current), and every call has a timeout. The refresh token rotates whenever
 * the web app renews, which a page load or the upload form may do at any time, so the COOKIE's current
 * refresh token is written to FORMATS_SESSION_FILE after every page step and every renewal, atomically,
 * for the workflow's cleanup step (scripts/e2e/delete-format-videos.ts), which deletes the run's videos
 * whatever became of this process.
 */
const REQUEST_TIMEOUT_MS = 60_000;
const RENEW_WITHIN_S = 3 * 60;
const session: { user?: WebUser; context?: import('@playwright/test').BrowserContext; channelId: string; lastTry: number } = { channelId: '', lastTry: 0 };

/** The `exp` (seconds) of a JWT, or 0 when it cannot be read (then it is renewed) */
function tokenExpiry(token: string | undefined): number {
  try {
    const payload = JSON.parse(Buffer.from((token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

async function persistSession(): Promise<void> {
  const file = process.env.FORMATS_SESSION_FILE;
  if (!file || !session.context) return;
  const refreshToken = await sessionRefreshToken(session.context).catch(() => undefined);
  if (!refreshToken) return;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ refreshToken, channelId: session.channelId }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function freshToken(): Promise<void> {
  if (!session.user || !session.context) return;
  if (tokenExpiry(session.user.accessToken) - Date.now() / 1000 > RENEW_WITHIN_S) return;
  // At most one try every 10 s while the web app has nothing newer (it renews only inside its own window)
  if (Date.now() - session.lastTry < 10_000) return;
  session.lastTry = Date.now();
  const token = await contextAccessToken(session.context).catch(() => undefined);
  if (token) session.user.accessToken = token;
  await persistSession();
}

/** apiFetch with a fresh token and a timeout */
async function api(path: string, init: RequestInit = {}): Promise<Response> {
  await freshToken();
  return apiFetch(session.user!, path, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

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
  { label: 'WMV', file: 'clip-wmv2.wmv', args: ['-c:v', 'wmv2', '-q:v', '8', '-c:a', 'wmav2', '-b:a', '64k'] },
  { label: 'FLV', file: 'clip-flv1.flv', args: ['-c:v', 'flv', '-q:v', '8', '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100'] },
];

interface Outcome {
  format: string;
  file: string;
  formAccepted: boolean | null;
  bunny: string;
  r2: string;
  note: string;
  /** What stopped this format (its own failure; the others go on) */
  error?: string;
}

/**
 * Time budget, nested so cleanup always runs (the workflow: Playwright 55 min < step 60 < qa-encode lock 65
 * < job): uploads stop starting after UPLOADS_END, the encode wait ends by ENCODES_END, then the videos are
 * deleted and the table written, with the rest of the 55 minutes to spare.
 */
const BUNNY_TIMEOUT_MS = 15 * 60_000;
const UPLOADS_END_MS = 30 * 60_000;
const ENCODES_END_MS = 42 * 60_000;
const TEST_TIMEOUT_MS = 55 * 60_000;

async function channelIn(page: Page, user: WebUser, name: string): Promise<string> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, name);
  let channelId = '';
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/channels?limit=100', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === name)?.id ?? '';
      return channelId;
    }, { timeout: 30_000 })
    .not.toBe('');
  return channelId;
}

/** The form's own calls (initiate, TUS create and PATCH, complete) for a file the form refuses. Returns the video id. */
async function uploadViaApi(channelId: string, file: string, mimeType: string, title: string, onInitiate: (id: string) => void): Promise<string> {
  const bytes = fs.readFileSync(file);
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', channelId }, body: JSON.stringify(body) });
  const initiate = await api('/api/videos/upload/initiate', json({ title, description: 'Formats check', fileSize: bytes.length, mimeType, isPublic: false }));
  expect(initiate.status, `initiate for ${mimeType}: ${await initiate.clone().text()}`).toBeLessThan(300);
  const { result } = (await initiate.json()) as { result?: { videoId?: string; tusSessionId?: string } };
  const id = result?.videoId ?? '';
  // The run's upload cap counts it (the form's uploads are recorded by trackRunUploads)
  if (id) {
    recordResource('video', id);
    onInitiate(id); // deleted in the end even when the bytes never arrive
  }
  expect(id && result?.tusSessionId, 'initiate returned no video id or TUS session').toBeTruthy();
  const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64');
  const create = await api('/api/videos/tus', {
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
  await freshToken();
  const patch = await fetch(new URL(location as string, target().api), {
    method: 'PATCH',
    signal: AbortSignal.timeout(2 * REQUEST_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${session.user!.accessToken}`, 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
    body: new Uint8Array(bytes),
  });
  expect(patch.status, `TUS PATCH: ${await patch.clone().text()}`).toBeLessThan(300);
  const complete = await api('/api/videos/upload/complete', json({ videoId: id, fileSize: bytes.length, duration: 5 }));
  expect(complete.status, `complete: ${await complete.clone().text()}`).toBeLessThan(300);
  return id;
}

type UploadStatus = { status?: string; r2?: { status?: string; error?: string } };
const terminal = (v: string | undefined) => v === 'ready' || v === 'failed';

async function status(id: string, channelId: string): Promise<{ status?: string; r2?: { status?: string; error?: string } }> {
  const res = await api(`/api/videos/${id}/upload-status`, { headers: { channelId } });
  return ((await res.json().catch(() => ({}))) as { result?: { status?: string; r2?: { status?: string; error?: string } } }).result ?? {};
}

test('every accepted format uploads on QA, is encoded by Bunny and by our transcoder, and is deleted', async ({ page }) => {
  test.skip(process.env.E2E_FORMATS_REAL !== '1', 'set E2E_FORMATS_REAL=1 to run this real-upload check by hand');
  expect(releaseEnv(), 'this check runs on QA only').toBe('qa');
  test.setTimeout(TEST_TIMEOUT_MS);
  const startedAt = Date.now();
  trackRunUploads(page);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aun-formats-'));
  // Every video the run initiated, recorded the moment its id is known: all of them are deleted at the end,
  // including one whose bytes never arrived
  const made = new Map<string, string>();
  const outcomes: Outcome[] = [];
  let user: WebUser | undefined;
  let channelId = '';
  page.on('response', async (res) => {
    if (res.request().method() !== 'POST' || !/\/api\/videos\/upload\/initiate$/.test(new URL(res.url()).pathname)) return;
    const body = (await res.json().catch(() => ({}))) as { result?: { videoId?: string } };
    if (body.result?.videoId && channelId) made.set(body.result.videoId, channelId);
  });
  const oneLine = (e: unknown) => String(e instanceof Error ? e.message : e).split('\n')[0]!.slice(0, 220);
  try {
    for (const f of FORMATS) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=5', ...f.args, path.join(dir, f.file)]);
    }
    user = await signUpOnWeb(page, 'media-gate');
    await createProfile(user);
    await grantCreatorTier(user);
    channelId = await channelIn(page, user, `Formats check ${Date.now().toString(36)}`);
    session.user = user;
    session.context = page.context();
    session.channelId = channelId;
    await persistSession();

    // Phase 1: upload every clip, one after another (the form's flow, or the API for what the form refuses).
    // Each format is on its own: a failure is noted in the table and the others go on.
    const waiting: Array<{ out: Outcome; id: string }> = [];
    for (const f of FORMATS) {
      const out: Outcome = { format: f.label, file: f.file, formAccepted: null, bunny: '-', r2: '-', note: '' };
      outcomes.push(out);
      if (Date.now() - startedAt > UPLOADS_END_MS) {
        out.error = 'not tried: out of time';
        continue;
      }
      const title = `Formats check ${f.file} ${Date.now().toString(36)}`;
      let id = '';
      try {
        await page.goto(`${target().web}/en/upload`);
        await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30_000 });
        await persistSession();
        await page.getByTestId('upload-file-input').setInputFiles(path.join(dir, f.file));
        out.formAccepted = await page.getByTestId('upload-details').isVisible().catch(() => false);
        if (f.viaApi) {
          // The web list does not take it: the form's answer, then the same calls the form would make
          out.note = out.formAccepted ? 'the form took it' : 'the form refuses it (expected); uploaded through the API';
          id = await uploadViaApi(channelId, path.join(dir, f.file), f.viaApi, title, (videoId) => made.set(videoId, channelId));
        } else {
          if (!out.formAccepted) {
            out.error = `the form refused it: ${(await page.getByTestId('upload-page-error').textContent().catch(() => '')) ?? ''}`.trim();
            continue;
          }
          await page.getByTestId('upload-title-en').fill(title);
          await page.getByTestId('upload-is-public').uncheck();
          await page.getByTestId('upload-submit').click();
          await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150_000 });
          await persistSession();
        }
        await expect
          .poll(async () => {
            const res = await api(`/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
            id = ((await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> }).data?.find((v) => v.title === title)?.id ?? id;
            return id;
          }, { timeout: 60_000 })
          .not.toBe('');
        made.set(id, channelId);
        waiting.push({ out, id });
      } catch (error) {
        // A closed page or an ended test is a cancellation, not this format's failure: stop, clean up
        if (page.isClosed() || /has been closed|Test ended|Test timeout|Target (page|closed)/i.test(String(error))) throw error;
        out.error = `upload failed: ${oneLine(error)}`;
      }
    }

    // Phase 2: wait for all of them together (one deadline, so the encodes run side by side). A video is
    // done when Bunny has an answer AND our transcoder has one. A video whose upload-status has no `r2`
    // yet is not done: the dual write can lag the upload. If Bunny answered and `r2` is still absent a
    // minute later, this account has no R2 transcode and "no r2" is the answer.
    const deadline = Math.min(Date.now() + BUNNY_TIMEOUT_MS, startedAt + ENCODES_END_MS);
    const bunnyAnsweredAt = new Map<string, number>();
    const last = new Map<string, Awaited<ReturnType<typeof status>>>();
    for (let pending = waiting.slice(); pending.length > 0 && Date.now() < deadline && !page.isClosed(); ) {
      for (const w of pending) last.set(w.id, await status(w.id, channelId).catch((): UploadStatus => ({})));
      pending = pending.filter((w) => {
        const s = last.get(w.id)!;
        if (terminal(s.status) && !bunnyAnsweredAt.has(w.id)) bunnyAnsweredAt.set(w.id, Date.now());
        const noR2 = !s.r2 && bunnyAnsweredAt.has(w.id) && Date.now() - bunnyAnsweredAt.get(w.id)! > 60_000;
        return !((terminal(s.status) && terminal(s.r2?.status)) || noR2);
      });
      await persistSession();
      if (pending.length > 0) await page.waitForTimeout(10_000);
    }
    for (const w of waiting) {
      const s = last.get(w.id) ?? (await status(w.id, channelId).catch((): UploadStatus => ({})));
      w.out.bunny = s.status ?? 'unknown';
      w.out.r2 = s.r2 ? `${s.r2.status}${s.r2.error ? `: ${s.r2.error}` : ''}` : 'no r2';
      const graceOver = bunnyAnsweredAt.has(w.id) && Date.now() - bunnyAnsweredAt.get(w.id)! > 60_000;
      if (!terminal(s.status) || (s.r2 ? !terminal(s.r2.status) : !graceOver)) w.out.note += ' (still encoding at the deadline)';
    }
  } catch (error) {
    // Sign-up, channel or ffmpeg failed: nothing more can be tried, the cleanup below still runs
    outcomes.forEach((o) => (o.error ??= `stopped: ${oneLine(error)}`));
    if (outcomes.length === 0) outcomes.push({ format: '(setup)', file: '', formAccepted: null, bunny: '-', r2: '-', note: '', error: `stopped: ${oneLine(error)}` });
  } finally {
    // Delete every video the run initiated, all at once, each request bounded. The workflow's cleanup
    // step deletes what this misses (a dead process, an expired session).
    let deleteFailures = 0;
    if (session.user) {
      await persistSession().catch(() => undefined);
      const results = await Promise.allSettled(
        [...made].map(async ([id, channel]) => {
          for (const suffix of ['', '/permanent']) {
            const res = await api(`/api/videos/${id}${suffix}`, { method: 'DELETE', headers: { channelId: channel } });
            if (!res.ok && res.status !== 404) throw new Error(`DELETE ${suffix || 'trash'} answered ${res.status}`);
          }
        }),
      );
      deleteFailures = results.filter((r) => r.status === 'rejected').length;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    const rows = outcomes.map((o) => `${o.format.padEnd(36)} form:${String(o.formAccepted).padEnd(5)} bunny:${o.bunny.padEnd(8)} r2:${o.r2} ${o.note} ${o.error ? `ERROR ${o.error}` : ''}`);
    process.stdout.write(`\n[formats] ${made.size} videos made, ${deleteFailures} delete(s) failed\n${rows.join('\n')}\n`);
    // The table for the workflow's job summary (FORMATS_SUMMARY_FILE): no ids, emails or secrets in it
    if (process.env.FORMATS_SUMMARY_FILE) {
      const cell = (v: string) => v.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
      const md = [
        '| Format | Web form | Bunny | Our transcoder (R2) | Note |',
        '|---|---|---|---|---|',
        ...outcomes.map((o) => `| ${cell(o.format)} | ${o.formAccepted === null ? 'not tried' : o.formAccepted ? 'accepted' : 'refused'} | ${cell(o.bunny)} | ${cell(o.r2)} | ${cell([o.note, o.error ? `FAILED: ${o.error}` : ''].filter(Boolean).join(' '))} |`),
        '',
        `${made.size} videos made; ${deleteFailures === 0 ? 'all deleted' : `${deleteFailures} could not be deleted here (the workflow's cleanup step retries them)`}.`,
      ].join('\n');
      fs.writeFileSync(process.env.FORMATS_SUMMARY_FILE, `${md}\n`);
    }
  }
  // A format on the web list that failed is a failure of the check; a `viaApi` probe's table row is its answer
  expect(outcomes.filter((o) => o.error && !FORMATS.find((f) => f.file === o.file)?.viaApi), 'formats on the web list that failed').toEqual([]);
});
