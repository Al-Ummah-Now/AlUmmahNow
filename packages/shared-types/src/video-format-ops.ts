/**
 * Short vs video: the format backfill job and admin actions (shared by
 * api-videos, which runs the job, and admin-api, which starts it and lets
 * admins set a format by hand).
 *
 * The job is a chain of queue messages on the processing-check queue (retry
 * x5, then the DLQ): one message = one page of the videos bucket. Each page
 * classifies its videos with the shared rule (video-format.ts), fetches the
 * encoded resolution from Bunny for ready videos that lack it, hands videos
 * that are still processing to the processing-check loop, flags what cannot
 * be classified (`formatIssue`, admin action), re-projects the page's search
 * and ownership rows (is_short) and queues the next page. Re-running a page
 * is harmless: every step only fills what is missing and the per-page counts
 * are overwritten, not added.
 */
import { classifyVideoFormat, isVideoFormat, type VideoFormat, type VideoFormatInput } from './video-format';

export const VIDEO_FORMAT_JOB_KIND = 'video-format-backfill' as const;

export interface VideoFormatJobMessage {
  kind: typeof VIDEO_FORMAT_JOB_KIND;
  runId: string;
  /** 0-based page number (the key of the page's counts in the run) */
  page: number;
  /** R2 list cursor of this page; null = first page */
  cursor: string | null;
  /** Count only: no record, index or loop changes */
  dryRun: boolean;
  limit: number;
  /** Who started the run (admin user id, or "ops") */
  requestedBy?: string;
}

export const VIDEO_FORMAT_PAGE_SIZE = 50;

/** Run state lives in the global_settings bucket. */
export const VIDEO_FORMAT_RUN_PREFIX = 'ops/video-format/runs/';
export const VIDEO_FORMAT_LATEST_KEY = 'ops/video-format/latest.json';
export const videoFormatRunKey = (runId: string) => `${VIDEO_FORMAT_RUN_PREFIX}${runId}.json`;

export interface VideoFormatPageCounts {
  /** Video records looked at (internal records excluded) */
  scanned: number;
  shorts: number;
  videos: number;
  /** Decided by the uploader's / an admin's choice */
  overrides: number;
  live: number;
  /** Not classifiable yet (no duration or dimensions) after this page */
  unknown: number;
  /** Shorts under the old rule (0 < duration < 60, not live) */
  oldRuleShorts: number;
  /** Short now, not under the old rule */
  becameShorts: number;
  /** Short under the old rule, a video now */
  becameVideos: number;
  /** Ready videos whose encoded resolution was fetched and stored */
  dimensionsStored: number;
  /** Still processing: handed to the processing-check loop */
  rechecking: number;
  /** Could not be classified: flagged for an admin (formatIssue) */
  flagged: number;
  /** Per-video errors on the last attempt of the page */
  errors: number;
}

export const EMPTY_PAGE_COUNTS: Readonly<VideoFormatPageCounts> = Object.freeze({
  scanned: 0, shorts: 0, videos: 0, overrides: 0, live: 0, unknown: 0, oldRuleShorts: 0,
  becameShorts: 0, becameVideos: 0, dimensionsStored: 0, rechecking: 0, flagged: 0, errors: 0,
});

export interface VideoFormatRun {
  runId: string;
  dryRun: boolean;
  requestedBy?: string;
  status: 'running' | 'done';
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** Pages done so far, by page number; a retried page overwrites its entry */
  pages: Record<string, VideoFormatPageCounts>;
  /** Cursor of the next page (null once done) */
  nextCursor: string | null;
  lastError?: string;
}

export function newVideoFormatRun(runId: string, dryRun: boolean, now: Date, requestedBy?: string): VideoFormatRun {
  const at = now.toISOString();
  return { runId, dryRun, requestedBy, status: 'running', startedAt: at, updatedAt: at, pages: {}, nextCursor: null };
}

export function firstVideoFormatMessage(run: VideoFormatRun, limit = VIDEO_FORMAT_PAGE_SIZE): VideoFormatJobMessage {
  return { kind: VIDEO_FORMAT_JOB_KIND, runId: run.runId, page: 0, cursor: null, dryRun: run.dryRun, limit, requestedBy: run.requestedBy };
}

export function isVideoFormatJobMessage(body: unknown): body is VideoFormatJobMessage {
  const m = body as Partial<VideoFormatJobMessage> | null;
  return !!m && m.kind === VIDEO_FORMAT_JOB_KIND && typeof m.runId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(m.runId)
    && Number.isInteger(m.page) && (m.page as number) >= 0;
}

