'use server';

/**
 * Recently deleted (admin-api /api/trash): contact messages, themes and creator tiers that an
 * admin deleted in the last 30 days. Restore brings one back; "Delete permanently now" queues it
 * for the next hourly cleanup, which is the only thing that removes it for good.
 */
import type { TrashItem, TrashKind } from '@al-ummah/shared-types';
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';

const path = (kind: TrashKind, id?: string, action?: 'restore' | 'purge') =>
  `/api/trash/${encodeURIComponent(kind)}${id ? `/${encodeURIComponent(id)}` : ''}${action ? `/${action}` : ''}`;

export async function listTrash(kind: TrashKind): Promise<TrashItem[]> {
  return (await fetchAdmin<{ items: TrashItem[] }>(path(kind))).items;
}

export async function restoreTrashItem(kind: TrashKind, id: string): Promise<ActionResult<{ restored: string }>> {
  return toResult(() => fetchAdmin<{ restored: string }>(path(kind, id, 'restore'), { method: 'POST' }));
}

export async function purgeTrashItem(kind: TrashKind, id: string): Promise<ActionResult<{ queued: string }>> {
  return toResult(() => fetchAdmin<{ queued: string }>(path(kind, id, 'purge'), { method: 'POST' }));
}
