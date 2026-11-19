/**
 * A real live stream, end to end (D3): a new creator creates a stream in Studio,
 * reads its encoder settings from the Go live page, presses Go live and pushes
 * real video with ffmpeg (a synthetic test pattern and tone). The stream must go
 * live in Studio, play on /live/{id} in a browser, end through Studio's in-app
 * confirm, and leave a recording that the watch page offers and that holds the
 * streamed segments.
 *
 * Either provider: self-hosted (HTTPS HLS push to the live edge, which is what
 * every environment can take today) or Bunny Live (RTMP, once Bunny grants the
 * closed preview, #874). A Bunny recording is encoded by Bunny: a slow encode
 * skips with the reason (encode.ts), anything else fails.
 *
 * Runs in the player project (branded Chrome) for real H.264 playback. Needs
 * ffmpeg on PATH (release-e2e.yml installs it).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';
import { apiFetch, expectHydrated, type WebUser } from './web-session';
import { confirmInApp, webConfirm } from './in-app-confirm';
import { untilEncoded } from './encode';

// Sign-in pages carry the test password and the Go live page the stream key: never record them
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

/** Longest the encoder runs; the test ends the stream well before this. */
const PUSH_SECONDS = 150;

const SOURCE = ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(PUSH_SECONDS)];
const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-b:v', '800k', '-maxrate', '900k', '-bufsize', '1600k', '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2'];

/** ffmpeg arguments for the stream's ingest (the same layout Studio's ffmpeg example uses, one rendition). */
export function encoderArgs(protocol: string, server: string, key: string): string[] {
  const base = ['-hide_banner', '-loglevel', 'error', '-nostats', ...SOURCE, '-map', '0:v', '-map', '1:a', ...H264];
  if (protocol === 'rtmp') return [...base, '-f', 'flv', `${server.replace(/\/$/, '')}/${key}`];
  const ingest = `${server.replace(/\/$/, '')}/${key}`;
  return [
    ...base,
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_segment_type', 'fmp4',
    '-hls_flags', 'independent_segments+program_date_time', '-hls_start_number_source', 'epoch',
    '-method', 'PUT', '-http_persistent', '1', '-master_pl_name', 'master.m3u8',
    '-var_stream_map', 'v:0,a:0,name:360', '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', `${ingest}/%v/seg_%d.m4s`, `${ingest}/%v/index.m3u8`,
  ];
}

interface LiveState {
  status: string;
  sessionStatus: string | null;
  receiving: boolean;
  playbackUrl: string | null;
  vodUrl: string | null;
  provider: string | null;
}

async function liveState(user: WebUser, streamId: string): Promise<LiveState> {
  const res = await apiFetch(user, `/api/live-streams/${streamId}/state`);
  expect(res.status, `GET state: HTTP ${res.status}`).toBe(200);
  return ((await res.json()) as { result: LiveState }).result;
}

/** The watch page's video element is playing: its time moves forward. */
async function expectPlaying(page: Page, what: string): Promise<void> {
  const video = page.locator('[data-testid="live-watch"] video').first();
  await expect(video, `${what}: no video element`).toBeAttached({ timeout: 30000 });
  // Muted so autoplay is allowed; play() in case the player waits for a gesture
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    void v.play().catch(() => undefined);
  });
  const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(time, { message: `${what}: the video never started`, timeout: 45000 }).toBeGreaterThan(1);
  const first = await time();
  await expect.poll(time, { message: `${what}: playback stalled`, timeout: 20000 }).toBeGreaterThan(first + 1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.error?.code ?? null), `${what}: media error`).toBeNull();
}

