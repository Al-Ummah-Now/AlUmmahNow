/**
 * Dead-letter visibility. Each environment's DLQ (al-ummah-now-dlq[-stage|-qa])
 * is consumed by the processor: every message is logged as a structured
 * `[DLQ] Message dead-lettered` error (the alert, searchable in Workers Logs)
 * and kept in the NOTIFICATIONS_DB `dead_letters` table so it can be queried
 * and replayed (POST /dlq/replay) instead of silently expiring in the queue.
 */
import { MessageType, type AlUmmahMessage, type D1Database } from '../types';

/** Bodies above this are stored truncated (and cannot be replayed). */
export const DEAD_LETTER_MAX_BODY = 64 * 1024;
/** Rows older than this are purged by the daily cron. */
export const DEAD_LETTER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeadLetterInput {
  /** Queue message id of the DLQ delivery. */
  queueMessageId: string;
  dlq: string;
  attempts: number;
  body: unknown;
}

export interface DeadLetterRecord {
  id: string;
  message_id: string | null;
  message_type: number | null;
  type_name: string;
  /** 'admin-jobs' dead letters are retried from admin (the job's Retry), never replayed here. */
  source: 'videos' | 'moderation' | 'admin-jobs';
  dlq: string;
  attempts: number;
  failure_reason: string | null;
  body_json: string;
  body_truncated: number;
  received_at: number;
  replayed_at: number | null;
}

function asMessage(body: unknown): Partial<AlUmmahMessage> {
  return body && typeof body === 'object' ? (body as Partial<AlUmmahMessage>) : {};
}

export function toDeadLetterRecord(input: DeadLetterInput, now: number): DeadLetterRecord {
  const message = asMessage(input.body);
  const type = typeof message.type === 'number' ? message.type : null;
  let json: string;
  try {
    json = JSON.stringify(input.body ?? null) ?? 'null';
  } catch {
    json = JSON.stringify(String(input.body));
  }
  const truncated = json.length > DEAD_LETTER_MAX_BODY;
  return {
    id: input.queueMessageId,
    message_id: typeof message.id === 'string' ? message.id : null,
    message_type: type,
    type_name: type !== null ? (MessageType[type] ?? String(type)) : typeof message.type === 'string' ? message.type : 'unknown',
    source: type === MessageType.ModerationScan ? 'moderation' : type === MessageType.AdminJob ? 'admin-jobs' : 'videos',
    dlq: input.dlq,
    attempts: input.attempts,
    failure_reason: typeof message.failureReason === 'string' ? message.failureReason.slice(0, 1000) : null,
    body_json: truncated ? json.slice(0, DEAD_LETTER_MAX_BODY) : json,
    body_truncated: truncated ? 1 : 0,
    received_at: now,
    replayed_at: null,
  };
}

/** Insert (idempotent on the queue message id, so a DLQ redelivery is not stored twice). */
export async function storeDeadLetter(db: D1Database, record: DeadLetterRecord): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO dead_letters
         (id, message_id, message_type, type_name, source, dlq, attempts, failure_reason, body_json, body_truncated, received_at, replayed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .bind(
      record.id,
      record.message_id,
      record.message_type,
      record.type_name,
      record.source,
      record.dlq,
      record.attempts,
      record.failure_reason,
      record.body_json,
      record.body_truncated,
      record.received_at
    )
    .run();
}

export async function listDeadLetters(
  db: D1Database,
  opts: { limit?: number; includeReplayed?: boolean } = {}
): Promise<DeadLetterRecord[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const where = opts.includeReplayed ? '' : 'WHERE replayed_at IS NULL';
  const result = await db.prepare(`SELECT * FROM dead_letters ${where} ORDER BY received_at DESC LIMIT ?`).bind(limit).all<DeadLetterRecord>();
  return result.results ?? [];
}

export type ReplayOutcome =
  | { status: 'replayed'; messageId: string | null }
  | { status: 'not_found' | 'already_replayed' | 'not_replayable'; reason?: string };

/**
 * Re-send one stored dead letter to the processor's own queue (MESSAGE_QUEUE).
 * The row is claimed first (replayed_at set only if still NULL), so two
 * concurrent replays cannot both send. Moderation scans are not replayable:
 * the processor has no producer binding for the moderation queue.
 */
export async function replayDeadLetter(
  db: D1Database,
  queue: { send: (message: AlUmmahMessage) => Promise<void> } | undefined,
  id: string,
  now = Date.now()
): Promise<ReplayOutcome> {
  const row = await db.prepare('SELECT * FROM dead_letters WHERE id = ?').bind(id).first<DeadLetterRecord>();
  if (!row) return { status: 'not_found' };
  if (row.replayed_at !== null && row.replayed_at !== undefined) return { status: 'already_replayed' };
  if (row.source !== 'videos') return { status: 'not_replayable', reason: 'only videos-queue messages can be replayed' };
  if (row.body_truncated) return { status: 'not_replayable', reason: 'body was truncated' };
  if (!queue) return { status: 'not_replayable', reason: 'MESSAGE_QUEUE not bound' };

  let body: AlUmmahMessage;
  try {
    body = JSON.parse(row.body_json) as AlUmmahMessage;
  } catch {
    return { status: 'not_replayable', reason: 'body is not valid JSON' };
  }
  if (!body || typeof body !== 'object' || typeof body.type !== 'number' || !body.id) {
    return { status: 'not_replayable', reason: 'body is not a queue message' };
  }

  const claim = await db.prepare('UPDATE dead_letters SET replayed_at = ? WHERE id = ? AND replayed_at IS NULL').bind(now, id).run();
  const changes = (claim.meta as { changes?: number } | undefined)?.changes;
  if (changes === 0) return { status: 'already_replayed' };

  // Drop the failure bookkeeping so the replay starts with a clean retry budget.
  const clean: AlUmmahMessage = { ...body };
  delete clean.failureReason;
  delete clean.failedAt;
  delete clean.retryCount;
  try {
    await queue.send(clean);
  } catch (error) {
    // Release the claim so the replay can be tried again.
    await db.prepare('UPDATE dead_letters SET replayed_at = NULL WHERE id = ?').bind(id).run();
    throw error;
  }
  return { status: 'replayed', messageId: body.id };
}

export async function purgeExpiredDeadLetters(db: D1Database, now = Date.now()): Promise<number> {
  const result = await db.prepare('DELETE FROM dead_letters WHERE received_at < ?').bind(now - DEAD_LETTER_RETENTION_MS).run();
  return (result.meta as { changes?: number } | undefined)?.changes ?? 0;
}
