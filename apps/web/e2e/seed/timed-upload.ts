/**
 * Timed QA upload (issue #929): the QA creator seed account uploads one short
 * clip through QA's normal API (upload initiate → TUS through the api-videos
 * proxy → complete), then the upload status is polled until Bunny reports the
 * encode finished (status 4: encodingStatus.isProcessing false), and both times
 * are reported: the API's "ready" (playable at the first resolution, earlier)
 * and Bunny's finished. The video is deleted afterwards.
 *
 * QA only (the seed account, QA hosts). Run by .github/workflows/bunny-qa-status.yml:
 *   QA_SEED_PASSWORD=… npx tsx e2e/seed/timed-upload.ts
 * Env: TIMED_UPLOAD_SECONDS (clip length, default 10), TIMED_UPLOAD_WAIT_SECONDS (default 1500).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ApiClient } from './seed-api';
import { loginWithPassword, type AuthConfig } from './seed-auth';
import { SEED_EMAIL_DOMAIN } from './seed-config';
import { generateVideo } from './seed-media';
import { seedLogger as log, maskSecret } from './seed-logger';
import { listOwnChannels } from './seed-users';

const PASSWORD = process.env.QA_SEED_PASSWORD || '';
const CLIP_SECONDS = Number(process.env.TIMED_UPLOAD_SECONDS || 10);
const WAIT_MS = Number(process.env.TIMED_UPLOAD_WAIT_SECONDS || 1500) * 1000;
const authConfig: AuthConfig = {
  issuerUrl: 'https://auth.qa.alummahnow.net',
  webUrl: 'https://videos.qa.alummahnow.net',
  clientId: 'e0de3c30-0304-4ac4-86d6-1e185dec0439',
};
const api = new ApiClient('https://videos.api.qa.alummahnow.net');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (!PASSWORD) throw new Error('QA_SEED_PASSWORD is required');
  const browser = await chromium.launch({ headless: true });
  const login = await loginWithPassword(browser, authConfig, `qa-creator@${SEED_EMAIL_DOMAIN}`, PASSWORD).finally(() => browser.close());
  if (!login.ok) throw new Error(`qa-creator sign-in failed: ${login.reason}`);
  const session = login.session;
  maskSecret(session.accessToken);
  const channel = (await listOwnChannels(api, session)).find((c) => !c.isDeleted);
  if (!channel) throw new Error('qa-creator has no channel: run the seed');

  const stamp = new Date().toISOString();
  const title = `Bunny timing probe ${stamp}`;
  const filePath = generateVideo(
    { slug: `timed-${Date.now()}`, title, titleAr: title, description: '#929 timing probe', descriptionAr: '', category: 'islamic_lectures', tags: [], language: 'en', durationSeconds: CLIP_SECONDS, orientation: 'landscape', toneHz: 440 },
    path.join(os.tmpdir(), 'timed-upload'),
  );
  const fileSize = fs.statSync(filePath).size;
  const t0 = Date.now();
  const initiate = await api.post<{ result?: { videoId?: string; tusSessionId?: string } }>(
    '/api/videos/upload/initiate',
    { title, description: '#929 Bunny encode timing probe (deleted after)', fileSize, mimeType: 'video/mp4', isPublic: false, tags: '' },
    { token: session.accessToken, channelId: channel.id },
  );
  const videoId = initiate.data.result?.videoId;
  const tusSessionId = initiate.data.result?.tusSessionId;
  if (!videoId || !tusSessionId) throw new Error('initiate returned no videoId/tusSessionId');
  maskSecret(tusSessionId);
  await api.tusUpload({ token: session.accessToken, tusSessionId, videoId, filePath, mimeType: 'video/mp4' });
  await api.post('/api/videos/upload/complete', { videoId, fileSize, duration: CLIP_SECONDS }, { token: session.accessToken, channelId: channel.id });
  const uploaded = Date.now();
  log.info('Uploaded', { videoId, fileSize, uploadSeconds: Math.round((uploaded - t0) / 1000) });

  let status = 'unknown';
  let progress: number | undefined;
  let playableSeconds: number | undefined;
  let finished = false;
  const timeline: string[] = [];
  try {
    while (Date.now() - uploaded < WAIT_MS) {
      const res = await api.get<{ result?: { status?: string; progress?: number; encodingStatus?: { isProcessing?: boolean } } }>(`/api/videos/${videoId}/upload-status`, {
        token: session.accessToken,
        channelId: channel.id,
      });
      const next = res.data.result?.status || 'unknown';
      const nextProgress = res.data.result?.progress;
      if (next !== status || nextProgress !== progress) timeline.push(`+${Math.round((Date.now() - uploaded) / 1000)}s ${next} ${nextProgress ?? ''}`.trim());
      status = next;
      progress = nextProgress;
      if (status === 'ready' && playableSeconds === undefined) playableSeconds = Math.round((Date.now() - uploaded) / 1000);
      // "ready" comes at the first playable resolution (Bunny status 1-3);
      // Bunny's finished (status 4) is the only state not processing
      finished = status === 'ready' && res.data.result?.encodingStatus?.isProcessing === false;
      if (finished || status === 'failed' || status === 'error') break;
      await sleep(10_000);
    }
  } finally {
    const encodeSeconds = Math.round((Date.now() - uploaded) / 1000);
    const lines = [
      '### Timed QA upload',
      `- video: \`${videoId}\` (${CLIP_SECONDS} s clip, ${fileSize} bytes, channel ${channel.id})`,
      `- upload (initiate → complete): ${Math.round((uploaded - t0) / 1000)} s`,
      `- API ready (playable): ${playableSeconds === undefined ? 'never' : `${playableSeconds} s`} from upload complete`,
      `- result: **${finished ? 'Bunny finished' : status}** after **${encodeSeconds} s** from upload complete`,
      '- timeline:',
      ...timeline.map((l) => `  - ${l}`),
    ];
    process.stdout.write(lines.join('\n') + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    await api.request(`/api/videos/${videoId}/permanent`, { method: 'DELETE', token: session.accessToken, channelId: channel.id, allowStatus: [404] }).catch((e) => log.warn('Delete failed', { videoId, error: String(e) }));
  }
  if (!finished) process.exitCode = 1;
}

main().catch((error) => {
  log.error('Timed upload failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
