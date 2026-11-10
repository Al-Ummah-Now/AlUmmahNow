'use client';

import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/lib/logger-client';
import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';

export interface SubscriptionStatusResult {
  channelId: string;
  isSubscribed: boolean;
  subscriberCount: number;
}

interface SubscriptionApiResponse {
  success?: boolean;
  result?: SubscriptionStatusResult;
  error?: string;
}

export interface UseChannelSubscriptionOptions {
  /** Target channel id */
  channelId: string;
  /** Whether to query status (false for anonymous users / channel owners) */
  enabled: boolean;
  /** Initial subscriber count shown until the API responds */
  initialSubscriberCount?: number;
}

export interface UseChannelSubscriptionReturn {
  isSubscribed: boolean;
  subscriberCount: number | undefined;
  isChecking: boolean;
  isUpdating: boolean;
  error: string | null;
  toggle: () => Promise<boolean>;
}

/**
 * Subscription status + subscribe/unsubscribe for a channel, calling
 * api-videos directly from the browser with the active account's token.
 *
 * GET    /api/channels/:id/subscriptions/status
 * POST   /api/channels/:id/subscriptions
 * DELETE /api/channels/:id/subscriptions
 */
export function useChannelSubscription({
  channelId,
  enabled,
  initialSubscriberCount,
}: UseChannelSubscriptionOptions): UseChannelSubscriptionReturn {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState<number | undefined>(initialSubscriberCount);
  const [isChecking, setIsChecking] = useState(enabled);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubscriberCount(initialSubscriberCount);
  }, [initialSubscriberCount]);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!enabled || !channelId) {
        setIsChecking(false);
        return;
      }
      setIsChecking(true);
      try {
        const headers = await getClientAuthHeaders();
        const response = await fetch(`${getApiUrl()}/api/channels/${channelId}/subscriptions/status`, { headers });
        if (!response.ok) {
          logger.warn('[useChannelSubscription] Status request failed', { channelId, status: response.status });
          return;
        }
        const data: SubscriptionApiResponse = await response.json();
        if (!cancelled && data.result) {
          setIsSubscribed(data.result.isSubscribed);
          setSubscriberCount(data.result.subscriberCount);
        }
      } catch (err) {
        logger.error('[useChannelSubscription] Error checking subscription status', { channelId, error: err });
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [channelId, enabled]);

  const toggle = useCallback(async (): Promise<boolean> => {
    setIsUpdating(true);
    setError(null);
    const method = isSubscribed ? 'DELETE' : 'POST';
    try {
      const headers = await getClientAuthHeaders();
      if (!headers['Authorization']) {
        logger.warn('[useChannelSubscription] Missing auth token', { channelId });
        setError('auth');
        return false;
      }
      if (!headers['channelId']) {
        // Subscriptions are made by a channel; accounts without one must create it first
        logger.warn('[useChannelSubscription] No active channel for subscriber', { channelId });
        setError('channel');
        return false;
      }
      logger.debug('[useChannelSubscription] Updating subscription', { channelId, method });
      const response = await fetch(`${getApiUrl()}/api/channels/${channelId}/subscriptions`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
      const data: SubscriptionApiResponse = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        logger.error('[useChannelSubscription] Subscription update failed', { channelId, method, status: response.status, error: data.error });
        setError(data.error || 'request');
        return false;
      }
      setIsSubscribed(data.result?.isSubscribed ?? !isSubscribed);
      if (data.result) setSubscriberCount(data.result.subscriberCount);
      return true;
    } catch (err) {
      logger.error('[useChannelSubscription] Subscription update error', { channelId, method, error: err });
      setError('network');
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, [channelId, isSubscribed]);

  return { isSubscribed, subscriberCount, isChecking, isUpdating, error, toggle };
}
