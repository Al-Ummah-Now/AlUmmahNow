/**
 * Transcript search index (AUN-CAPTIONS §5.10, P5): api-videos queues MessageType.TranscriptIndexSync
 * when a published caption track (`{videoId}/{language}.vtt` in the subtitles bucket) is written or
 * deleted. Here the stored WebVTT is read again (the bucket, not the message, is the truth, so a late
 * message never indexes an old file) and the track's passages are replaced in SEARCH_DB.
 *
 * Failures retry with backoff on the videos queue; the last attempt flags the admin Errors page with
 * a Retry (POST /internal/search/transcript), resolved by the next success.
 */
import type { Logger } from '@al-ummah/logger';
import {
  MessageType,
  TRANSCRIPT_TRACK_KEY,
  reportNeedsAction,
  resolveNeedsAction,
  syncTranscriptTrack,
  type ErrorReporterEnv,
  type ExecutionContextLike,
  type SearchDb,
  type TranscriptIndexSyncPayload,
} from '@al-ummah/shared-types';

interface ReadBucket {
  get(key: string): Promise<{ text(): Promise<string>; uploaded?: Date } | null>;
}

export interface TranscriptIndexEnv extends ErrorReporterEnv {
  SEARCH_DB?: unknown;
  subtitles?: unknown;
  MESSAGE_QUEUE?: { send(message: unknown): Promise<unknown> };
}

export interface TranscriptIndexQueueMessage {
  body: { id?: string; type?: number; payload?: unknown };
  attempts?: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

/** The videos queue retries 3 times: the 4th attempt is the last. */
export const TRANSCRIPT_INDEX_LAST_ATTEMPT = 4;

/** Retry delays: 30 s, 1 min, 2 min. */
export const transcriptIndexRetryDelaySeconds = (attempts: number) => Math.min(600, 30 * 2 ** Math.max(0, attempts - 1));

export const transcriptIndexNeedsActionKey = (videoId: string, language: string) => `transcript-index:${videoId}:${language}`;

export function transcriptIndexMessage(payload: TranscriptIndexSyncPayload, now = Date.now()) {
  return { id: crypto.randomUUID(), type: MessageType.TranscriptIndexSync, payload, timestamp: now };
}

export function isTranscriptIndexMessage(message: { body?: { type?: unknown } | null }): boolean {
  return message.body?.type === MessageType.TranscriptIndexSync;
}

export function isTranscriptIndexPayload(p: unknown): p is TranscriptIndexSyncPayload {
  const x = p as Partial<TranscriptIndexSyncPayload> | null;
  return (
    !!x &&
    typeof x.videoId === 'string' &&
    typeof x.language === 'string' &&
    TRANSCRIPT_TRACK_KEY.test(`${x.videoId}/${x.language}.vtt`) &&
    typeof x.version === 'number' &&
    Number.isFinite(x.version)
  );
}

/** Reads the track as stored now and replaces its passages. Throws to retry. */
export async function runTranscriptIndex(env: TranscriptIndexEnv, p: TranscriptIndexSyncPayload) {
  const db = env.SEARCH_DB as SearchDb | undefined;
  const bucket = env.subtitles as ReadBucket | undefined;
  if (!db || !bucket) throw new Error('SEARCH_DB or subtitles not bound');
  const object = await bucket.get(`${p.videoId}/${p.language}.vtt`);
  const vtt = object ? await object.text() : null;
  // The stored file's own time when there is one: a later write always indexes over this
  const version = object?.uploaded ? Math.max(p.version, new Date(object.uploaded).getTime()) : p.version;
  return syncTranscriptTrack(db, { videoId: p.videoId, language: p.language, version }, vtt);
}

export async function processTranscriptIndexMessages(
  messages: TranscriptIndexQueueMessage[],
  env: TranscriptIndexEnv,
  ctx: ExecutionContextLike | undefined,
  logger: Logger,
): Promise<void> {
  for (const message of messages) {
    const p = message.body?.payload;
    if (!isTranscriptIndexPayload(p)) {
      logger.warn('[TranscriptIndex] Invalid message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    const attempts = message.attempts ?? 1;
    const startedAt = Date.now();
    try {
      const result = await runTranscriptIndex(env, p);
      resolveNeedsAction(env, ctx, [transcriptIndexNeedsActionKey(p.videoId, p.language)]);
      logger.job({ job: 'transcript-index', outcome: result, videoId: p.videoId, language: p.language, durationMs: Date.now() - startedAt });
      message.ack();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (attempts < TRANSCRIPT_INDEX_LAST_ATTEMPT) {
        logger.warn('[TranscriptIndex] Index update failed; retrying', { videoId: p.videoId, language: p.language, attempts, reason });
        message.retry({ delaySeconds: transcriptIndexRetryDelaySeconds(attempts) });
        continue;
      }
      logger.error('[TranscriptIndex] Index update gave up', { videoId: p.videoId, language: p.language, attempts, reason });
      reportNeedsAction('processor', env, ctx, {
        key: transcriptIndexNeedsActionKey(p.videoId, p.language),
        source: 'queue',
        title: 'Transcript search index update failed',
        message: reason,
        itemType: 'video',
        itemId: p.videoId,
        retry: { kind: 'service', service: 'processor', path: '/internal/search/transcript', body: { videoId: p.videoId, language: p.language } },
        retryLabel: 'Try again',
        extra: { language: p.language, attempts },
      });
      message.ack();
    }
  }
}

/** The body of POST /internal/search/transcript (the Errors page's Retry) → a new message. */
export function transcriptIndexFromRetryBody(body: unknown, now = Date.now()): TranscriptIndexSyncPayload | null {
  const b = body as Record<string, unknown> | null;
  const payload = { videoId: b?.videoId, language: b?.language, version: now };
  return isTranscriptIndexPayload(payload) ? payload : null;
}
