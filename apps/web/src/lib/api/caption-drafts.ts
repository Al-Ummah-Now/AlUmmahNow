'use server';

/**
 * Caption drafts (AUN-CAPTIONS): Studio's server actions over
 * /api/videos/:videoId/captions/drafts, the transcription jobs and caption minutes
 * (/captions/jobs, /captions/minutes) and the Quran passage API.
 */
import type { CaptionCue, CaptionDraft, CaptionJob, CaptionMinutesUsage } from '@al-ummah/shared-types';
import { buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';
import { logger } from '@/lib/logger-server';

export interface CaptionDraftSummary {
  language: string;
  version: number;
  kind: CaptionDraft['kind'];
  origin: CaptionDraft['origin'];
  edited: boolean;
  cues: number;
  pendingQuran: number;
  updatedAt: string;
  publishedVersion?: number;
  publishedAt?: string;
  track: 'none' | 'machine' | 'upload';
}

export type CaptionDraftDetail = Omit<CaptionDraftSummary, 'cues'> & { cues: CaptionCue[]; cueCount: number };

export interface QuranPassage {
  range: string;
  label: string;
  surah: { number: number; nameArabic: string; nameSimple: string };
  ayat: Array<{ ayah: number; text: string; partial: boolean }>;
  quranComUrl: string;
}

/** A refusal keeps the body's other fields in `details` (a 402's `minutesNeeded` and `usage`). */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; version?: number; details?: Record<string, unknown> };

async function call<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<ActionResult<T>> {
  const auth = init.auth === false ? null : await getServerAuthContext();
  try {
    const res = await fetch(buildApiUrl(path), {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string; version?: number } & Record<string, unknown>;
    if (!res.ok || json.success === false) {
      if (res.status >= 500) logger.error('[CaptionDrafts] Request failed', { path, status: res.status, error: json.error });
      const { success: _success, error, version, ...details } = json;
      return {
        ok: false,
        status: res.status,
        error: typeof error === 'string' ? error : 'request_failed',
        ...(typeof version === 'number' ? { version } : {}),
        ...(Object.keys(details).length ? { details } : {}),
      };
    }
    return { ok: true, data: (json.data ?? (json as unknown)) as T };
  } catch (error) {
    logger.error('[CaptionDrafts] Request error', { path, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, status: 0, error: 'network' };
  }
}

const base = (videoId: string) => `/api/videos/${encodeURIComponent(videoId)}/captions/drafts`;

export interface CaptionClaim {
  language: string;
  status: 'queued' | 'failed';
  requestedAt: string;
  error?: 'transcript_gone' | 'draft_exists' | 'failed';
}

export async function listCaptionDrafts(videoId: string): Promise<ActionResult<{ drafts: CaptionDraftSummary[]; claims: CaptionClaim[]; transcriptAvailable: boolean }>> {
  return call(base(videoId));
}

/** Use the video review's automatic transcript as a caption draft (queued). */
export async function claimReviewTranscript(videoId: string, language: string, replace = false): Promise<ActionResult<{ status: 'queued' }>> {
  return call(`/api/videos/${encodeURIComponent(videoId)}/review/transcript/claim`, { method: 'POST', body: { language, ...(replace ? { replace: true } : {}) } });
}

export async function getCaptionDraft(videoId: string, language: string): Promise<ActionResult<CaptionDraftDetail>> {
  return call(`${base(videoId)}/${encodeURIComponent(language)}`);
}

export async function saveCaptionDraft(videoId: string, language: string, baseVersion: number, cues: CaptionCue[]): Promise<ActionResult<CaptionDraftSummary>> {
  return call(`${base(videoId)}/${encodeURIComponent(language)}`, { method: 'PUT', body: { baseVersion, cues } });
}

export async function deleteCaptionDraft(videoId: string, language: string): Promise<ActionResult<unknown>> {
  return call(`${base(videoId)}/${encodeURIComponent(language)}`, { method: 'DELETE' });
}

export async function publishCaptionDraft(videoId: string, language: string, baseVersion: number, replaceUpload = false): Promise<ActionResult<{ draft: CaptionDraftSummary }>> {
  return call(`${base(videoId)}/${encodeURIComponent(language)}/publish`, { method: 'POST', body: { baseVersion, replaceUpload } });
}

/** What Studio shows of a transcription job */
export type CaptionJobView = Pick<CaptionJob, 'id' | 'videoId' | 'language' | 'replace' | 'status' | 'progress' | 'minutesReserved' | 'minutesCharged' | 'waived' | 'error' | 'createdAt' | 'updatedAt' | 'finishedAt'>;

const jobsBase = (videoId: string) => `/api/videos/${encodeURIComponent(videoId)}/captions/jobs`;

/** The video's recent transcription jobs, newest first. */
export async function listCaptionJobs(videoId: string): Promise<ActionResult<{ jobs: CaptionJobView[] }>> {
  return call(jobsBase(videoId));
}

/**
 * Transcribe the video in `language`. `existing` is true when a job of that language was already
 * running. Refusals: 402 `upgrade_required` (details: minutesNeeded, usage), 409 `draft_exists` or
 * `video_not_ready`, 503 while transcription is switched off.
 */
export async function startCaptionJob(videoId: string, language: string, replace = false): Promise<ActionResult<{ job: CaptionJobView; existing: boolean }>> {
  return call(jobsBase(videoId), { method: 'POST', body: { language, ...(replace ? { replace: true } : {}) } });
}

/** Cancel a job; its minutes come back. 409 `job_finishing` while the draft is being written. */
export async function cancelCaptionJob(videoId: string, jobId: string): Promise<ActionResult<{ job: CaptionJobView }>> {
  return call(`${jobsBase(videoId)}/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
}

/** The caller's caption minutes and what transcribing this video takes (null until its length is known). */
export async function getCaptionMinutes(videoId: string): Promise<ActionResult<{ usage: CaptionMinutesUsage; minutesNeeded: number | null }>> {
  return call(`/api/videos/${encodeURIComponent(videoId)}/captions/minutes`);
}

/** The official text of a range (`67:1:1-67:5:12`, or whole ayat `3:166-167`). Public. */
export async function getQuranPassage(range: string): Promise<ActionResult<QuranPassage>> {
  return call(`/api/v1/quran/passage?range=${encodeURIComponent(range)}`, { auth: false });
}
