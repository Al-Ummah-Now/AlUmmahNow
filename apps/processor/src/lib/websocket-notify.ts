/**
 * WebSocket notification helpers for the processor.
 *
 * Messages are POSTed to the websocket-server `/broadcast` endpoint
 * (authenticated with X-API-Key = INTERNAL_API_KEY) and delivered verbatim to
 * every client subscribed to `channel`. The envelope matches what the web
 * WebSocketManager routes on:
 *
 *   { type, channel, timestamp, data: { type, ...fields } }
 *
 * `data.type` is repeated because subscription callbacks only receive `data`.
 * User-facing text is never sent: notifications carry a `notificationKey` plus
 * `params`, and the web client renders them through i18n.
 */

import { logger } from './logger';

export type ApiKeyBinding = string | { get: () => Promise<string> } | { text: () => Promise<string> } | undefined;

export interface RealtimeEnv {
  WEBSOCKET_URL?: string;
  INTERNAL_API_KEY?: ApiKeyBinding;
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

export interface RealtimeMessage {
  type: string;
  channel: string;
  timestamp: number;
  data: Record<string, unknown> & { type: string };
}

export function buildRealtimeMessage(channel: string, type: string, data: Record<string, unknown>): RealtimeMessage {
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
      logger.warn('WebSocket broadcast rejected', { channel, status: response.status });
    }
    return response.ok;
  } catch (error) {
    logger.error('Failed to send WebSocket notification', { channel, error });
    return false;
  }
}

/**
 * Broadcast using the worker env. Silently skipped when realtime isn't configured.
 */
export async function broadcast(
  env: RealtimeEnv,
  channel: string,
  type: string,
  data: Record<string, unknown>
): Promise<boolean> {
  if (!env.WEBSOCKET_URL) return false;
  const apiKey = await getApiKey(env.INTERNAL_API_KEY);
  if (!apiKey) {
    logger.warn('INTERNAL_API_KEY not configured, skipping WebSocket broadcast', { channel, type });
    return false;
  }
  return sendWebSocketNotification(env.WEBSOCKET_URL, apiKey, channel, buildRealtimeMessage(channel, type, data));
}

export type ProcessingStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled';

/**
 * Notify a video's processing/upload status change on `video:<id>` and, for
 * terminal states, send a notification to the uploader on `user:<userId>`.
 */
export async function notifyVideoProcessing(
  env: RealtimeEnv,
  videoId: string,
  userId: string | undefined,
  status: ProcessingStatus,
  data: { title?: string | undefined; error?: string | undefined; duration?: number | undefined } = {}
): Promise<void> {
  const tasks: Array<Promise<boolean>> = [
    broadcast(env, `video:${videoId}`, 'video_processing_update', { videoId, status, ...data }),
  ];
  if (userId) {
    tasks.push(broadcast(env, `user:${userId}`, 'video_processing_update', { videoId, status, ...data }));
    if (status === 'ready' || status === 'failed') {
      tasks.push(broadcast(env, `user:${userId}`, 'notification', {
        notificationId: crypto.randomUUID(),
        userId,
        notificationType: 'upload',
        notificationKey: status === 'ready' ? 'uploadReady' : 'uploadFailed',
        params: { videoTitle: data.title || '' },
        actionUrl: `/video/${videoId}`,
      }));
    }
  }
  await Promise.all(tasks);
}

/**
 * Notify live stream lifecycle changes on the shared `live-streams` channel and
 * the owning channel's `channel:<id>` channel.
 */
export async function notifyLiveStream(
  env: RealtimeEnv,
  liveStreamId: string,
  data: { status?: string | undefined; channelId?: string | undefined; title?: string | undefined; event: 'created' | 'updated' }
): Promise<void> {
  const payload = { liveStreamId, ...data };
  const tasks = [broadcast(env, 'live-streams', 'live_stream_updated', payload)];
  if (data.channelId) {
    tasks.push(broadcast(env, `channel:${data.channelId}`, 'live_stream_updated', payload));
  }
  await Promise.all(tasks);
}
