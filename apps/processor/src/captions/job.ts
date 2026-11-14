/**
 * On-demand transcription (AUN-CAPTIONS §5.1): MessageType.CaptionJob on the videos queue.
 *
 * api-videos owns the job (row, minutes, status); this consumer does the work and reports back
 * through `/internal/captions/jobs/:jobId/progress|finish`:
 *
 * 1. One delivery transcribes ONE audio chunk (≤ 10 minutes) with Whisper, appends it to the
 *    partial transcript in the private media bucket and sends the message on for the next chunk.
 *    A batch of ten messages thus stays well inside the consumer's time limit, and a retry resumes
 *    at the chunk that failed. The partial transcript is written only over the copy this delivery
 *    read (etag), so a duplicate delivery never forks the job into two chains.
 * 2. When the day's caption budget is spent the job waits (`waiting_budget`) and asks again in an
 *    hour; the admin is told once a day.
 * 3. The last delivery (nextChunk = chunks) drops Whisper's phantom phrases and loops, runs the
 *    Quran matcher (recitation becomes references to the official text, never ASR text) and writes
 *    the draft (origin `transcription`). Without a fresh copy of the Quran text it waits and retries.
 *
 * A 409/404 from api-videos means the job was cancelled or erased: the work stops. The last attempt
 * fails the job (api-videos refunds its minutes) and flags the admin with a Retry.
 */
import type { Logger } from '@al-ummah/logger';
import {
  CAPTION_PHANTOM_PHRASES,
  MessageType,
  captionWorkPrefix,
  captionWorkTranscriptKey,
  reportNeedsAction,
  type CaptionJobError,
  type CaptionJobPayload,
  type CaptionJobStatus,
  type D1Database,
  type ErrorReporterEnv,
  type ExecutionContextLike,
  type QuranIndex,
  type ReviewTranscriptFile,
} from '@al-ummah/shared-types';
import { reserveBudget, settleBudget } from '../moderation/budget';
import { USD_PER_NEURON, neuronsFor } from '../moderation/pricing';
import { recordUsage } from '../moderation/usage';
import { loadQuranIndex } from '../quran/review-matcher';
import { ProviderError, assertRealAiAllowed, type AiRunner, type TranscriptSegment, type Usage } from '../review/provider';
import { writeTranscriptDraft, type DraftBucket } from './draft';

export const CAPTIONS_FEATURE = 'captions';
/** The videos queue retries 3 times: the 4th attempt is the last. */
export const CAPTION_JOB_LAST_ATTEMPT = 4;
/** How long a job waits for tomorrow's budget before it asks again. */
export const BUDGET_WAIT_SECONDS = 3600;
export const jobRetryDelaySeconds = (attempts: number) => Math.min(1800, 60 * 2 ** Math.max(0, attempts - 1));
export const captionJobNeedsActionKey = (jobId: string) => `caption-job:${jobId}`;

interface MediaObject {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  etag?: string;
}
interface MediaBucket {
  get(key: string): Promise<MediaObject | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string }; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }): Promise<unknown>;
}

export interface CaptionJobEnv extends ErrorReporterEnv {
  REPORTS_DB: D1Database;
  AI?: AiRunner;
  /** MEDIA_PRIVATE: review/ and captions-work/ audio, the partial transcript, the Quran copy */
  REVIEW_MEDIA?: MediaBucket;
  subtitles?: unknown;
  VIDEOS?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  MESSAGE_QUEUE?: { send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown> };
  AI_GATEWAY_ID?: string;
  /** "fixture" (local stack, E2E): deterministic speech, never a model */
  CAPTION_PROVIDER?: string;
  REVIEW_PROVIDER?: string;
  NODE_ENV?: string;
  CI?: string;
  E2E_ENV?: string;
}

export interface CaptionJobQueueMessage {
  body: { id?: string; type?: number; payload?: unknown };
  attempts?: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

export interface CaptionAsr {
  readonly provider: string;
  transcribe(audio: { base64: string; startMs: number; durationMs: number }, language: string, prompt: string | undefined, usage: Usage[]): Promise<TranscriptSegment[]>;
}

export class WhisperCaptionAsr implements CaptionAsr {
  readonly provider = 'workers-ai';
  constructor(
    private readonly ai: AiRunner,
    private readonly model: string,
    env: CaptionJobEnv,
    private readonly gatewayId = env.AI_GATEWAY_ID || undefined,
  ) {
    assertRealAiAllowed(env);
  }

