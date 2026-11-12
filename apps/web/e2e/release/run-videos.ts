/**
 * Real Bunny uploads on QA/stage are capped (owner, 2026-11-12: a full QA run made 200-300 real
 * uploads and ~9,000 videos piled up in the shared test library, slowing stage encodes).
 *
 * Shared run videos. With E2E_SHARED_RUN_VIDEOS=1 (release-e2e.yml's encode part, QA/stage only)
 * the config's global setup uploads ONE set of clips for the whole run (landscape40, vertical,
 * square: one creator, one channel), before any test, and its teardown deletes them for good
 * (DataScope.cleanup: trash, then the permanent delete with the Bunny video, then the account).
 * Specs that only need a ready video read them with runVideo() instead of uploading their own,
 * so retries, workers and browser projects never multiply uploads. Everywhere else (the local
 * stack, a run without the flag) runVideos() is null and specs upload their own as before.
 *
 * Every real upload is recorded in E2E_RUN_RESOURCES_FILE ("video <id>"): the builders do it for
 * theirs, trackRunUploads(page) for uploads a spec makes through the upload page. The workflow's
 * upload cap counts that file.
 */
import { chromium, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataScope, recordResource, type CreatedVideo } from './builders';
import { releaseEnv } from './targets';

export const RUN_VIDEO_CLIPS = ['landscape40', 'vertical', 'square'] as const;
export type RunVideoClip = (typeof RUN_VIDEO_CLIPS)[number];
export interface RunVideos {
  channelId: string;
  videos: Record<RunVideoClip, CreatedVideo>;
}

const runVideosFile = () => process.env.E2E_RUN_VIDEOS_FILE || path.join(os.tmpdir(), `aun-run-videos-${process.env.E2E_RUN_ID || 'local'}.json`);

/** On for a deployed target when the workflow asks for it (never on the local stack: its uploads are free). */
export const sharedRunVideosOn = (): boolean => process.env.E2E_SHARED_RUN_VIDEOS === '1' && releaseEnv() !== 'local';

/** The run's shared videos, or null when this run has none (specs then upload their own). */
export function runVideos(): RunVideos | null {
  if (!sharedRunVideosOn()) return null;
  const file = runVideosFile();
  if (!existsSync(file)) throw new Error(`E2E_SHARED_RUN_VIDEOS=1 but ${file} is missing: the global setup did not create the run's videos`);
  return JSON.parse(readFileSync(file, 'utf8')) as RunVideos;
}

/**
 * A shared run video, ready. The upload started in the global setup; the wait happens here, in the
 * test, so a slow Bunny encode skips with #929 (DataScope.waitReady) instead of failing the run.
 */
export async function runVideo(clip: RunVideoClip): Promise<CreatedVideo> {
  const set = runVideos();
  if (!set) throw new Error('runVideo: this run has no shared videos (E2E_SHARED_RUN_VIDEOS is not 1)');
  const video = set.videos[clip];
  await new DataScope().waitReady(video.id, video.title);
  return video;
}

/** Records every video this page initiates on the upload page (the upload cap counts them). */
export function trackRunUploads(page: Page): void {
  page.on('response', async (res) => {
    if (res.request().method() !== 'POST' || !/\/api\/videos\/upload\/initiate$/.test(new URL(res.url()).pathname)) return;
    const body = (await res.json().catch(() => ({}))) as { result?: { videoId?: string } };
    if (body.result?.videoId) recordResource('video', body.result.videoId);
  });
}

/** Playwright global setup: uploads the run's shared clips once; the returned function deletes them. */
export default async function globalSetup(): Promise<void | (() => Promise<void>)> {
  if (!sharedRunVideosOn()) return;
  const scope = new DataScope();
  const browser = await chromium.launch();
  try {
    const creator = await scope.createCreator(browser, 'run-videos');
    const channelId = creator.channelIds[0]!;
    const videos = {} as Record<RunVideoClip, CreatedVideo>;
    // Uploaded, not awaited: the encodes run while the first tests start; runVideo() waits
    for (const clip of RUN_VIDEO_CLIPS) videos[clip] = await scope.createVideo(creator.user, channelId, { clip, waitReady: false });
    writeFileSync(runVideosFile(), JSON.stringify({ channelId, videos } satisfies RunVideos));
  } catch (error) {
    await scope.cleanup();
    throw error;
  } finally {
    await browser.close();
  }
  return async () => scope.cleanup();
}
