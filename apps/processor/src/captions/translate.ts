/**
 * Transcript translation (AUN-CAPTIONS §5.7): MessageType.CaptionTranslate on the videos queue.
 *
 * api-videos owns the job (row, minutes, status); this consumer does the work and reports through
 * `/internal/captions/jobs/:jobId/progress|finish`, like transcription (job.ts):
 *
 * 1. The source is the creator's draft at the version the job was asked for (the draft, or the
 *    copy kept when that version was published). With no draft in that language (TA-20: captions
 *    imported or uploaded as a file) it is the copy of the published track api-videos made when it
 *    sent the job: its Quran markers become references again, and a track without any (a file) goes
 *    through the Quran matcher first, so recitation is found and kept out of the model. Those cues
 *    are written once (`captions-work/<jobId>/source.json`) so every batch reads the same ones.
 *    Quran segments become ⟦Qn⟧ tokens: Quran is never machine-translated.
 * 2. One delivery translates ONE batch of cues (≤ 6,000 characters, previous 3 cues as context),
 *    keeps it in the partial output (`captions-work/<jobId>/translation.json`, written only over the
 *    copy it read) and sends the message on. The answer is checked; a failed check retries the
 *    model once, then the fallback model, then the batch fails (and the queue retries it).
 * 3. Each batch reserves its cost from the day's caption budget (shared with transcription); when
 *    it is spent the job waits (`waiting_budget`) and the admin is told once a day.
 * 4. The last delivery writes the translated draft (kind `translation`, the source version, Quran
 *    spans as references). The creator reviews and publishes it in Studio.
 *
 * 409/404 from api-videos: the job was cancelled or erased, the work stops. The last attempt fails
 * the job (its minutes come back) and flags the admin with a Retry.
 */
import type { Logger } from '@al-ummah/logger';
import {
  MessageType,
  batchMaskedCues,
  captionCuesFromTranscript,
  captionCuesFromVtt,
  captionDraftKey,
  captionPublishedSourceKey,
  captionSourceWorkKey,
  matchQuran,
  transcriptWords,
  captionDraftVersionKey,
  captionTranslateWorkKey,
  captionWorkPrefix,
  checkTranslatedBatch,
  maskCues,
  reportNeedsAction,
  unmaskCue,
  validateCaptionCues,
  type CaptionDraft,
  type CaptionJobError,
  type CaptionJobStatus,
  type CaptionTranslatePayload,
  type D1Database,
  type ErrorReporterEnv,
  type ExecutionContextLike,
  type QuranIndex,
} from '@al-ummah/shared-types';
import { loadQuranIndex } from '../quran/review-matcher';
import { reserveBudget, settleBudget } from '../moderation/budget';
import { USD_PER_NEURON, neuronsFor } from '../moderation/pricing';
import { recordUsage } from '../moderation/usage';
import { ProviderError, type Usage } from '../review/provider';
import { CAPTIONS_FEATURE, CAPTION_JOB_LAST_ATTEMPT, BUDGET_WAIT_SECONDS, jobRetryDelaySeconds, captionJobNeedsActionKey } from './job';
import { translatorFor, type Translator, type TranslatorEnv } from './translator';