test.describe('Release: a real live stream (ffmpeg → watch → end → recording)', () => {
  test.beforeEach(skipUntilStudioDeployed);
  test.setTimeout(6 * 60_000);

  let owner: WebUser | null = null;
  let streamId: string | null = null;
  let encoder: ChildProcess | null = null;

  test.afterEach(async () => {
    encoder?.kill('SIGKILL');
    encoder = null;
    // A failed run still removes its stream (ends its session at the provider first)
    if (owner && streamId) await apiFetch(owner, `/api/live-streams/${streamId}`, { method: 'DELETE' }).catch(() => undefined);
    owner = null;
    streamId = null;
  });

  test('streams real video, plays it live, ends it and offers the recording', async ({ page, context }) => {
    expect(spawnSync('ffmpeg', ['-version']).status, 'ffmpeg must be on PATH (release-e2e.yml installs it)').toBe(0);
    await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    const { user, channelId } = await studioOwner(page, 'rel-live-ffmpeg');
    owner = user;

    // Create in Studio
    await page.goto(`${target().web}/en/studio/${channelId}/content/live`);
    const titleField = page.getByTestId('studio-live-title');
    await expectHydrated(titleField);
    const title = `Release ffmpeg live ${Date.now().toString(36)}`;
    await titleField.fill(title);
    await page.getByTestId('studio-live-create').click();
    const opened = page.waitForURL(/\/content\/live\/[0-9a-f-]{36}$/, { timeout: 30000 }).then(() => 'opened' as const);
    const refused = page.getByTestId('studio-live-error').waitFor({ timeout: 30000 }).then(() => 'refused' as const);
    if ((await Promise.race([opened, refused])) === 'refused') {
      throw new Error(`Creating a live stream failed: ${(await page.getByTestId('studio-live-error').textContent()) ?? ''}`);
    }
    streamId = page.url().split('/').pop() ?? null;
    expect(streamId).toBeTruthy();

    // Encoder settings from the Go live page, exactly what a creator copies
    const settings = page.getByTestId('studio-golive-encoder');
    await expect(settings).toBeVisible({ timeout: 30000 });
    const protocol = (await settings.getAttribute('data-protocol')) ?? '';
    expect(['rtmp', 'https-hls']).toContain(protocol);
    test.info().annotations.push({ type: 'live-protocol', description: protocol });
    await page.getByTestId('studio-golive-reveal').click();
    const server = await page.getByTestId('studio-golive-server').inputValue();
    const key = await page.getByTestId('studio-golive-key').inputValue();
    expect(key.length).toBeGreaterThan(8);

    // Go live, then push video
    await expectHydrated(page.getByTestId('studio-golive-start'));
    await page.getByTestId('studio-golive-start').click();
    await expect(page.getByTestId('studio-golive-status')).toHaveText('Waiting for your encoder…', { timeout: 30000 });
    // Never log the arguments: they hold the stream key
    const stderr: string[] = [];
    encoder = spawn('ffmpeg', encoderArgs(protocol, server, key), { stdio: ['ignore', 'ignore', 'pipe'] });
    encoder.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString().replaceAll(key, '<key>')));
    const exited = new Promise<number | null>((resolve) => encoder!.on('exit', resolve));

    // Live in Studio (first media at the provider), receiving per the API
    await expect(page.getByTestId('studio-golive'), `encoder errors: ${stderr.join('').slice(-500)}`).toHaveAttribute('data-phase', 'live', { timeout: 60000 });
    await expect(page.getByTestId('studio-golive-status')).toHaveText("You’re live");
    await expect.poll(async () => (await liveState(user, streamId!)).receiving, { timeout: 30000 }).toBe(true);
    const live = await liveState(user, streamId!);
    expect(live.status).toBe('live');
    test.info().annotations.push({ type: 'live-provider', description: live.provider ?? 'unknown' });

    // Plays on the public watch page, as a signed-out viewer would see it
    const viewer = await page.context().browser()!.newContext();
    await viewer.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    const watch = await viewer.newPage();
    await watch.goto(`${target().web}/en/live/${streamId}`);
    await expect(watch.getByTestId('live-watch')).toHaveAttribute('data-mode', 'live', { timeout: 30000 });
    await expect(watch.getByTestId('live-watch-badge')).toBeVisible();
    await expect(watch.getByTestId('live-watch-title')).toHaveText(title);
    await expectPlaying(watch, 'live');

    // The recording is checked for ~10 s of video below: before ending, wait until the live playlist
    // has listed at least 6 of the 2 s segments. Ending as soon as the viewer played raced the
    // encoder: on a fast stage only 2 segments were pushed (v2026.11.19.8)
    if (live.provider !== 'bunny' && live.playbackUrl) {
      const listed = new Set<string>();
      await expect
        .poll(
          async () => {
            const top = await (await fetch(live.playbackUrl!, { cache: 'no-store' })).text();
            const variant = top.includes('#EXT-X-STREAM-INF') ? top.split('\n').find((line) => line && !line.startsWith('#')) : undefined;
            const media = variant ? await (await fetch(new URL(variant.trim(), live.playbackUrl!), { cache: 'no-store' })).text() : top;
            // Signed segment URLs differ per fetch: count the path only
            for (const line of media.split('\n')) if (line.trim() && !line.startsWith('#')) listed.add(line.trim().split('?')[0]!);
            return listed.size;
          },
          { message: 'the live playlist never listed 6 segments (about 12 s of the stream)', timeout: 60000, intervals: [2000] },
        )
        .toBeGreaterThanOrEqual(6);
    }

    // End in Studio (in-app confirm), then stop the encoder
    await page.getByTestId('studio-golive-end').click();
    await confirmInApp(page, webConfirm('studio-golive-end-dialog'));
    await expect(page.getByTestId('studio-golive-status')).toHaveText('Stream ended', { timeout: 30000 });
    encoder.kill('SIGINT');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]);
    encoder = null;

    // The recording: a finished VOD playlist with the streamed segments, offered on the watch page
    let vodUrl: string | null = null;
    await untilEncoded(
      'Live recording',
      () =>
        expect
          .poll(async () => (vodUrl = (await liveState(user, streamId!)).vodUrl), { message: 'no recording after the stream ended', timeout: live.provider === 'bunny' ? 10 * 60_000 : 60_000 })
          .toBeTruthy(),
      async () => live.provider === 'bunny',
    );
    if (live.provider !== 'bunny') {
      const master = await (await fetch(vodUrl!)).text();
      const variant = master.split('\n').find((line) => line && !line.startsWith('#'));
      expect(variant, `recording master playlist: ${master.slice(0, 200)}`).toBeTruthy();
      const media = await (await fetch(new URL(variant!, vodUrl!))).text();
      expect(media).toContain('#EXT-X-ENDLIST');
      // At least ~10 s of the stream (2 s segments) made it into the recording
      expect(media.match(/#EXTINF/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    }
    await watch.reload();
    await expect(watch.getByTestId('live-watch')).toHaveAttribute('data-mode', 'recording', { timeout: 60000 });
    await expectPlaying(watch, 'recording');
    await viewer.close();
  });
});
