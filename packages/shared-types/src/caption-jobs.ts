/**
 * On-demand transcription jobs (AUN-CAPTIONS §5.1–5.4, P2).
 *
 * A creator asks for captions in the language spoken in a video. api-videos
 * checks access and reserves the caption minutes (caption-minutes.ts), stores
 * the job (SEARCH_DB `caption_jobs`) and finds its audio:
 * - the video review's 16 kHz chunks, while the review media still hold them, or
 * - an audio extraction by the media transcoder (TRANSCODE_QUEUE `caption_audio`),
 *   which writes the same chunk format under `captions-work/<jobId>/`.
 * The processor then transcribes the chunks (Workers AI Whisper; a fixture in
 * tests), filters the known hallucinations, finds the Quran with the
 * AUN-CAPTIONS matcher and writes a draft whose Quran spans are references only.
 * The creator reviews it in Studio; nothing reaches viewers until they publish.
 *
 * Every step is a queued job with retry; the last attempt fails the job,
 * refunds every minute and flags the admin (Errors page, Retry). An admin's
 * retry of a platform failure is free.
 */

export const CAPTION_JOB_STATUSES = ['queued', 'waiting_budget', 'extracting', 'transcribing', 'postprocessing', 'ready', 'failed', 'cancelled'] as const;
export type CaptionJobStatus = (typeof CAPTION_JOB_STATUSES)[number];

export const CAPTION_JOB_TERMINAL: readonly CaptionJobStatus[] = ['ready', 'failed', 'cancelled'];
export const isCaptionJobActive = (status: CaptionJobStatus) => !CAPTION_JOB_TERMINAL.includes(status);

/** Why a job failed (Studio maps each to an en/ar message). */
export const CAPTION_JOB_ERRORS = ['audio_unavailable', 'transcription_failed', 'no_speech', 'draft_exists', 'video_gone', 'failed'] as const;
export type CaptionJobError = (typeof CAPTION_JOB_ERRORS)[number];

export interface CaptionJob {
  id: string;
  videoId: string;
  channelId: string | null;
  /** Who pays (the tier holder; caption-minutes.ts) */
  subjectId: string;
  requestedBy: string;
  kind: 'transcribe';
  /** The language spoken in the video, the draft's language */
  language: string;
  /** Replace a draft that exists in that language */
  replace: boolean;
  provider: string;
  model: string;
  status: CaptionJobStatus;
  /** Chunks transcribed so far, of `total` (Studio's "Transcribing 3/7") */
  progress: { done: number; total: number } | null;
  minutesReserved: number;
  minutesCharged: number | null;
  /** An admin's retry of a platform failure: nothing is charged */
  waived: boolean;
  error: CaptionJobError | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** Payload of MessageType.CaptionJob (videos queue). */
export interface CaptionJobPayload {
  jobId: string;
  videoId: string;
  language: string;
  replace: boolean;
  requestedBy: string;
  /** `review/…/manifest.json` or `captions-work/<jobId>/manifest.json` in the private media bucket */
  audioManifestKey: string;
  /** The first chunk this delivery transcribes (a long video takes several deliveries) */
  nextChunk: number;
  /** Whisper's initial prompt: the video title (and later the glossary) */
  prompt?: string;
  model: string;
  /** The day's speech-to-text budget (the admin's monthly caption budget / 30), shared by all jobs */
  dailyBudgetUsd: number;
  requestedAt: string;
}

/** The private media prefix of a job's extracted audio and partial transcript; api-videos deletes it when the job ends. */
export const CAPTION_WORK_PREFIX = 'captions-work/';
export const captionWorkPrefix = (jobId: string) => `${CAPTION_WORK_PREFIX}${jobId}/`;
/** The job's partial transcript, so a retry or the next delivery resumes where it stopped. */
export const captionWorkTranscriptKey = (jobId: string) => `${captionWorkPrefix(jobId)}transcript.json`;

/**
 * api-videos → media (TRANSCODE_QUEUE): extract a video's audio only, as 16 kHz
 * mono MP3 chunks of at most 10 minutes (the review format), from the kept R2
 * original or Bunny's source. The media worker writes the chunks and
 * `<out>manifest.json` (CaptionAudioManifest) to the private media bucket and
 * reports to api-videos `POST /internal/captions/jobs/:jobId/audio`.
 */
export interface CaptionAudioJobMessage {
  kind: 'caption_audio';
  jobId: string;
  videoId: string;
  /** `captions-work/<jobId>/` */
  out: string;
  queuedAt: string;
}

export interface CaptionAudioManifest {
  jobId: string;
  videoId: string;
  durationMs: number;
  /** 16 kHz mono chunks of ≤ 10 minutes, in order */
  audio: Array<{ key: string; startMs: number; endMs: number }>;
  createdAt: string;
}

/** The media worker's report (POST /internal/captions/jobs/:jobId/audio). */
export type CaptionAudioReport = { ok: true; manifestKey: string } | { ok: false; error: string; retryable: boolean };

const SAFE_JOB_ID = /^[A-Za-z0-9-]{8,64}$/;
const SAFE_VIDEO_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function isCaptionAudioJobMessage(value: unknown): value is CaptionAudioJobMessage {
  const m = value as Partial<CaptionAudioJobMessage> | null;
  return (
    !!m &&
    m.kind === 'caption_audio' &&
    typeof m.jobId === 'string' &&
    SAFE_JOB_ID.test(m.jobId) &&
    typeof m.videoId === 'string' &&
    SAFE_VIDEO_ID.test(m.videoId) &&
    m.out === captionWorkPrefix(m.jobId) &&
    typeof m.queuedAt === 'string'
  );
}

/** Phrases Whisper invents over silence or music; dropped when a whole segment is just one of them (§5.4). */
export const CAPTION_PHANTOM_PHRASES: readonly string[] = [
  'اشتركوا في القناة',
  'اشترك في القناة',
  'لا تنسوا الاشتراك في القناة',
  'شكرا للمشاهدة',
  'شكرا على المشاهدة',
  'ترجمة نانسي قنقر',
  'Thank you.',
  'Thanks for watching!',
  'Thank you for watching.',
  'Please subscribe.',
  'Subtitles by the Amara.org community',
];
