/**
 * Queue handling and sweeps for AI category suggestions.
 *
 * CategorySuggest messages arrive on the moderation queue (api-videos) or the
 * videos queue (admin-api retries/backfill, DLQ replays); both route here by
 * message type. Retries back off (30 s, 60 s, 120 s); a message that fails on
 * its last attempt is retried once more, which hands it to the DLQ, where it is
 * stored and alerted (src/dlq) while its row stays flagged `failed` in admin.
 */
import type { Logger } from '@al-ummah/logger';
import { CATEGORY_DRAFT_TTL_MS, MessageType, type CategorySuggestPayload, type SearchDb } from '@al-ummah/shared-types';
import { handleCategorySuggest, isCategorizePayload, type CategorizeEnv } from './job';

/** Matches max_retries of the moderation and videos consumers in the wrangler configs. */
export const CATEGORIZE_MAX_RETRIES = 3;
const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 600;
/** Pending rows older than this are re-sent by the hourly sweep (a lost or failed enqueue). */
export const STALE_PENDING_MS = 60 * 60_000;
const SWEEP_LIMIT = 200;

export interface CategorizeQueueMessage {
  id?: string;
  body: { id?: string; type?: number; payload?: unknown };
  attempts?: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

export function retryDelaySeconds(attempts: number): number {
  return Math.min(MAX_DELAY_SECONDS, BASE_DELAY_SECONDS * 2 ** Math.max(0, attempts - 1));
}

export function isCategorizeMessage(message: { body?: { type?: unknown } | null }): boolean {
  return message.body?.type === MessageType.CategorySuggest;
}

export async function processCategorizeMessages(messages: CategorizeQueueMessage[], env: CategorizeEnv, logger: Logger): Promise<void> {
  for (const message of messages) {
    const payload = message.body?.payload;
    if (!isCategorizePayload(payload)) {
      logger.warn('[Categorize] Invalid message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    const attempts = message.attempts ?? 1;
    try {
      const outcome = await handleCategorySuggest(payload, env, logger, { lastAttempt: attempts > CATEGORIZE_MAX_RETRIES });
      if (outcome.status === 'retry') message.retry({ delaySeconds: retryDelaySeconds(attempts) });
      // Last attempt: the row is flagged `failed`; one more retry moves the message to the DLQ (stored + alerted)
      else if (outcome.status === 'failed') message.retry();
      else message.ack();
    } catch (error) {
      // D1/R2 failure before the row could be updated: retry, then DLQ
      logger.error('[Categorize] Job failed', { id: message.body?.id, subjectId: payload.subjectId, attempts, error: error instanceof Error ? error.message : String(error) });
      message.retry({ delaySeconds: retryDelaySeconds(attempts) });
    }
  }
}

type Producer = { send(message: unknown): Promise<unknown>; sendBatch?(messages: Array<{ body: unknown }>): Promise<unknown> };

export function categorizeMessage(payload: CategorySuggestPayload, now: number = Date.now()) {
  return { id: crypto.randomUUID(), type: MessageType.CategorySuggest, payload, timestamp: now };
}

async function sendAll(queue: Producer, payloads: CategorySuggestPayload[], now: number): Promise<void> {
  const bodies = payloads.map((p) => categorizeMessage(p, now));
  for (let i = 0; i < bodies.length; i += 100) {
    const chunk = bodies.slice(i, i + 100);
    if (queue.sendBatch) await queue.sendBatch(chunk.map((body) => ({ body })));
    else for (const body of chunk) await queue.send(body);
  }
}

/**
 * Hourly: re-send video suggestions still `pending` an hour after their last
 * change (the producer's enqueue failed, or the message was lost).
 * Daily (after the UTC budget reset): re-send `budget` rows.
 * Also deletes upload-form draft rows past their TTL.
 */
export async function sweepCategorySuggestions(
  db: SearchDb | undefined,
  queue: Producer | undefined,
  logger: Logger,
  opts: { budget: boolean; now?: number },
): Promise<{ requeued: number; draftsPurged: number }> {
  const now = opts.now ?? Date.now();
  if (!db || !queue) return { requeued: 0, draftsPurged: 0 };
  const status = opts.budget ? 'budget' : 'pending';
  const cutoff = opts.budget ? now : now - STALE_PENDING_MS;
  const { results } = await db
    .prepare("SELECT subject_id FROM category_suggestions WHERE subject_type = 'video' AND status = ? AND updated_at < ? ORDER BY updated_at LIMIT ?")
    .bind(status, cutoff, SWEEP_LIMIT)
    .all<{ subject_id: string }>();
  const ids = (results ?? []).map((r) => r.subject_id);
  if (ids.length) {
    // Touch first so the next sweep does not re-send them while they are queued
    await db.batch(ids.map((id) => db.prepare("UPDATE category_suggestions SET status = 'pending', updated_at = ? WHERE subject_id = ?").bind(now, id)));
    await sendAll(queue, ids.map((subjectId) => ({ subjectId, subjectType: 'video' as const, reason: 'retry' as const })), now);
    logger.info('[Categorize] Sweep re-sent suggestions', { status, requeued: ids.length });
  }
  let draftsPurged = 0;
  if (opts.budget) {
    const purge = await db
      .prepare("DELETE FROM category_suggestions WHERE subject_type = 'draft' AND updated_at < ? RETURNING subject_id")
      .bind(now - CATEGORY_DRAFT_TTL_MS)
      .all();
    draftsPurged = purge.results?.length ?? 0;
  }
  return { requeued: ids.length, draftsPurged };
}
