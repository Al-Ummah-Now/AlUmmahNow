/**
 * Bell state rules (2026-11-13): the badge counts what is new since the user last opened the
 * notification menu ("unseen"), read state stays per notification. Kept apart from React so the
 * rules are unit-tested (lib/notifications/__tests__/bell-state.test.ts).
 */
import type { NotificationItem, NotificationMenuOpenMode, NotificationStateEvent } from '@al-ummah/shared-types';
import { DEFAULT_NOTIFICATION_MENU_OPEN } from '@al-ummah/shared-types';

export interface BellState {
  unreadCount: number;
  unseenCount: number;
  menuOpen: NotificationMenuOpenMode;
  latest: NotificationItem[];
}

export const EMPTY_BELL: BellState = { unreadCount: 0, unseenCount: 0, menuOpen: DEFAULT_NOTIFICATION_MENU_OPEN, latest: [] };

const nonNegative = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback);

/** A realtime notification arrived: one more unread and unseen, newest first in the list. */
export function applyNewNotification(state: BellState, item: NotificationItem, max: number): BellState {
  if (state.latest.some((n) => n.id === item.id)) return state;
  return {
    ...state,
    unreadCount: state.unreadCount + 1,
    unseenCount: state.unseenCount + 1,
    latest: [item, ...state.latest].slice(0, max),
  };
}

/** Another tab or device changed the state (`notifications_state` on `user:<id>`). */
export function applyStateEvent(state: BellState, event: Partial<NotificationStateEvent>): BellState {
  const read = new Set(event.readIds ?? []);
  const unread = new Set(event.unreadIds ?? []);
  const latest = state.latest
    .filter((n) => n.id !== event.deletedId)
    .map((n) => {
      if (event.allRead || read.has(n.id)) return n.isRead ? n : { ...n, isRead: true };
      if (unread.has(n.id)) return n.isRead ? { ...n, isRead: false } : n;
      return n;
    });
  return {
    ...state,
    unreadCount: nonNegative(event.unreadCount, state.unreadCount),
    unseenCount: nonNegative(event.unseenCount, state.unseenCount),
    latest,
  };
}

/** Ids the menu marks read when it opens: the shown unread ones, in `read` mode only. */
export function idsToReadOnOpen(mode: NotificationMenuOpenMode, shown: NotificationItem[]): string[] {
  if (mode !== 'read') return [];
  return shown.filter((n) => !n.isRead).map((n) => n.id);
}

/** Whether opening the menu needs the server at all (saves a write when nothing changes). */
export function needsSeenCall(state: BellState, shown: NotificationItem[]): boolean {
  return state.unseenCount > 0 || idsToReadOnOpen(state.menuOpen, shown).length > 0;
}

/** Optimistic state right after the menu opened, before the server answers. */
export function applyMenuOpened(state: BellState, shown: NotificationItem[]): BellState {
  const ids = new Set(idsToReadOnOpen(state.menuOpen, shown));
  return {
    ...state,
    unseenCount: 0,
    unreadCount: Math.max(0, state.unreadCount - ids.size),
    latest: state.latest.map((n) => (ids.has(n.id) ? { ...n, isRead: true } : n)),
  };
}

/** Whether the badge shows at all. */
export function showsBadge(state: Pick<BellState, 'unseenCount'>): boolean {
  return state.unseenCount > 0;
}
