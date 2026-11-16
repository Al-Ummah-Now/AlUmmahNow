/**
 * Account erasure, Contact us step (#616). Deletes the erased account's
 * Contact us messages and their staff notes and replies from REPORTS_DB
 * (admin-api migrations 0008/0010). Messages sent while signed out carry no
 * user id and are not linked to the account, so they are not touched.
 *
 * Idempotent: running it again deletes nothing more. It runs as its own
 * queue message (MessageType.ContactDataErase) so a failure retries with
 * backoff and finally dead-letters (processor DLQ → dead_letters), which the
 * admin Errors page lists under account erasure failures.
 */
import type { D1Database } from '../types';

export async function eraseUserContactData(db: D1Database, userId: string): Promise<{ messages: number; notes: number }> {
  if (!userId) throw new Error('ContactDataErase message missing required field: userId');
  const [notes, messages] = await db.batch([
    db.prepare('DELETE FROM contact_notes WHERE message_id IN (SELECT id FROM contact_messages WHERE user_id = ?) RETURNING id').bind(userId),
    db.prepare('DELETE FROM contact_messages WHERE user_id = ? RETURNING id').bind(userId),
  ]);
  // RETURNING rows count what was deleted (one transaction: both or neither)
  const count = (r: unknown) => ((r as { results?: unknown[] } | undefined)?.results ?? []).length;
  return { messages: count(messages), notes: count(notes) };
}

/** Erasure messages back off between attempts (30 s doubling, at most 10 min); others keep the queue default. */
export function erasureRetryDelaySeconds(type: number | undefined, attempts: number, erasureTypes: readonly number[]): number | undefined {
  if (type === undefined || !erasureTypes.includes(type)) return undefined;
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 600);
}
