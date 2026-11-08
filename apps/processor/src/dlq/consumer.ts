import type { Logger } from '@al-ummah/logger';
import type { QueueEnvironment } from '../types';
import { storeDeadLetter, toDeadLetterRecord } from './store';

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
 * Log every dead-lettered message as a structured alert and store it in D1.
 * A message is acked only once stored; when D1 is missing or failing it is
 * retried, so it stays in the DLQ (the DLQ consumer has no DLQ of its own).
 */
export async function processDeadLetterBatch(
  batch: { queue?: string; messages: DeadLetterQueueMessage[] },
  env: Pick<QueueEnvironment, 'NOTIFICATIONS_DB' | 'ENVIRONMENT'>,
  logger: Logger,
  now = Date.now()
): Promise<void> {
  const dlq = batch.queue ?? 'unknown';
  for (const message of batch.messages) {
    const record = toDeadLetterRecord(
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
    } catch (error) {
      logger.error('[DLQ] Failed to store dead letter', { id: record.id, error: error instanceof Error ? error.message : String(error) });
      message.retry();
    }
  }
}
