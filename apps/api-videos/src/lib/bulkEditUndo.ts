/**
 * Undo records of bulk edits (PATCH /api/videos/bulk): one KV entry per
 * edited video, kept for 24 hours.
 *
 *   bulk-edit-undo:<userId>:<operationId>:<videoId> → BulkUndoRecord
 *
 * The entry doubles as the idempotency marker: a retried request with the
 * same operation id finds it and skips the video, so an append or a
 * staggered schedule is never applied twice.
 *
 * Stored in the TUS_SESSIONS namespace under its own prefix (nothing lists
 * that namespace; entries expire on their own), so no new binding is needed
 * in every environment.
 */
import type { EditableField } from './bulkEdit';

export const BULK_UNDO_TTL_SECONDS = 24 * 60 * 60;
const PREFIX = 'bulk-edit-undo';

/** Client-chosen operation id: shared by the batches of one edit. */
export const OPERATION_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface BulkUndoRecord {
  at: string;
  before: Partial<Record<EditableField, unknown>>;
  after: Partial<Record<EditableField, unknown>>;
  /** Playlists this edit really added the video to, or removed it from */
  playlistsAdded: string[];
  playlistsRemoved: string[];
  /** Set once undone (kept so a repeated undo is a no-op) */
  undoneAt?: string;
}

export interface UndoKv {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Every undo record of one user starts with this (account erasure, lib/privacy/upload-traces.ts). */
export function undoUserPrefix(userId: string): string {
  return `${PREFIX}:${userId}:`;
}

export function undoKey(userId: string, operationId: string, videoId: string): string {
  return `${PREFIX}:${userId}:${operationId}:${videoId}`;
}

export async function readUndo(kv: UndoKv | undefined, userId: string, operationId: string, videoId: string): Promise<BulkUndoRecord | null> {
  if (!kv) return null;
  return ((await kv.get(undoKey(userId, operationId, videoId), 'json')) as BulkUndoRecord | null) ?? null;
}

export async function writeUndo(kv: UndoKv | undefined, userId: string, operationId: string, videoId: string, record: BulkUndoRecord): Promise<void> {
  if (!kv) return;
  await kv.put(undoKey(userId, operationId, videoId), JSON.stringify(record), { expirationTtl: BULK_UNDO_TTL_SECONDS });
}
