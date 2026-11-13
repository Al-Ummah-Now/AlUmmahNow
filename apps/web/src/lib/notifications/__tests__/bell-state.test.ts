import type { NotificationItem } from '@al-ummah/shared-types';
import { applyMenuOpened, applyNewNotification, applyStateEvent, EMPTY_BELL, idsToReadOnOpen, needsSeenCall, showsBadge, type BellState } from '../bell-state';
import { unreadBadge } from '@/lib/navigation/destinations';

const item = (id: string, isRead = false): NotificationItem => ({
  id,
  category: 'comments',
  notificationType: 'comment',
  notificationKey: 'newComment',
  params: {},
  isRead,
  createdAt: '2026-11-13T00:00:00.000Z',
});

const state = (over: Partial<BellState> = {}): BellState => ({ ...EMPTY_BELL, unreadCount: 3, unseenCount: 2, latest: [item('a'), item('b'), item('c', true)], ...over });

describe('bell state', () => {
  it('badge = unseen, capped at 9+ (en and ar digits)', () => {
    expect(showsBadge({ unseenCount: 0 })).toBe(false);
    expect(showsBadge({ unseenCount: 1 })).toBe(true);
    expect(unreadBadge(3, 'en')).toBe('3');
    expect(unreadBadge(10, 'en')).toBe('9+');
    expect(unreadBadge(10, 'ar')).toMatch(/^[9٩]\+$/);
  });

  it('a new notification raises unread and unseen once', () => {
    const next = applyNewNotification(state(), item('d'), 8);
    expect([next.unreadCount, next.unseenCount, next.latest[0].id]).toEqual([4, 3, 'd']);
    expect(applyNewNotification(next, item('d'), 8)).toBe(next);
  });

  it('mode seen: opening clears the badge and leaves read state alone', () => {
    const s = state({ menuOpen: 'seen' });
    expect(idsToReadOnOpen('seen', s.latest)).toEqual([]);
    const next = applyMenuOpened(s, s.latest);
    expect([next.unseenCount, next.unreadCount]).toEqual([0, 3]);
    expect(next.latest.map((n) => n.isRead)).toEqual([false, false, true]);
  });

  it('mode read: opening also marks the shown unread notifications read', () => {
    const s = state({ menuOpen: 'read' });
    expect(idsToReadOnOpen('read', s.latest)).toEqual(['a', 'b']);
    const next = applyMenuOpened(s, s.latest);
    expect([next.unseenCount, next.unreadCount]).toEqual([0, 1]);
    expect(next.latest.every((n) => n.isRead)).toBe(true);
  });

  it('skips the server when nothing would change', () => {
    expect(needsSeenCall(state({ unseenCount: 0, menuOpen: 'seen' }), state().latest)).toBe(false);
    expect(needsSeenCall(state({ unseenCount: 0, menuOpen: 'read' }), state().latest)).toBe(true);
    expect(needsSeenCall(state({ unseenCount: 0, menuOpen: 'read' }), [item('x', true)])).toBe(false);
    expect(needsSeenCall(state({ unseenCount: 1 }), [])).toBe(true);
  });

  it('applies realtime state from another tab', () => {
    const cleared = applyStateEvent(state(), { unreadCount: 3, unseenCount: 0, seenAt: 'x' });
    expect([cleared.unseenCount, cleared.unreadCount]).toEqual([0, 3]);
    const read = applyStateEvent(state(), { unreadCount: 2, unseenCount: 1, readIds: ['a'] });
    expect(read.latest.map((n) => n.isRead)).toEqual([true, false, true]);
    const unread = applyStateEvent(state(), { unreadCount: 4, unseenCount: 2, unreadIds: ['c'] });
    expect(unread.latest[2].isRead).toBe(false);
    const all = applyStateEvent(state(), { unreadCount: 0, unseenCount: 0, allRead: true });
    expect(all.latest.every((n) => n.isRead)).toBe(true);
    const gone = applyStateEvent(state(), { unreadCount: 2, unseenCount: 1, deletedId: 'b' });
    expect(gone.latest.map((n) => n.id)).toEqual(['a', 'c']);
    // A malformed event keeps the counts
    expect(applyStateEvent(state(), { unreadCount: -1 } as never).unreadCount).toBe(3);
  });
});
