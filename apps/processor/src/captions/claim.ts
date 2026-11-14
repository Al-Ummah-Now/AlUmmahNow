/**
 * The creator claimed the video review's transcript as a caption draft (VR11, AlUmmahNow#1296).
 *
 * MessageType.CaptionClaimTranscript on the videos queue: read the transcript from the private
 * media bucket, run the AUN-CAPTIONS matcher over it with our Quran Foundation copy, and write a
 * draft whose Quran spans are references only (captions.ts). The draft lives in the subtitles
 * bucket, outside the review prefix, so it outlives the 30-day review media purge.
 *
 * Without a fresh copy of the Quran text the job waits and retries rather than write a draft whose
 * recitation would be ASR text. The last attempt marks the claim failed (Studio offers "Try again")
 * and flags the admin with a Retry.
 */
import type { Logger } from '@al-ummah/logger';
import {
  MessageType,
  captionClaimKey,
  captionCuesFromTranscript,
  captionDraftKey,
  matchQuran,
  reportNeedsAction,
  resolveNeedsAction,
  transcriptWords,
  validateCaptionCues,
  type CaptionClaimPayload,
  type CaptionClaimState,
  type CaptionDraft,
  type ErrorReporterEnv,
  type ExecutionContextLike,
  type ReviewTranscriptFile,
} from '@al-ummah/shared-types';
import { loadQuranIndex } from '../quran/review-matcher';

interface ReadBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}
interface WriteBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string }; onlyIf?: { etagDoesNotMatch?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export interface CaptionClaimEnv extends ErrorReporterEnv {
  /** Private media bucket: the review transcript and the Quran copy */
  REVIEW_MEDIA?: ReadBucket;
  subtitles?: unknown;
  MESSAGE_QUEUE?: { send(message: unknown): Promise<unknown> };
}

export interface CaptionClaimQueueMessage {
  body: { id?: string; type?: number; payload?: unknown };
  attempts?: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

/** The videos queue retries 3 times: the 4th attempt is the last. */
export const CLAIM_LAST_ATTEMPT = 4;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Retry delays: 2, 4, 8 minutes (the Quran copy may be syncing). */
export const claimRetryDelaySeconds = (attempts: number) => Math.min(1800, 120 * 2 ** Math.max(0, attempts - 1));

export const claimNeedsActionKey = (videoId: string, language: string) => `caption-claim:${videoId}:${language}`;

export function captionClaimMessage(payload: CaptionClaimPayload, now = Date.now()) {
  return { id: crypto.randomUUID(), type: MessageType.CaptionClaimTranscript, payload, timestamp: now };
}

export function isCaptionClaimMessage(message: { body?: { type?: unknown } | null }): boolean {
  return message.body?.type === MessageType.CaptionClaimTranscript;
}

export function isClaimPayload(p: unknown): p is CaptionClaimPayload {
  const x = p as Partial<CaptionClaimPayload> | null;
  return (
    !!x &&
    typeof x.videoId === 'string' &&
    SAFE_ID.test(x.videoId) &&
    typeof x.language === 'string' &&
    LANGUAGE.test(x.language) &&
    typeof x.transcriptKey === 'string' &&
    // Only a review transcript of this video
    x.transcriptKey.startsWith('review/') &&
    x.transcriptKey.endsWith('/transcript.json') &&
    x.transcriptKey.includes(`/${x.videoId}/`) &&
    !x.transcriptKey.includes('..') &&
    typeof x.requestedBy === 'string' &&
    typeof x.requestedAt === 'string'
  );
}

/** Retryable: the job may succeed later (no fresh Quran copy yet, a storage hiccup). */
export class ClaimRetryableError extends Error {}

type Outcome = { status: 'drafted'; cues: number; quran: number } | { status: 'failed'; error: CaptionClaimState['error'] };

/** Builds and writes the draft. Throws ClaimRetryableError (or any error) to retry. */
export async function runCaptionClaim(env: CaptionClaimEnv, p: CaptionClaimPayload, now = new Date()): Promise<Outcome> {
  const subtitles = env.subtitles as WriteBucket | undefined;
  if (!env.REVIEW_MEDIA || !subtitles) throw new ClaimRetryableError('buckets not bound');
  const object = await env.REVIEW_MEDIA.get(p.transcriptKey);
  if (!object) return { status: 'failed', error: 'transcript_gone' };
  const transcript = JSON.parse(await object.text()) as ReviewTranscriptFile;
  const segments = (transcript.segments ?? []).filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && typeof s.text === 'string');

  // No fresh copy, no draft: recitation must never reach a draft as ASR text
  const index = await loadQuranIndex(env.REVIEW_MEDIA, now.getTime());
  if (!index) throw new ClaimRetryableError('no fresh copy of the Quran text');

