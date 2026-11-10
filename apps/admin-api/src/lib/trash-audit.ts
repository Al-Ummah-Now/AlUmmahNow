/**
 * Audit rows for soft deletes (lib/trash.ts): every delete, restore,
 * "Delete permanently now" request and cleanup purge of a contact message,
 * custom theme or creator tier appends a row to site_settings_log, keyed
 * `trash:<kind>:<id>`, with { action, reason? } as JSON in new_value.
 */
import type { TrashKind } from '@al-ummah/shared-types';

interface AuditDb {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export const TRASH_AUDIT_PREFIX = 'trash:';
export type TrashAction = 'delete' | 'restore' | 'purge-request' | 'purge';

export const trashAuditKey = (kind: TrashKind, id: string) => `${TRASH_AUDIT_PREFIX}${kind}:${id}`;

/** The cleanup's actor id on its audit rows. */
export const CLEANUP_ACTOR = 'system:trash-cleanup';

export async function writeTrashAudit(
  db: AuditDb,
  entry: { kind: TrashKind; id: string; action: TrashAction; actorId: string; reason?: string | null },
  now = new Date(),
): Promise<void> {
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(
      crypto.randomUUID(),
      trashAuditKey(entry.kind, entry.id),
      null,
      JSON.stringify({ action: entry.action, ...(entry.reason ? { reason: entry.reason } : {}) }),
      entry.actorId,
      now.toISOString(),
    )
    .run();
}
