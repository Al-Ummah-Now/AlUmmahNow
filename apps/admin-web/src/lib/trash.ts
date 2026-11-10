/**
 * Recently deleted areas of the admin (contact messages, themes, creator tiers): where each one
 * lives and who may see it. admin-api /api/trash enforces the permission; this only hides links
 * and pages the user cannot use (admins and super admins, never moderators).
 */
import { isTrashKind, trashDaysLeft, type TrashItem, type TrashKind } from '@al-ummah/shared-types';
import type { Translator } from '@/i18n/translate';
import { normalizeRole } from './roles';

/** The page each kind is deleted from (the Recently deleted page links back to it). */
export const TRASH_HOME: Record<TrashKind, string> = {
  'contact-message': '/contact',
  theme: '/site-theme',
  'creator-tier': '/creators/tiers',
};

export const trashHref = (kind: TrashKind) => `/recently-deleted/${kind}`;

export function canManageTrash(role?: string): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'super_admin';
}

/** The kind from the route, or null for anything else. */
export const parseTrashKind = (value: unknown): TrashKind | null => (isTrashKind(value) ? value : null);

/** The item's name in the admin's language (themes have an Arabic name). */
export function trashTitle(item: TrashItem, locale: string): string {
  return locale === 'ar' && item.titleAr ? item.titleAr : item.title;
}

/** "Queued for permanent deletion", "At the next cleanup" or "In N days". */
export function trashRemaining(item: TrashItem, now: Date, t: Translator): string {
  if (item.purgeRequestedAt) return t('trash.queued');
  const days = trashDaysLeft(item.deletedAt, now);
  return days === 0 ? t('trash.dueNow') : t('trash.daysLeft', { count: days });
}