interface StoredObject {
  text(): Promise<string>;
  etag?: string;
}
interface Bucket {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string }; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }): Promise<unknown>;
  list?(options: { prefix: string; cursor?: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
  delete?(keys: string | string[]): Promise<void>;
}

export interface CaptionTranslateEnv extends ErrorReporterEnv, TranslatorEnv {
  REPORTS_DB: D1Database;
  REVIEW_MEDIA?: Bucket;
  subtitles?: unknown;
  VIDEOS?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  MESSAGE_QUEUE?: { send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown> };
}

export interface CaptionTranslateQueueMessage {
  body: { id?: string; type?: number; payload?: unknown };
  attempts?: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

const SAFE_JOB_ID = /^[A-Za-z0-9-]{8,64}$/;
const SAFE_VIDEO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;
const MODEL = /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i;

export const isCaptionTranslateMessage = (m: { body?: { type?: unknown } | null }) => m.body?.type === MessageType.CaptionTranslate;

export function isCaptionTranslatePayload(p: unknown): p is CaptionTranslatePayload {
  const x = p as Partial<CaptionTranslatePayload> | null;
  return (
    !!x &&
    typeof x.jobId === 'string' &&
    SAFE_JOB_ID.test(x.jobId) &&
    typeof x.videoId === 'string' &&
    SAFE_VIDEO_ID.test(x.videoId) &&
    typeof x.sourceLanguage === 'string' &&
    LANGUAGE.test(x.sourceLanguage) &&
    typeof x.language === 'string' &&
    LANGUAGE.test(x.language) &&
    x.language !== x.sourceLanguage &&
    Number.isInteger(x.sourceVersion) &&
    (x.sourceVersion as number) >= 1 &&
    (x.source === undefined || x.source === 'draft' || x.source === 'published') &&
    Number.isInteger(x.nextBatch) &&
    (x.nextBatch as number) >= 0 &&
    typeof x.replace === 'boolean' &&
    typeof x.requestedBy === 'string' &&
    (x.provider === 'workers-ai' || x.provider === 'deepl') &&
    typeof x.model === 'string' &&
    (MODEL.test(x.model) || x.model === 'deepl-pro') &&
    typeof x.fallbackModel === 'string' &&
    MODEL.test(x.fallbackModel) &&
    typeof x.dailyBudgetUsd === 'number' &&
    x.dailyBudgetUsd >= 0
  );
}

export const captionTranslateMessage = (payload: CaptionTranslatePayload, now = Date.now()) => ({ id: crypto.randomUUID(), type: MessageType.CaptionTranslate, payload, timestamp: now });

class Stopped extends Error {}
const withoutDeepl = (env: CaptionTranslateEnv): TranslatorEnv => ({ ...env, AI_KEY_DEEPL: '' });
class Retryable extends Error {}

async function secret(value: ErrorReporterEnv['INTERNAL_API_KEY']): Promise<string> {
  const v = value as string | { get(): Promise<string> } | undefined;
  return typeof v === 'string' ? v : ((await v?.get()) ?? '');
}

async function report(env: CaptionTranslateEnv, jobId: string, step: 'progress' | 'finish', body: Record<string, unknown>): Promise<void> {
  if (!env.VIDEOS) throw new Retryable('VIDEOS service binding missing');
  const res = await env.VIDEOS.fetch(`https://videos.internal/internal/captions/jobs/${encodeURIComponent(jobId)}/${step}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': await secret(env.INTERNAL_API_KEY) },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 404) throw new Stopped(`job ${res.status === 404 ? 'gone' : 'no longer active'}`);
  if (!res.ok) throw new Retryable(`api-videos ${step} answered ${res.status}`);
}

const progress = (env: CaptionTranslateEnv, jobId: string, status: CaptionJobStatus, done?: number, total?: number) =>
  report(env, jobId, 'progress', { status, ...(done !== undefined ? { done } : {}), ...(total !== undefined ? { total } : {}) });

interface PartialOutput {
  jobId: string;
  batchesDone: number;
  texts: Record<string, string>;
  provider?: string;
  model?: string;
}

/** The source draft at the version the job translates; null when that version is gone. */
export async function readSource(subtitles: Bucket, p: Pick<CaptionTranslatePayload, 'videoId' | 'sourceLanguage' | 'sourceVersion'>): Promise<CaptionDraft | null> {
  const current = await subtitles.get(captionDraftKey(p.videoId, p.sourceLanguage));
  if (current) {
    const draft = JSON.parse(await current.text()) as CaptionDraft;
    if (draft.version === p.sourceVersion) return draft;
  }
  const kept = await subtitles.get(captionDraftVersionKey(p.videoId, p.sourceLanguage, p.sourceVersion));
  return kept ? (JSON.parse(await kept.text()) as CaptionDraft) : null;
}

/**
 * The cues of the published track the job translates (TA-20): the processor's own copy when an
 * earlier delivery made it, else the track api-videos copied, read once. A track with Quran markers
 * was published from a draft (its spans were already found and reviewed); one without any is a file,
 * so the Quran matcher runs over it and what it finds becomes references (suggestions the creator
 * confirms). No fresh Quran copy: Retryable, never a translation of recitation. Null when the copy is gone.
 */
export async function readPublishedSource(
  media: Bucket,
  p: Pick<CaptionTranslatePayload, 'jobId' | 'videoId' | 'sourceLanguage' | 'sourceVersion' | 'requestedBy'>,
  quranIndex: () => Promise<QuranIndex | null>,
  now: number,
): Promise<CaptionDraft | null> {
  const workKey = captionSourceWorkKey(p.jobId);
  const made = await media.get(workKey);
  if (made) return JSON.parse(await made.text()) as CaptionDraft;
  const copy = await media.get(captionPublishedSourceKey(p.jobId));
  if (!copy) return null;
  let cues = captionCuesFromVtt(await copy.text());
  if (!cues.length) return null;
  if (!cues.some((c) => c.segments.some((s) => s.type === 'quran'))) {
    const index = await quranIndex();
    if (!index) throw new Retryable('no fresh copy of the Quran text');
    const segments = cues.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.segments.map((s) => (s.type === 'speech' ? s.text : '')).join(' ').trim() }));
    cues = captionCuesFromTranscript(segments, matchQuran(index, transcriptWords(segments)));
  }
  const checked = validateCaptionCues(cues);
  if (!checked.ok) throw new ProviderError(`published source failed validation: ${(checked as Extract<typeof checked, { ok: false }>).error}`, false);
  const at = new Date(now).toISOString();
  const draft: CaptionDraft = {
    v: 1,
    videoId: p.videoId,
    language: p.sourceLanguage,
    version: p.sourceVersion,
    kind: 'source',
    origin: 'transcription',
    edited: true,
    cues: (checked as Extract<typeof checked, { ok: true }>).cues,
    createdAt: at,
    updatedAt: at,
    updatedBy: p.requestedBy,
  };
  // Written only when absent: a parallel delivery's cues win, and both then read those
  const written = await media.put(workKey, JSON.stringify(draft), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
  if (written) return draft;
  const winner = await media.get(workKey);
  return winner ? (JSON.parse(await winner.text()) as CaptionDraft) : draft;
}

export interface TranslateDeps {
  translator?: Translator;
  now?: () => number;
  /** The Quran matcher's index (tests); default: the fresh copy in the private media bucket */
  quranIndex?: () => Promise<QuranIndex | null>;
}

type Outcome = { status: 'next' } | { status: 'waiting_budget' } | { status: 'stale' } | { status: 'ready'; cues: number } | { status: 'failed'; error: CaptionJobError };

/** Rough tokens of a batch (input: prompt + text + context; output: the text again). */
const estimateTokens = (chars: number) => ({ input: Math.ceil(chars / 2) + 700, output: Math.ceil(chars / 1.5) + 200 });

/**
 * Translates one batch with the model, retrying the model once and then the fallback on a failed
 * check (§5.7). Returns the translated texts or throws (the queue retries).
 */
async function translateBatch(
  env: CaptionTranslateEnv,
  p: CaptionTranslatePayload,
  batch: ReturnType<typeof batchMaskedCues>[number],
  translator: Translator,
  usage: Usage[],
  logger: Logger,
): Promise<{ texts: Map<string, string>; model: string; provider: string }> {
  const ctx = { ...(p.context?.title ? { title: p.context.title } : {}), ...(p.context?.channel ? { channel: p.context.channel } : {}) };
  const attempts: Array<{ t: Translator; model: string }> = [
    { t: translator, model: p.model },
    { t: translator, model: p.model },
  ];
  // DeepL falls back to Workers AI; Workers AI to its fallback model
  const fallback = translator.provider === 'deepl' ? await translatorFor(withoutDeepl(env), 'workers-ai') : translator;
  attempts.push({ t: fallback, model: p.fallbackModel });
  let last = 'no_attempt';
  for (const a of attempts) {
    const answer = await a.t.translate(batch, p.sourceLanguage, p.language, ctx, a.model, usage);
    const checked = checkTranslatedBatch(batch.items, answer, p.language);
    if (checked.ok) return { texts: checked.texts, model: a.model, provider: a.t.provider };
    last = (checked as Extract<typeof checked, { ok: false }>).reason;
    logger.warn('[Captions] Translated batch failed its check', { jobId: p.jobId, model: a.model, reason: last });
  }
  throw new ProviderError(`translation failed its checks: ${last}`, true);
}

/** One delivery's step. Throws to retry (Stopped: stop). */
export async function runTranslateStep(env: CaptionTranslateEnv, p: CaptionTranslatePayload, deps: TranslateDeps, logger: Logger, ctx?: ExecutionContextLike): Promise<Outcome> {
  const media = env.REVIEW_MEDIA;
  const subtitles = env.subtitles as Bucket | undefined;
  if (!media || !subtitles) throw new Retryable('buckets not bound');
  const now = deps.now?.() ?? Date.now();

  const published = p.source === 'published';
  const source = published
    ? await readPublishedSource(media, p, deps.quranIndex ?? (() => loadQuranIndex(env.REVIEW_MEDIA, now)), now)
    : await readSource(subtitles, p);
  if (!source) return { status: 'failed', error: published ? 'source_missing' : 'source_changed' };
  const { masked, passthrough } = maskCues(source.cues);
  const batches = batchMaskedCues(masked);

  const workKey = captionTranslateWorkKey(p.jobId);
  const stored = await media.get(workKey);
  const partial: PartialOutput | null = stored ? (JSON.parse(await stored.text()) as PartialOutput) : null;
  const done = partial?.jobId === p.jobId ? partial.batchesDone : 0;
  if (p.nextBatch < done) return { status: 'stale' };
  const texts = partial?.jobId === p.jobId ? partial.texts : {};

  if (done < batches.length) {
    const batch = batches[done]!;
    const chars = batch.items.reduce((n, i) => n + i.text.length, 0) + batch.context.reduce((n, i) => n + i.text.length, 0);
    const tok = estimateTokens(chars);
    const estimate = p.provider === 'deepl' ? neuronsFor('deepl-pro', chars, 0) : neuronsFor(p.model, tok.input, tok.output) * 2;
    if (!(await reserveBudget(env.REPORTS_DB, p.dailyBudgetUsd / USD_PER_NEURON, estimate, now, CAPTIONS_FEATURE))) {
      await progress(env, p.jobId, 'waiting_budget', done, batches.length);
      const day = new Date(now).toISOString().slice(0, 10);
      reportNeedsAction('processor', env, ctx, {
        key: `caption-budget:${day}`,
        source: 'queue',
        title: "Today's caption budget is spent",
        message: `Caption jobs wait for tomorrow's budget ($${p.dailyBudgetUsd}/day). Raise the monthly caption budget to run them sooner.`,
        itemType: 'video',
        itemId: p.videoId,
        extra: { jobId: p.jobId, dailyBudgetUsd: p.dailyBudgetUsd },
      });
      return { status: 'waiting_budget' };
    }
    await progress(env, p.jobId, 'translating', done, batches.length);
    const usage: Usage[] = [];
    let result: Awaited<ReturnType<typeof translateBatch>>;
    try {
      result = await translateBatch(env, p, batch, deps.translator ?? (await translatorFor(env, p.provider)), usage, logger);
    } finally {
      let spent = 0;
      for (const u of usage) {
        if (u.model.startsWith('fixture/')) continue;
        spent += await recordUsage(env.REPORTS_DB, logger, { model: u.model, inputTokens: u.inputUnits, outputTokens: u.outputUnits, surface: 'caption-translate', feature: CAPTIONS_FEATURE }, now);
      }
      await settleBudget(env.REPORTS_DB, estimate, spent, now, CAPTIONS_FEATURE);
    }
    const next: PartialOutput = { jobId: p.jobId, batchesDone: done + 1, texts: { ...texts, ...Object.fromEntries(result.texts) }, provider: result.provider, model: result.model };
    const written = await media.put(workKey, JSON.stringify(next), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf: stored?.etag ? { etagMatches: stored.etag } : { etagDoesNotMatch: '*' },
    });
    if (!written) return { status: 'stale' };
    return { status: 'next' };
  }

  // Every batch is translated: the draft
  await progress(env, p.jobId, 'postprocessing', batches.length, batches.length);
  const byId = new Map(masked.map((m) => [m.id, m]));
  const cues = source.cues.map((c) => (passthrough.has(c.id) ? unmaskCue(c, undefined, undefined) : unmaskCue(c, byId.get(c.id), texts[c.id])));
  const checked = validateCaptionCues(cues);
  if (!checked.ok) throw new ProviderError(`translated draft failed validation: ${(checked as Extract<typeof checked, { ok: false }>).error}`, false);
  const at = new Date(now).toISOString();
  const draft: CaptionDraft = {
    v: 1,
    videoId: p.videoId,
    language: p.language,
    version: 1,
    kind: 'translation',
    sourceLanguage: p.sourceLanguage,
    // From a published track there is no source draft version to compare with (TA-20)
    ...(published ? { sourceTrack: 'published' as const } : { sourceVersion: p.sourceVersion }),
    origin: 'translation',
    edited: false,
    machine: { provider: partial?.provider ?? p.provider, model: partial?.model ?? p.model },
    cues: (checked as Extract<typeof checked, { ok: true }>).cues,
    createdAt: at,
    updatedAt: at,
    updatedBy: p.requestedBy,
  };
  const key = captionDraftKey(p.videoId, p.language);
  if (p.replace) {
    const existing = await subtitles.get(key);
    if (existing) draft.version = ((JSON.parse(await existing.text()) as CaptionDraft).version ?? 0) + 1;
    await subtitles.put(key, JSON.stringify(draft), { httpMetadata: { contentType: 'application/json' } });
  } else {
    const written = await subtitles.put(key, JSON.stringify(draft), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
    if (!written) return { status: 'failed', error: 'draft_exists' };
  }
  return { status: 'ready', cues: draft.cues.length };
}

