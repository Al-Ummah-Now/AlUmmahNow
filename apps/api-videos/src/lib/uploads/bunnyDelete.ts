/**
 * Bunny delete after an owner delete (2026-11-10 incident).
 *
 * `DELETE /api/videos/:id` and the bulk delete removed only the R2 record:
 * the Bunny video stayed in the library forever and, when it was still
 * queued, Bunny still encoded it. The E2E cleanups delete every test upload
 * this way, so the shared QA/stage library grew to ~25,800 videos for ~290
 * records and our own throwaway encodes filled the library's encoding queue
 * (new uploads sat in Bunny status 2, progress 0, for many minutes).
 *
 * Now the delete endpoints queue one message per video on the
 * processing-check queue (kind `bunny-delete`, so it shares that queue's
 * retries and DLQ). The consumer deletes the Bunny video; idempotent: a 404
 * (already gone) is done, and a video whose record exists again is never
 * touched. Transient failures retry with backoff; after the last delivery the
 * queue dead-letters the message (processor DLQ consumer → dead_letters).
 */

import { logger } from '../logger';
import { deleteBunnyVideo, type ReaperEnv } from './reaper';

export const BUNNY_DELETE_KIND = 'bunny-delete';
/** Queue deliveries of one message: 1 + max_retries (wrangler: 5). */
export const BUNNY_DELETE_MAX_DELIVERIES = 6;

export interface BunnyDeleteMessage {
	kind: typeof BUNNY_DELETE_KIND;
	videoId: string;
	/** Who asked: owner-delete, bulk-delete, … (logs only) */
	reason: string;
	at: string;
}

type QueueLike = { send(body: unknown, options?: { delaySeconds?: number }): Promise<void> };
export type BunnyDeleteEnv = Pick<ReaperEnv, 'videos' | 'bunny-stream-key' | 'bunny_stream_library_id'>;

export function isBunnyDeleteMessage(body: unknown): body is BunnyDeleteMessage {
	return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === BUNNY_DELETE_KIND;
}

/**
 * Queues the Bunny delete of a video whose record was just deleted. Never
 * throws: the record is already gone, and a missed message only leaves the
 * Bunny video for the orphan sweep.
 */
export async function enqueueBunnyDelete(queue: QueueLike | undefined, videoId: string, reason: string, now = new Date()): Promise<boolean> {
	if (!queue) {
		logger.warn('[BunnyDelete] PROCESSING_CHECK_QUEUE is not bound; the Bunny video stays', { videoId, reason });
		return false;
	}
	try {
		await queue.send({ kind: BUNNY_DELETE_KIND, videoId, reason, at: now.toISOString() } satisfies BunnyDeleteMessage);
		return true;
	} catch (error) {
		logger.error('[BunnyDelete] Could not queue the Bunny delete', { videoId, reason, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/** Backoff between deliveries of a failing delete: 1 m, 4 m, 16 m, then hourly. */
export function bunnyDeleteRetryDelaySeconds(attempts: number): number {
	return Math.min(3600, 60 * 4 ** Math.max(0, attempts - 1));
}

interface QueueMessageLike<T> {
	body: T;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

export async function handleBunnyDeleteBatch(batch: { messages: readonly QueueMessageLike<unknown>[] }, env: BunnyDeleteEnv): Promise<void> {
	for (const msg of batch.messages) {
		const body = msg.body as BunnyDeleteMessage;
		if (!isBunnyDeleteMessage(body) || typeof body.videoId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.videoId)) {
			logger.error('[BunnyDelete] Malformed message dropped', { body });
			msg.ack();
			continue;
		}
		try {
			// The record is back (never expected): its Bunny video is in use
			if (await env.videos.head(body.videoId)) {
				logger.warn('[BunnyDelete] Record exists again; Bunny video kept', { videoId: body.videoId });
				msg.ack();
				continue;
			}
			const deleted = await deleteBunnyVideo(env as ReaperEnv, body.videoId);
			logger.info('[BunnyDelete] Done', { videoId: body.videoId, reason: body.reason, deleted, alreadyGone: !deleted });
			msg.ack();
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			const last = msg.attempts >= BUNNY_DELETE_MAX_DELIVERIES;
			logger[last ? 'error' : 'warn']('[BunnyDelete] Failed', { videoId: body.videoId, attempts: msg.attempts, last, error: text });
			// After the last delivery the queue dead-letters it
			msg.retry({ delaySeconds: bunnyDeleteRetryDelaySeconds(msg.attempts) });
		}
	}
}
