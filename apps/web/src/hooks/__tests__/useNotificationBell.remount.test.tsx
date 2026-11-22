import { renderHook, act, waitFor } from '@testing-library/react';

let resolveCounts: ((v: { unreadCount: number; unseenCount: number }) => void) | null = null;
jest.mock('@/services/api/notifications', () => ({
  NotificationsService: {
    counts: jest.fn(() => new Promise((resolve) => { resolveCounts = resolve; })),
    list: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('@/lib/websocket/WebSocketProvider', () => ({ useWebSocketSubscription: () => undefined }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: () => undefined, error: () => undefined } }));

import { useNotificationBell } from '../useNotificationBell';

const answer = async (unseenCount: number) => {
  await waitFor(() => expect(resolveCounts).not.toBeNull());
  await act(async () => { resolveCounts!({ unreadCount: unseenCount, unseenCount }); resolveCounts = null; });
};

// An identity switch refreshes the page: the bell can remount, or see no user for a render. Its badge
// must not blink out until the counts come back (AUDIT-2 2026-11-21)
describe('useNotificationBell across a refresh', () => {
  it('keeps the badge when the bell remounts for the same user', async () => {
    const first = renderHook(() => useNotificationBell('u1'));
    await answer(4);
    expect(first.result.current.unseenCount).toBe(4);
    first.unmount();

    const again = renderHook(() => useNotificationBell('u1'));
    expect(again.result.current.unseenCount).toBe(4);
    await answer(5);
    expect(again.result.current.unseenCount).toBe(5);
    again.unmount();
  });

  it('keeps the badge through a render with no user', async () => {
    const hook = renderHook(({ id }: { id?: string }) => useNotificationBell(id), { initialProps: { id: 'u2' } });
    await answer(3);
    hook.rerender({ id: undefined });
    expect(hook.result.current.unseenCount).toBe(0);
    hook.rerender({ id: 'u2' });
    expect(hook.result.current.unseenCount).toBe(3);
    await answer(3);
    hook.unmount();
  });

  it("never shows one account's badge to another", async () => {
    const hook = renderHook(({ id }: { id: string }) => useNotificationBell(id), { initialProps: { id: 'u3' } });
    await answer(7);
    hook.rerender({ id: 'u4' });
    expect(hook.result.current.unseenCount).toBe(0);
    await answer(1);
    expect(hook.result.current.unseenCount).toBe(1);
    hook.unmount();

    const other = renderHook(() => useNotificationBell('u5'));
    expect(other.result.current.unseenCount).toBe(0);
    await answer(0);
    other.unmount();
  });
});
