/**
 * WebSocket notification helpers for api-videos.
 *
 * Messages are POSTed to the websocket-server `/broadcast` endpoint
 * (X-API-Key = INTERNAL_API_KEY) and delivered verbatim to every client
 * subscribed to `channel`. The envelope matches what the web WebSocketManager
 * routes on:
 *
 *   { type, channel, timestamp, data: { type, ...fields } }
 *
 * `data.type` is repeated because subscription callbacks only receive `data`.
 * Notifications carry a `notificationKey` + `params` instead of text so the web
 * client renders them in the viewer's language.
 *
 * Broadcasting always happens through `ctx.waitUntil` so it never delays or
 * fails the API response.
 */

import { logger } from './logger';

type ApiKeyBinding = string | { get: () => Promise<string> } | { text: () => Promise<string> } | undefined;

interface RealtimeEnv {
  WEBSOCKET_URL?: string;
  INTERNAL_API_KEY?: unknown;
}

interface WaitUntilContext {
  env: unknown;
  executionCtx?: { waitUntil(promise: Promise<unknown>): void };
}

/**
 * Get the API key value from a plain string or a Secrets Store binding.
 */
export async function getApiKey(apiKeyBinding: ApiKeyBinding): Promise<string> {
  if (!apiKeyBinding) return '';
  if (typeof apiKeyBinding === 'string') return apiKeyBinding;
  if ('get' in apiKeyBinding && typeof apiKeyBinding.get === 'function') return await apiKeyBinding.get();
  if ('text' in apiKeyBinding && typeof apiKeyBinding.text === 'function') return await apiKeyBinding.text();
  return '';
}

export function buildRealtimeMessage(channel: string, type: string, data: Record<string, unknown>) {
  return { type, channel, timestamp: Date.now(), data: { ...data, type } };
}

/**
 * POST a message to the websocket server. Never throws.
 */
export async function sendWebSocketNotification(
  websocketUrl: string,
  apiKey: string,
  channel: string,
  message: unknown
): Promise<boolean> {
  try {
    const response = await fetch(`${websocketUrl.replace(/\/$/, '')}/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ channel, message }),
    });
    if (!response.ok) {
      logger.warn('[realtime] Broadcast rejected', { channel, status: response.status });
    }
    return response.ok;
  } catch (error) {
    logger.error('[realtime] Failed to send WebSocket notification', { channel, error });
    return false;
  }
}

export async function broadcast(
  env: RealtimeEnv,
  channel: string,
  type: string,
  data: Record<string, unknown>
): Promise<boolean> {
  if (!env?.WEBSOCKET_URL) return false;
  const apiKey = await getApiKey(env.INTERNAL_API_KEY as ApiKeyBinding);
  if (!apiKey) {
    logger.warn('[realtime] INTERNAL_API_KEY not configured, skipping broadcast', { channel, type });
    return false;
  }
  return sendWebSocketNotification(env.WEBSOCKET_URL, apiKey, channel, buildRealtimeMessage(channel, type, data));
}

/**
 * Run realtime work after the response is sent. Any failure is logged only.
 */
export function inBackground(c: WaitUntilContext, label: string, work: () => Promise<unknown>): void {
  const task = (async () => {
    try {
      await work();
    } catch (error) {
      logger.warn('[realtime] Background notification failed', { label, error });
    }
  })();
  try {
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(task);
    }
  } catch {
    // Outside the Workers runtime (e.g. Node dev server) there is no execution context;
    // the task still runs to completion on its own.
  }
}

/** Fire-and-forget broadcast bound to the request's execution context. */
export function broadcastInBackground(
  c: WaitUntilContext,
  channel: string,
  type: string,
  data: Record<string, unknown>
): void {
  inBackground(c, `${type}@${channel}`, () => broadcast(c.env as RealtimeEnv, channel, type, data));
}

export type NotificationType = 'like' | 'comment' | 'subscription' | 'upload' | 'system';

export interface UserNotification {
  notificationType: NotificationType;
  notificationKey: string;
  params?: Record<string, string | number>;
  actionUrl?: string;
}

/** Send a notification on `user:<userId>` (awaitable; use inside background work). */
export async function notifyUser(env: unknown, userId: string, notification: UserNotification): Promise<boolean> {
  if (!userId) return false;
  return broadcast(env as RealtimeEnv, `user:${userId}`, 'notification', {
    notificationId: crypto.randomUUID(),
    userId,
    ...notification,
    params: notification.params || {},
  });
}

/** Fire-and-forget user notification on `user:<userId>`. */
export function notifyUserInBackground(c: WaitUntilContext, userId: string, notification: UserNotification): void {
  if (!userId) return;
  inBackground(c, `notification@user:${userId}`, () => notifyUser(c.env, userId, notification));
}
