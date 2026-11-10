/**
 * Soft delete for admin-managed configuration items (contact messages, custom
 * themes, creator tiers): an admin delete only marks the item deleted and
 * hides it everywhere. It can be restored for 30 days; the admin-api cleanup
 * (hourly, on its existing 5-minute cron) is the only code that deletes it for
 * good, once the 30 days are over or an admin asked for it to go now
 * ("Delete permanently now", which only queues it for the next cleanup).
 */

import { SOFT_DELETE_RETENTION_DAYS } from './admin-content';

/** The kinds the admin "Recently deleted" views and the cleanup handle. */
export const TRASH_KINDS = ['contact-message', 'theme', 'creator-tier'] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export const isTrashKind = (value: unknown): value is TrashKind => typeof value === 'string' && (TRASH_KINDS as readonly string[]).includes(value);

/** Longest reason an admin may give for a delete. */
export const TRASH_REASON_MAX = 500;

/** A deleted item as the "Recently deleted" view lists it. */
export interface TrashItem {
  kind: TrashKind;
  id: string;
  /** What the admin recognises it by (sender and topic, theme name, tier name) */
  title: string;
  /** The Arabic title, when the item has one (theme names) */
  titleAr?: string;
  deletedAt: string;
  deletedBy: string | null;
  reason: string | null;
  /** Set when an admin asked for it to be deleted permanently on the next cleanup */
  purgeRequestedAt: string | null;
  purgeRequestedBy: string | null;
  /** When the cleanup deletes it at the latest (deletedAt + 30 days) */
  purgeAfter: string;
}

const DAY_MS = 86_400_000;

/** deletedAt + 30 days, as an ISO string. */
export function purgeAfter(deletedAt: string, days = SOFT_DELETE_RETENTION_DAYS): string {
  return new Date(Date.parse(deletedAt) + days * DAY_MS).toISOString();
}

/** The latest deleted_at the cleanup purges at `now` (anything deleted at or before it is due). */
export function purgeCutoff(now: Date, days = SOFT_DELETE_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** Whole days left before the 30-day purge (0 when due). */
export function trashDaysLeft(deletedAt: string, now: Date, days = SOFT_DELETE_RETENTION_DAYS): number {
  return Math.max(0, Math.ceil((Date.parse(deletedAt) + days * DAY_MS - now.getTime()) / DAY_MS));
}

/** True when the cleanup should purge the item now. */
export function isTrashPurgeDue(item: { deletedAt: string | null; purgeRequestedAt: string | null }, now: Date, days = SOFT_DELETE_RETENTION_DAYS): boolean {
  if (!item.deletedAt) return false;
  return item.purgeRequestedAt !== null || Date.parse(item.deletedAt) <= now.getTime() - days * DAY_MS;
}

/** A delete reason as stored: trimmed, at most TRASH_REASON_MAX characters, null when empty. */
export function cleanTrashReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, TRASH_REASON_MAX);
  return text || null;
}