async function clearWork(env: CaptionTranslateEnv, jobId: string): Promise<void> {
  const media = env.REVIEW_MEDIA;
  if (!media?.list || !media.delete) return;
  let cursor: string | undefined;
  do {
    const page = await media.list({ prefix: captionWorkPrefix(jobId), ...(cursor ? { cursor } : {}) });
    if (page.objects.length) await media.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function processCaptionTranslateMessages(messages: CaptionTranslateQueueMessage[], env: CaptionTranslateEnv, ctx: ExecutionContextLike | undefined, logger: Logger, deps: TranslateDeps = {}): Promise<void> {
  for (const message of messages) {
    const p = message.body?.payload;
    if (!isCaptionTranslatePayload(p)) {
      logger.warn('[Captions] Invalid caption translate message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    const attempts = message.attempts ?? 1;
    const startedAt = Date.now();
    try {
      const outcome = await runTranslateStep(env, p, deps, logger, ctx);
      if (outcome.status === 'next' || outcome.status === 'waiting_budget') {
        if (!env.MESSAGE_QUEUE) throw new Retryable('MESSAGE_QUEUE binding missing');
        if (outcome.status === 'next') await env.MESSAGE_QUEUE.send(captionTranslateMessage({ ...p, nextBatch: p.nextBatch + 1 }));
        else await env.MESSAGE_QUEUE.send(captionTranslateMessage(p), { delaySeconds: BUDGET_WAIT_SECONDS });
      } else if (outcome.status === 'ready') {
        await report(env, p.jobId, 'finish', { outcome: 'ready', minutesUsed: 0 });
        await clearWork(env, p.jobId).catch(() => undefined);
        logger.job({ job: 'caption-translate', outcome: 'ok', jobId: p.jobId, videoId: p.videoId, from: p.sourceLanguage, to: p.language, source: p.source ?? 'draft', cues: outcome.cues, durationMs: Date.now() - startedAt });
      } else if (outcome.status === 'failed') {
        await report(env, p.jobId, 'finish', { outcome: 'failed', error: outcome.error });
        logger.job({ job: 'caption-translate', outcome: 'refused', jobId: p.jobId, videoId: p.videoId, reason: outcome.error, durationMs: Date.now() - startedAt });
      }
      message.ack();
    } catch (error) {
      if (error instanceof Stopped) {
        logger.info('[Captions] Caption translate job stopped', { jobId: p.jobId, reason: error.message });
        await clearWork(env, p.jobId).catch(() => undefined);
        message.ack();
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof ProviderError) || error.retryable;
      if (retryable && attempts < CAPTION_JOB_LAST_ATTEMPT) {
        logger.warn('[Captions] Caption translate step failed; retrying', { jobId: p.jobId, attempts, reason });
        message.retry({ delaySeconds: jobRetryDelaySeconds(attempts) });
        continue;
      }
      logger.error('[Captions] Caption translate job gave up', { jobId: p.jobId, videoId: p.videoId, attempts, reason });
      try {
        await report(env, p.jobId, 'finish', { outcome: 'failed', error: 'translation_failed' });
      } catch (finishError) {
        if (finishError instanceof Stopped) {
          message.ack();
          continue;
        }
        logger.error('[Captions] Could not mark the translate job failed', { jobId: p.jobId, error: finishError instanceof Error ? finishError.message : String(finishError) });
      }
      reportNeedsAction('processor', env, ctx, {
        key: captionJobNeedsActionKey(p.jobId),
        source: 'queue',
        title: 'Caption translation failed',
        message: reason.slice(0, 500),
        itemType: 'video',
        itemId: p.videoId,
        retry: { kind: 'service', service: 'api-videos', path: '/internal/captions/jobs/retry', body: { jobId: p.jobId } },
        retryLabel: 'Try again',
        extra: { jobId: p.jobId, from: p.sourceLanguage, to: p.language, source: p.source ?? 'draft', attempts },
      });
      message.ack();
    }
  }
}