  async transcribe(audio: { base64: string; startMs: number; durationMs: number }, language: string, prompt: string | undefined, usage: Usage[]): Promise<TranscriptSegment[]> {
    let result: { segments?: Array<{ start?: number; end?: number; text?: string }>; text?: string };
    try {
      // VAD off: it deleted whole recitations in the AUN-CAPTIONS measurements; no conditioning on
      // the previous text: it limits runaway repetition (§5.3)
      result = (await this.ai.run(
        this.model,
        { audio: audio.base64, task: 'transcribe', vad_filter: false, condition_on_previous_text: false, language, ...(prompt ? { initial_prompt: prompt } : {}) },
        this.gatewayId ? { gateway: { id: this.gatewayId } } : undefined,
      )) as typeof result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError(`${this.model}: ${message}`, !/invalid|too large|unsupported|400/i.test(message));
    }
    usage.push({ model: this.model, inputUnits: Math.ceil(audio.durationMs / 1000), outputUnits: 0 });
    const segments = (result?.segments ?? []).filter((s) => typeof s.text === 'string' && s.text.trim());
    if (!segments.length && result?.text?.trim()) return [{ startMs: audio.startMs, endMs: audio.startMs + audio.durationMs, text: result.text.trim() }];
    return segments.map((s) => ({ startMs: audio.startMs + Math.round((s.start ?? 0) * 1000), endMs: audio.startMs + Math.round((s.end ?? 0) * 1000), text: String(s.text).trim() }));
  }
}

/** Deterministic speech for the local stack and E2E: a sentence and Al-Ikhlas per chunk. */
export class FixtureCaptionAsr implements CaptionAsr {
  readonly provider = 'fixture';
  async transcribe(audio: { base64: string; startMs: number; durationMs: number }, _language: string, _prompt: string | undefined, usage: Usage[]): Promise<TranscriptSegment[]> {
    usage.push({ model: 'fixture/transcribe', inputUnits: Math.ceil(audio.durationMs / 1000), outputUnits: 0 });
    const at = audio.startMs;
    return [
      { startMs: at, endMs: at + 3000, text: 'بسم الله نبدأ الدرس' },
      { startMs: at + 3000, endMs: at + 9000, text: 'قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد' },
    ];
  }
}

export function asrFor(env: CaptionJobEnv, model: string): CaptionAsr {
  if (env.CAPTION_PROVIDER === 'fixture' || env.REVIEW_PROVIDER === 'fixture') return new FixtureCaptionAsr();
  if (!env.AI) throw new ProviderError('AI binding missing', false);
  return new WhisperCaptionAsr(env.AI, model, env);
}

// ---------------------------------------------------------------------------
// Hallucinations (§5.4)
// ---------------------------------------------------------------------------

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const PHANTOMS = new Set(CAPTION_PHANTOM_PHRASES.map(norm));

/** A run of the same 1–4 words repeated 4+ times becomes one: Whisper's loop over music or noise. */
export function collapseLoops(text: string): string {
  let words = text.split(/\s+/).filter(Boolean);
  for (let n = 1; n <= 4; n++) {
    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
      const gram = words.slice(i, i + n);
      let repeats = 1;
      while (gram.length === n && words.slice(i + repeats * n, i + (repeats + 1) * n).join(' ') === gram.join(' ')) repeats++;
      if (repeats >= 4) {
        out.push(...gram);
        i += repeats * n;
      } else {
        out.push(words[i]!);
        i++;
      }
    }
    words = out;
  }
  return words.join(' ');
}

/**
 * Drops what Whisper invents: a segment that is only a phantom phrase ("Thanks for watching"),
 * word loops, and a run of 3+ identical segments (kept once). Two identical segments in a row
 * stay: a reciter may repeat an ayah.
 */
