import type { ErrorStatus, NeedsActionStatus } from '@al-ummah/shared-types';
import { canManageErrors } from '@/lib/roles';

export type GroupAction = 'acknowledge' | 'resolve' | 'ignore' | 'reopen' | 'assignMe' | 'unassign' | 'note';
export type ItemAction = 'retry' | 'dismiss';

/** The group buttons a role may use in the group's current state. Read-only roles get none. */
export function groupActionsFor(role: string | undefined, group: { status: ErrorStatus; assignee_id: string | null }, viewerId: string | undefined): GroupAction[] {
  if (!canManageErrors(role)) return [];
  const actions: GroupAction[] = [];
  if (group.status === 'new') actions.push('acknowledge');
  if (group.status !== 'resolved') actions.push('resolve');
  if (group.status !== 'ignored' && group.status !== 'resolved') actions.push('ignore');
  if (group.status === 'resolved' || group.status === 'ignored') actions.push('reopen');
  if (group.assignee_id && group.assignee_id === viewerId) actions.push('unassign');
  else actions.push('assignMe');
  if (group.assignee_id && group.assignee_id !== viewerId) actions.push('unassign');
  actions.push('note');
  return actions;
}

/** Retry (only when admin-api has a retry for it) and Dismiss, for open items and errors:manage. */
export function itemActionsFor(role: string | undefined, item: { status: NeedsActionStatus; can_retry: boolean }): ItemAction[] {
  if (!canManageErrors(role)) return [];
  if (item.status !== 'open' && item.status !== 'retrying') return [];
  return item.can_retry ? ['retry', 'dismiss'] : ['dismiss'];
}

/** Where a needs-action item lives: its own link, else the public video page for a video. */
export function itemHref(item: { item_url: string | null; item_type: string | null; item_id: string | null }, webOrigin: string, locale: string): string | null {
  if (item.item_url) {
    if (item.item_url.startsWith('/') && !item.item_url.startsWith('//')) return item.item_url;
    try {
      const url = new URL(item.item_url);
      if (url.protocol === 'https:' && (url.hostname === 'alummahnow.net' || url.hostname.endsWith('.alummahnow.net'))) return url.toString();
    } catch {
      return null;
    }
    return null;
  }
  if (item.item_type === 'video' && item.item_id) return `${webOrigin.replace(/\/$/, '')}/${locale === 'ar' ? 'ar' : 'en'}/video/${encodeURIComponent(item.item_id)}`;
  return null;
}