/** Sum of every page's counts. */
export function videoFormatTotals(run: Pick<VideoFormatRun, 'pages'>): VideoFormatPageCounts {
  const total = { ...EMPTY_PAGE_COUNTS };
  for (const page of Object.values(run.pages ?? {})) {
    for (const key of Object.keys(total) as Array<keyof VideoFormatPageCounts>) total[key] += page[key] ?? 0;
  }
  return total;
}

/** Shorts under the rule before 2026-11-09 (duration only). */
export function wasShortByOldRule(video: VideoFormatInput): boolean {
  return !video.isLive && typeof video.duration === 'number' && video.duration > 0 && video.duration < 60;
}

/** Why a video could not be classified; admins resolve it by setting a format. */
export interface VideoFormatIssue {
  reason: string;
  missing: Array<'duration' | 'dimensions'>;
  at: string;
}

/** Who chose the format by hand (the uploader in upload/edit, or an admin). */
export interface VideoFormatChoiceRecord {
  by: 'owner' | 'admin';
  userId: string;
  at: string;
}

/** Loosely typed so app schemas (zod-inferred) fit; values follow VideoFormatIssue / VideoFormatChoiceRecord. */
type FormatFields = VideoFormatInput & {
  format?: VideoFormat;
  formatIssue?: unknown;
  formatSetBy?: unknown;
};

/**
 * Apply a Short / video / auto choice to a record in place. A choice resolves
 * any format issue; 'auto' clears the choice (detection decides again).
 * Returns true when the record changed.
 */
export function applyFormatChoice(video: FormatFields, choice: VideoFormat | 'auto', who: VideoFormatChoiceRecord): boolean {
  const before = JSON.stringify([video.format ?? null, video.formatIssue ?? null]);
  if (choice === 'auto') {
    delete video.format;
    delete video.formatSetBy;
    // Back to detection: the issue stands only if detection still cannot decide
    if (video.formatIssue && classifyVideoFormat(video).source !== 'unknown') delete video.formatIssue;
  } else {
    video.format = choice;
    video.formatSetBy = who;
    delete video.formatIssue;
  }
  return JSON.stringify([video.format ?? null, video.formatIssue ?? null]) !== before;
}

/** True when the record has an open format issue (unclassifiable, no choice made). */
export function hasOpenFormatIssue(video: FormatFields | null | undefined): boolean {
  return !!video?.formatIssue && !isVideoFormat(video.format);
}

// ---------------------------------------------------------------------------
// Run state (global_settings bucket) and starting a run (processing-check queue)
// ---------------------------------------------------------------------------

/** The bits of an R2 bucket the run state needs. */
export interface RunStateBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: unknown): Promise<unknown>;
}

/** The bit of a queue binding starting a run needs. */
export interface RunQueue {
  send(body: unknown, options?: unknown): Promise<unknown>;
}

async function readJsonKey<T>(bucket: RunStateBucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  return object ? (JSON.parse(await object.text()) as T) : null;
}

/** A run by id, or the latest run. */
export async function readVideoFormatRunFrom(bucket: RunStateBucket, runId?: string): Promise<VideoFormatRun | null> {
  if (runId) return readJsonKey<VideoFormatRun>(bucket, videoFormatRunKey(runId));
  const latest = await readJsonKey<{ runId: string }>(bucket, VIDEO_FORMAT_LATEST_KEY);
  return latest ? readJsonKey<VideoFormatRun>(bucket, videoFormatRunKey(latest.runId)) : null;
}

export async function writeVideoFormatRun(bucket: RunStateBucket, run: VideoFormatRun): Promise<void> {
  const options = { httpMetadata: { contentType: 'application/json' } };
  await bucket.put(videoFormatRunKey(run.runId), JSON.stringify(run), options);
  await bucket.put(VIDEO_FORMAT_LATEST_KEY, JSON.stringify({ runId: run.runId, updatedAt: run.updatedAt }), options);
}

/** Write a new run's state and queue its first page. */
export async function startVideoFormatRunWith(
  bucket: RunStateBucket,
  queue: RunQueue,
  opts: { dryRun: boolean; requestedBy?: string; limit?: number; now?: Date; runId?: string },
): Promise<VideoFormatRun> {
  const run = newVideoFormatRun(opts.runId ?? crypto.randomUUID(), opts.dryRun, opts.now ?? new Date(), opts.requestedBy);
  await writeVideoFormatRun(bucket, run);
  await queue.send(firstVideoFormatMessage(run, opts.limit ?? VIDEO_FORMAT_PAGE_SIZE));
  return run;
}

/** A run for API responses: totals instead of per-page counts. */
export function videoFormatRunView(run: VideoFormatRun | null) {
  if (!run) return null;
  const { pages, ...rest } = run;
  return { ...rest, pagesDone: Object.keys(pages ?? {}).length, totals: videoFormatTotals(run) };
}
