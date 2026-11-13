import type { Logger } from '@al-ummah/logger';
import { reportNeedsAction, type ErrorReporterEnv, type ExecutionContextLike } from '@al-ummah/shared-types';
import type { QueueEnvironment } from '../types';
import { storeDeadLetter, toPrivateDeadLetterRecord, type DeadLetterRecord } from './store';

export interface DeadLetterQueueMessage {
  /** Queue message id (Cloudflare Queues). */
  id?: string;
  body: unknown;
  attempts?: number;
  ack: () => void;
  retry: () => void;
}

/** A DLQ batch: queue names end in `-dlq`, `-dlq-qa` or `-dlq-stage`. */
export function isDeadLetterQueue(queue: string | undefined): boolean {
  return !!queue && /(^|-)dlq(-|$)/.test(queue);
}

/**
 * Flags a stored dead letter on the admin Errors page, with a Replay action
 * (admin-api → processor POST /dlq/replay). Same key on a redelivery, so one item.
 */
export function flagDeadLetter(env: ErrorReporterEnv, ctx: ExecutionContextLike | undefined, record: DeadLetterRecord): void {
  // A Contact us email that failed for good: admin-api already flags it with a
  // Retry that queues the email again (lib/contact-mail-queue.ts); a Replay here could not send it
  if (record.type_name === 'contact_mail') return;
  // A new upload's playlist add: api-videos flags it with a Retry that queues the add again
  // (lib/playlistUploadAdds.ts); a Replay here could not run it
  if (record.body_json.includes('"kind":"playlist-add"')) return;
  reportNeedsAction('processor', env, ctx, {
    key: `dlq:${record.id}`.slice(0, 160),
    source: 'dlq',
    title: record.source === 'moderation' ? 'Moderation scan dead-lettered' : `Queue message dead-lettered (${record.type_name})`,
    message: record.failure_reason || `Gave up after ${record.attempts} attempts`,
    itemType: 'dead-letter',
    itemId: record.message_id ?? record.id,
    ...(record.source === 'moderation' ? { itemUrl: '/moderation' } : {}),
    retry: { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id: record.id } },
    retryLabel: 'Replay message',
    extra: { dlq: record.dlq, type: record.type_name, attempts: record.attempts },
  });
}

/**
 * Log every dead-lettered message as a structured alert, store it in D1 and
 * flag it on the admin Errors page (needs action, with Replay).
 * A message is acked only once stored; when D1 is missing or failing it is
 * retried, so it stays in the DLQ (the DLQ consumer has no DLQ of its own).
 */
export async function processDeadLetterBatch(
  batch: { queue?: string; messages: DeadLetterQueueMessage[] },
  env: Pick<QueueEnvironment, 'NOTIFICATIONS_DB' | 'ENVIRONMENT'> & ErrorReporterEnv,
  logger: Logger,
  now = Date.now(),
  ctx?: ExecutionContextLike
): Promise<void> {
  const dlq = batch.queue ?? 'unknown';
  for (const message of batch.messages) {
    const record = await toPrivateDeadLetterRecord(
      { queueMessageId: message.id ?? `${dlq}:${now}:${Math.random().toString(36).slice(2)}`, dlq, attempts: message.attempts ?? 1, body: message.body },
      now
    );
    // The alert: one structured error per dead-lettered message.
    logger.error('[DLQ] Message dead-lettered', {
      alert: 'queue_dead_letter',
      environment: env.ENVIRONMENT,
      dlq,
      id: record.id,
      messageId: record.message_id,
      type: record.type_name,
      source: record.source,
      failureReason: record.failure_reason,
    });
    if (!env.NOTIFICATIONS_DB) {
      logger.error('[DLQ] NOTIFICATIONS_DB not bound; dead letter kept in the queue', { id: record.id });
      message.retry();
      continue;
    }
    try {
      await storeDeadLetter(env.NOTIFICATIONS_DB, record);
      message.ack();
      flagDeadLetter(env, ctx, record);
    } catch (error) {
      logger.error('[DLQ] Failed to store dead letter', { id: record.id, error: error instanceof Error ? error.message : String(error) });
      message.retry();
    }
  }
}