export function filterTranscript(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let run = 0;
  for (const segment of segments) {
    const text = collapseLoops(segment.text.trim());
    const key = norm(text);
    if (!key || PHANTOMS.has(key)) continue;
    const prev = out[out.length - 1];
    if (prev && norm(prev.text) === key) {
      run++;
      if (run >= 3) {
        // A third copy: the loop is kept once, stretched over the time it covered
        if (run === 3) out.pop();
        const first = out[out.length - 1]!;
        out[out.length - 1] = { ...first, endMs: segment.endMs };
        continue;
      }
    } else {
      run = 1;
    }
    out.push({ ...segment, text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

const SAFE_JOB_ID = /^[A-Za-z0-9-]{8,64}$/;
const SAFE_VIDEO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;

export function isCaptionJobMessage(message: { body?: { type?: unknown } | null }): boolean {
  return message.body?.type === MessageType.CaptionJob;
}

export function isCaptionJobPayload(p: unknown): p is CaptionJobPayload {
  const x = p as Partial<CaptionJobPayload> | null;
  if (!x || typeof x.jobId !== 'string' || !SAFE_JOB_ID.test(x.jobId) || typeof x.videoId !== 'string' || !SAFE_VIDEO_ID.test(x.videoId)) return false;
  const key = x.audioManifestKey;
  // Only this video's review audio or this job's own extraction
  const keyOk =
    typeof key === 'string' &&
    !key.includes('..') &&
    key.endsWith('manifest.json') &&
    ((key.startsWith(`review/${x.videoId}/`) && key.split('/').length === 4) || key === `${captionWorkPrefix(x.jobId)}manifest.json`);
  return (
    keyOk &&
    typeof x.language === 'string' &&
    LANGUAGE.test(x.language) &&
    typeof x.replace === 'boolean' &&
    typeof x.requestedBy === 'string' &&
    Number.isInteger(x.nextChunk) &&
    (x.nextChunk as number) >= 0 &&
    typeof x.model === 'string' &&
    /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(x.model) &&
    typeof x.dailyBudgetUsd === 'number' &&
    x.dailyBudgetUsd >= 0 &&
    (x.prompt === undefined || typeof x.prompt === 'string')
  );
}

export function captionJobMessage(payload: CaptionJobPayload, now = Date.now()) {
  return { id: crypto.randomUUID(), type: MessageType.CaptionJob, payload, timestamp: now };
}

interface AudioManifest {
  durationMs?: number;
  audio: Array<{ key: string; startMs: number; endMs: number }>;
}
interface PartialTranscript {
  jobId: string;
  chunksDone: number;
  segments: TranscriptSegment[];
}

/** Retryable: the step may succeed later. */
export class JobRetryableError extends Error {}
/** The job was cancelled or erased in api-videos: stop quietly. */
class JobStopped extends Error {}

async function secret(value: ErrorReporterEnv['INTERNAL_API_KEY']): Promise<string> {
  const v = value as string | { get(): Promise<string> } | undefined;
  return typeof v === 'string' ? v : ((await v?.get()) ?? '');
}

async function videos(env: CaptionJobEnv, jobId: string, step: 'progress' | 'finish', body: Record<string, unknown>): Promise<void> {
  if (!env.VIDEOS) throw new JobRetryableError('VIDEOS service binding missing');
  const res = await env.VIDEOS.fetch(`https://videos.internal/internal/captions/jobs/${encodeURIComponent(jobId)}/${step}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': await secret(env.INTERNAL_API_KEY) },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 404) throw new JobStopped(`job ${res.status === 404 ? 'gone' : 'no longer active'}`);
  if (!res.ok) throw new JobRetryableError(`api-videos ${step} answered ${res.status}`);
}

const progress = (env: CaptionJobEnv, jobId: string, status: CaptionJobStatus, done?: number, total?: number) =>
  videos(env, jobId, 'progress', { status, ...(done !== undefined ? { done } : {}), ...(total !== undefined ? { total } : {}) });

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export interface CaptionJobDeps {
  asr?: CaptionAsr;
  quranIndex?: (env: CaptionJobEnv, now: number) => Promise<QuranIndex | null>;
  now?: () => number;
}

type StepOutcome =
  | { status: 'next' }
  | { status: 'waiting_budget' }
  | { status: 'stale' }
  | { status: 'ready'; cues: number; quran: number; minutes: number }
  | { status: 'failed'; error: CaptionJobError };

async function readJson<T>(bucket: MediaBucket, key: string): Promise<{ value: T; etag?: string } | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return { value: JSON.parse(await object.text()) as T, ...(object.etag ? { etag: object.etag } : {}) };
}

/** One delivery's step of the job. Throws to retry (JobStopped: stop). */
export async function runCaptionJobStep(env: CaptionJobEnv, p: CaptionJobPayload, deps: CaptionJobDeps, logger: Logger, ctx?: ExecutionContextLike): Promise<StepOutcome> {
  const media = env.REVIEW_MEDIA;
  const subtitles = env.subtitles as DraftBucket | undefined;
  if (!media || !subtitles) throw new JobRetryableError('buckets not bound');
  const now = deps.now?.() ?? Date.now();

  const manifest = (await readJson<AudioManifest>(media, p.audioManifestKey))?.value;
  if (!manifest) return { status: 'failed', error: 'audio_unavailable' };
  const chunks = (manifest.audio ?? []).filter((c) => typeof c.key === 'string' && c.key.startsWith(p.audioManifestKey.replace(/manifest\.json$/, '')));
  if (!chunks.length) return { status: 'failed', error: 'no_speech' };

  const partialKey = captionWorkTranscriptKey(p.jobId);
  const partial = await readJson<PartialTranscript>(media, partialKey);
  const done = partial?.value.jobId === p.jobId ? partial.value.chunksDone : 0;
  // A duplicate of a delivery that already moved the job on
  if (p.nextChunk < done) return { status: 'stale' };
  const segments = partial?.value.jobId === p.jobId ? partial.value.segments : [];

  if (done < chunks.length) {
    const chunk = chunks[done]!;
    const seconds = Math.max(1, Math.ceil((chunk.endMs - chunk.startMs) / 1000));
    const estimate = neuronsFor(p.model, seconds, 0);
    const reserved = await reserveBudget(env.REPORTS_DB, p.dailyBudgetUsd / USD_PER_NEURON, estimate, now, CAPTIONS_FEATURE);
    if (!reserved) {
      await progress(env, p.jobId, 'waiting_budget', done, chunks.length);
      const day = new Date(now).toISOString().slice(0, 10);
      reportNeedsAction('processor', env, ctx, {
        key: `caption-budget:${day}`,
        source: 'queue',
        title: "Today's caption budget is spent",
        message: `Transcription jobs wait for tomorrow's budget ($${p.dailyBudgetUsd}/day). Raise the monthly caption budget to run them sooner.`,
        itemType: 'video',
        itemId: p.videoId,
        extra: { jobId: p.jobId, dailyBudgetUsd: p.dailyBudgetUsd },
      });
      return { status: 'waiting_budget' };
    }
    await progress(env, p.jobId, 'transcribing', done, chunks.length);
    const usage: Usage[] = [];
    let heard: TranscriptSegment[];
    try {
      const audio = await media.get(chunk.key);
      if (!audio) throw new ProviderError(`audio chunk missing: ${chunk.key}`, false);
      const asr = deps.asr ?? asrFor(env, p.model);
      heard = await asr.transcribe({ base64: toBase64(await audio.arrayBuffer()), startMs: chunk.startMs, durationMs: chunk.endMs - chunk.startMs }, p.language, p.prompt, usage);
    } finally {
      let spent = 0;
      for (const u of usage) {
        if (u.model.startsWith('fixture/')) continue;
        spent += await recordUsage(env.REPORTS_DB, logger, { model: u.model, inputTokens: u.inputUnits, outputTokens: u.outputUnits, surface: 'captions', feature: CAPTIONS_FEATURE }, now);
      }
      await settleBudget(env.REPORTS_DB, estimate, spent, now, CAPTIONS_FEATURE);
    }
    const next: PartialTranscript = { jobId: p.jobId, chunksDone: done + 1, segments: [...segments, ...heard] };
    // Only over the copy this delivery read: a duplicate that lost the race stops here
    const written = await media.put(partialKey, JSON.stringify(next), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf: partial?.etag ? { etagMatches: partial.etag } : { etagDoesNotMatch: '*' },
    });
    if (!written) return { status: 'stale' };
    return { status: 'next' };
  }

  // Every chunk is heard: the draft
  await progress(env, p.jobId, 'postprocessing', chunks.length, chunks.length);
  const cleaned = filterTranscript(segments);
  if (!cleaned.length) return { status: 'failed', error: 'no_speech' };
  // No fresh copy, no draft: recitation must never reach a draft as ASR text
  const index = await (deps.quranIndex ?? ((e, n) => loadQuranIndex(e.REVIEW_MEDIA, n)))(env, now);
  if (!index) throw new JobRetryableError('no fresh copy of the Quran text');
  const written = await writeTranscriptDraft(
    subtitles,
    index,
    {
      videoId: p.videoId,
      language: p.language,
      replace: p.replace,
      requestedBy: p.requestedBy,
      origin: 'transcription',
      machine: { provider: deps.asr?.provider ?? (env.CAPTION_PROVIDER === 'fixture' || env.REVIEW_PROVIDER === 'fixture' ? 'fixture' : 'workers-ai'), model: p.model },
      segments: cleaned as ReviewTranscriptFile['segments'],
    },
    new Date(now),
  );
  if (written.status === 'draft_exists') return { status: 'failed', error: 'draft_exists' };
  const audioMs = manifest.durationMs && manifest.durationMs > 0 ? manifest.durationMs : chunks[chunks.length - 1]!.endMs;
  return { status: 'ready', cues: written.cues, quran: written.quran, minutes: Math.max(1, Math.ceil(audioMs / 60_000)) };
}

