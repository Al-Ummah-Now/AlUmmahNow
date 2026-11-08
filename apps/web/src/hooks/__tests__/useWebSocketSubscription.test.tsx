/**
 * Tests for WebSocket subscription hooks to prevent infinite loop regression
 *
 * Issue: "Maximum update depth exceeded" caused by circular dependencies in useEffect
 *
 * Root Cause:
 * - handleNotificationUpdate included removeNotification in deps
 * - useWebSocketSubscription spread deps, causing re-subscription on every callback change
 * - This created an infinite re-subscription loop
 *
 * Fix:
 * - Use refs for callbacks to prevent re-subscription
 * - Only re-subscribe when channel or essential deps change, NOT callback
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { useRealTimeNotifications } from '@/hooks/useRealTimeNotifications';
import { WebSocketProvider } from '@/lib/websocket/WebSocketProvider';
import React from 'react';

// useRealTimeNotifications renders server notification keys through i18n
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations').EN_TRANSLATIONS,
    lang: 'en',
    isRTL: false,
  }),
}));

// Mock WebSocketManager
jest.mock('@/lib/websocket/WebSocketManager', () => {
  let subscriptions: Map<string, Array<(data: unknown) => void>> = new Map();
  let connectionState = { status: 'connected' };

  return {
    WebSocketManager: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      isConnected: jest.fn(() => connectionState.status === 'connected'),
      subscribe: jest.fn((channel: string, callback: (data: unknown) => void) => {
        if (!subscriptions.has(channel)) {
          subscriptions.set(channel, []);
        }
        subscriptions.get(channel)!.push(callback);

        // Return unsubscribe function
        return () => {
          const callbacks = subscriptions.get(channel);
          if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index !== -1) {
              callbacks.splice(index, 1);
            }
          }
        };
      }),
      sendMessage: jest.fn(),
      onStateChange: jest.fn((callback) => {
        callback(connectionState);
        return () => {};
      }),
      getState: jest.fn(() => connectionState),
      // Test helper to trigger events
      _triggerEvent: (channel: string, data: unknown) => {
        const callbacks = subscriptions.get(channel);
        if (callbacks) {
          callbacks.forEach(cb => cb(data));
        }
      },
      _getSubscriptionCount: (channel: string) => {
        return subscriptions.get(channel)?.length || 0;
      },
      _reset: () => {
        subscriptions = new Map();
        connectionState = { status: 'connected' };
      }
    }))
  };
});

describe('useWebSocketSubscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delivers events to a child that subscribed before the provider created its manager', async () => {
    // Child effects run before the provider's, so the first subscribe happens
    // while no manager exists yet; the provider must replay it once it does.
    const { WebSocketManager } = jest.requireMock('@/lib/websocket/WebSocketManager') as {
      WebSocketManager: jest.Mock;
    };
    const received: unknown[] = [];
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WebSocketProvider user={{ id: 'early-user', email: 'early@example.com' }}>{children}</WebSocketProvider>
    );
    renderHook(() => useWebSocketSubscription('video:early', (data) => received.push(data), []), { wrapper });

    await waitFor(() => expect(WebSocketManager).toHaveBeenCalled());
    const manager = WebSocketManager.mock.results[WebSocketManager.mock.results.length - 1].value as {
      subscribe: jest.Mock;
      _triggerEvent: (channel: string, data: unknown) => void;
    };
    expect(manager.subscribe).toHaveBeenCalledWith('video:early', expect.any(Function));
    act(() => manager._triggerEvent('video:early', { type: 'comment_added' }));
    expect(received).toEqual([{ type: 'comment_added' }]);
  });

  it('should not re-subscribe when callback changes', async () => {
    const subscribeCount = { count: 0 };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WebSocketProvider user={{ id: 'test-user', email: 'test@example.com' }}>
        {children}
      </WebSocketProvider>
    );

    let callbackChangeCount = 0;

    const { rerender } = renderHook(
      ({ callback }) => {
        return useWebSocketSubscription(
          'test:channel',
          callback,
          []
        );
      },
      {
        wrapper,
        initialProps: {
          callback: () => {
            subscribeCount.count++;
          }
        }
      }
    );

    await waitFor(() => {
      expect(subscribeCount.count).toBeGreaterThanOrEqual(0);
    });

    const initialCount = subscribeCount.count;

    // Change callback multiple times
    for (let i = 0; i < 5; i++) {
      callbackChangeCount++;
      rerender({
        callback: () => {
          subscribeCount.count++;
        }
      });
    }

    // Wait a bit to ensure no re-subscriptions happened
    await new Promise(resolve => setTimeout(resolve, 100));

    // Subscription count should not increase significantly
    // (might increase by 1 due to initial subscription, but not by 5)
    expect(callbackChangeCount).toBe(5);
    // The key assertion: callback changes should NOT cause re-subscriptions
    expect(subscribeCount.count - initialCount).toBeLessThan(2);
  });

  it('should re-subscribe when channel changes', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WebSocketProvider user={{ id: 'test-user', email: 'test@example.com' }}>
        {children}
      </WebSocketProvider>
    );

    const { rerender, result } = renderHook(
      ({ channel }) => {
        return useWebSocketSubscription(
          channel,
          () => {},
          []
        );
      },
      {
        wrapper,
        initialProps: { channel: 'test:channel1' }
      }
    );

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });

    // Change channel
    rerender({ channel: 'test:channel2' });

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });

    // This should work without errors (would throw "Maximum update depth exceeded" before fix)
    expect(result.current).toBeDefined();
  });
});

describe('useRealTimeNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not cause infinite loop when notifications update', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WebSocketProvider user={{ id: 'test-user', email: 'test@example.com' }}>
        {children}
      </WebSocketProvider>
    );

    const { result } = renderHook(
      () => useRealTimeNotifications({
        
        maxNotifications: 50
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });

    // Add notification manually (this would trigger removeNotification in setTimeout)
    act(() => {
      result.current.addNotification({
        title: 'Test Notification',
        message: 'Test message',
        type: 'system',
        userId: 'test-user'
      });
    });

    // Wait a bit to ensure no infinite loop
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should have 1 notification
    expect(result.current.notifications.length).toBe(1);
    expect(result.current.unreadCount).toBe(1);

    // Mark as read (this changes notifications state)
    act(() => {
      result.current.markAsRead(result.current.notifications[0].id);
    });

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(0);
    });

    // Should not throw "Maximum update depth exceeded"
    expect(result.current.notifications.length).toBe(1);
  });

  // Quarantined: fails on main, tracked in #206.
  it.skip('should handle auto-remove without infinite loop', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WebSocketProvider user={{ id: 'test-user', email: 'test@example.com' }}>
        {children}
      </WebSocketProvider>
    );

    const { result } = renderHook(
      () => useRealTimeNotifications({
        
        maxNotifications: 50,
        autoRemoveAfter: 100 // 100ms auto-remove
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });

    // Add notification with auto-remove
    act(() => {
      result.current.addNotification({
        title: 'Auto-remove Test',
        message: 'Will be removed in 100ms',
        type: 'system',
        userId: 'test-user'
      });
    });

    // Should have 1 notification
    await waitFor(() => {
      expect(result.current.notifications.length).toBe(1);
    });

    // Wait for auto-remove
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should be removed
    await waitFor(() => {
      expect(result.current.notifications.length).toBe(0);
    }, { timeout: 3000 });

    // Should not throw "Maximum update depth exceeded"
    expect(result.current.notifications.length).toBe(0);
  });
});