  const matches = matchQuran(index, transcriptWords(segments));
  const checked = validateCaptionCues(captionCuesFromTranscript(segments, matches));
  if (!checked.ok) throw new Error(`draft failed validation: ${(checked as Extract<typeof checked, { ok: false }>).error}`);
  const cues = (checked as Extract<typeof checked, { ok: true }>).cues;

  const at = now.toISOString();
  const draft: CaptionDraft = {
    v: 1,
    videoId: p.videoId,
    language: p.language,
    version: 1,
    kind: 'source',
    origin: 'review_transcript',
    edited: false,
    machine: { provider: 'review-transcript' },
    cues,
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
  const quran = cues.reduce((n, c) => n + c.segments.filter((s) => s.type === 'quran').length, 0);
  return { status: 'drafted', cues: cues.length, quran };
}

async function markClaim(env: CaptionClaimEnv, p: CaptionClaimPayload, error: CaptionClaimState['error'] | null): Promise<void> {
  const subtitles = env.subtitles as WriteBucket | undefined;
  if (!subtitles) return;
  const key = captionClaimKey(p.videoId, p.language);
  if (!error) {
    await subtitles.delete(key);
    return;
  }
  const state: CaptionClaimState = { language: p.language, status: 'failed', requestedAt: p.requestedAt, requestedBy: p.requestedBy, error };
  await subtitles.put(key, JSON.stringify(state), { httpMetadata: { contentType: 'application/json' } });
}

export async function processCaptionClaimMessages(messages: CaptionClaimQueueMessage[], env: CaptionClaimEnv, ctx: ExecutionContextLike | undefined, logger: Logger): Promise<void> {
  for (const message of messages) {
    const p = message.body?.payload;
    if (!isClaimPayload(p)) {
      logger.warn('[Captions] Invalid claim message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    const attempts = message.attempts ?? 1;
    const startedAt = Date.now();
    try {
      const outcome = await runCaptionClaim(env, p);
      if (outcome.status === 'failed') {
        // The creator's situation, not a fault: Studio says what happened
        await markClaim(env, p, (outcome as Extract<Outcome, { status: 'failed' }>).error);
        logger.job({ job: 'caption-claim', outcome: 'refused', videoId: p.videoId, language: p.language, reason: (outcome as Extract<Outcome, { status: 'failed' }>).error, durationMs: Date.now() - startedAt });
      } else {
        await markClaim(env, p, null);
        resolveNeedsAction(env, ctx, [claimNeedsActionKey(p.videoId, p.language)]);
        const done = outcome as Extract<Outcome, { status: 'drafted' }>;
        logger.job({ job: 'caption-claim', outcome: 'ok', videoId: p.videoId, language: p.language, cues: done.cues, quran: done.quran, durationMs: Date.now() - startedAt });
      }
      message.ack();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (attempts < CLAIM_LAST_ATTEMPT) {
        logger.warn('[Captions] Claim failed; retrying', { videoId: p.videoId, language: p.language, attempts, reason });
        message.retry({ delaySeconds: claimRetryDelaySeconds(attempts) });
        continue;
      }
      logger.error('[Captions] Claim gave up', { videoId: p.videoId, language: p.language, attempts, reason });
      await markClaim(env, p, 'failed').catch(() => undefined);
      reportNeedsAction('processor', env, ctx, {
        key: claimNeedsActionKey(p.videoId, p.language),
        source: 'queue',
        title: 'Caption draft from the review transcript failed',
        message: reason,
        itemType: 'video',
        itemId: p.videoId,
        retry: {
          kind: 'service',
          service: 'processor',
          path: '/internal/captions/claim',
          body: { videoId: p.videoId, language: p.language, transcriptKey: p.transcriptKey, requestedBy: p.requestedBy, replace: p.replace ? 1 : 0 },
        },
        retryLabel: 'Try again',
        extra: { language: p.language, attempts },
      });
      message.ack();
    }
  }
}

/** The body of POST /internal/captions/claim (the Errors page's Retry) → a new claim message. */
export function claimFromRetryBody(body: unknown, now = new Date()): CaptionClaimPayload | null {
  const b = body as Record<string, unknown> | null;
  const payload = {
    videoId: b?.videoId,
    language: b?.language,
    transcriptKey: b?.transcriptKey,
    requestedBy: b?.requestedBy,
    // Retry bodies carry strings: replace arrives as "1" / "0"
    replace: b?.replace === 1 || b?.replace === '1' || b?.replace === true,
    requestedAt: now.toISOString(),
  };
  return isClaimPayload(payload) ? payload : null;
}