function flagFailed(env: CaptionJobEnv, ctx: ExecutionContextLike | undefined, p: CaptionJobPayload, reason: string, attempts: number): void {
  reportNeedsAction('processor', env, ctx, {
    key: captionJobNeedsActionKey(p.jobId),
    source: 'queue',
    title: 'Caption job failed',
    message: reason.slice(0, 500),
    itemType: 'video',
    itemId: p.videoId,
    retry: { kind: 'service', service: 'api-videos', path: '/internal/captions/jobs/retry', body: { jobId: p.jobId } },
    retryLabel: 'Try again',
    extra: { jobId: p.jobId, language: p.language, attempts },
  });
}

export async function processCaptionJobMessages(messages: CaptionJobQueueMessage[], env: CaptionJobEnv, ctx: ExecutionContextLike | undefined, logger: Logger, deps: CaptionJobDeps = {}): Promise<void> {
  for (const message of messages) {
    const p = message.body?.payload;
    if (!isCaptionJobPayload(p)) {
      logger.warn('[Captions] Invalid caption job message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    const attempts = message.attempts ?? 1;
    const startedAt = Date.now();
    try {
      const outcome = await runCaptionJobStep(env, p, deps, logger, ctx);
      if (outcome.status === 'next') {
        if (!env.MESSAGE_QUEUE) throw new JobRetryableError('MESSAGE_QUEUE binding missing');
        await env.MESSAGE_QUEUE.send(captionJobMessage({ ...p, nextChunk: p.nextChunk + 1 }));
      } else if (outcome.status === 'waiting_budget') {
        if (!env.MESSAGE_QUEUE) throw new JobRetryableError('MESSAGE_QUEUE binding missing');
        await env.MESSAGE_QUEUE.send(captionJobMessage(p), { delaySeconds: BUDGET_WAIT_SECONDS });
        logger.warn('[Captions] Caption budget spent; the job waits', { jobId: p.jobId, videoId: p.videoId });
      } else if (outcome.status === 'ready') {
        await videos(env, p.jobId, 'finish', { outcome: 'ready', minutesUsed: outcome.minutes });
        logger.job({ job: 'caption-transcribe', outcome: 'ok', jobId: p.jobId, videoId: p.videoId, language: p.language, cues: outcome.cues, quran: outcome.quran, minutes: outcome.minutes, durationMs: Date.now() - startedAt });
      } else if (outcome.status === 'failed') {
        // The video's situation (no speech, a draft written meanwhile): Studio says what happened
        await videos(env, p.jobId, 'finish', { outcome: 'failed', error: outcome.error });
        logger.job({ job: 'caption-transcribe', outcome: 'refused', jobId: p.jobId, videoId: p.videoId, reason: outcome.error, durationMs: Date.now() - startedAt });
      }
      message.ack();
    } catch (error) {
      if (error instanceof JobStopped) {
        logger.info('[Captions] Caption job stopped', { jobId: p.jobId, reason: error.message });
        message.ack();
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof ProviderError) || error.retryable;
      if (retryable && attempts < CAPTION_JOB_LAST_ATTEMPT) {
        logger.warn('[Captions] Caption job step failed; retrying', { jobId: p.jobId, attempts, reason });
        message.retry({ delaySeconds: jobRetryDelaySeconds(attempts) });
        continue;
      }
      logger.error('[Captions] Caption job gave up', { jobId: p.jobId, videoId: p.videoId, attempts, reason });
      try {
        await videos(env, p.jobId, 'finish', { outcome: 'failed', error: 'transcription_failed' });
      } catch (finishError) {
        if (finishError instanceof JobStopped) {
          message.ack();
          continue;
        }
        logger.error('[Captions] Could not mark the caption job failed', { jobId: p.jobId, error: finishError instanceof Error ? finishError.message : String(finishError) });
      }
      flagFailed(env, ctx, p, reason, attempts);
      message.ack();
    }
  }
}
