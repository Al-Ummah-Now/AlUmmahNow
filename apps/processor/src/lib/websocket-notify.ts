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

/** Most events per batched /broadcast call (the websocket server accepts up to 1000). */
export const REALTIME_BATCH = 500;

/**
 * Broadcast many events with one /broadcast call per REALTIME_BATCH of them
 * (`{ items: [...] }`). Never throws. Returns the number of events in calls
 * the server accepted.
 */
export async function broadcastMany(
  env: RealtimeEnv,
  events: Array<{ channel: string; type: string; data: Record<string, unknown> }>,
): Promise<number> {
  if (!env.WEBSOCKET_URL || events.length === 0) return 0;
  const apiKey = await getApiKey(env.INTERNAL_API_KEY);
  if (!apiKey) {
    logger.warn('INTERNAL_API_KEY not configured, skipping WebSocket broadcast', { events: events.length });
    return 0;
  }
  let sent = 0;
  for (let i = 0; i < events.length; i += REALTIME_BATCH) {
    const chunk = events.slice(i, i + REALTIME_BATCH);
    try {
      const response = await fetch(`${env.WEBSOCKET_URL.replace(/\/$/, '')}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ items: chunk.map((e) => ({ channel: e.channel, message: buildRealtimeMessage(e.channel, e.type, e.data) })) }),
      });
      if (response.ok) sent += chunk.length;
      else logger.warn('WebSocket batch broadcast rejected', { events: chunk.length, status: response.status });
    } catch (error) {
      logger.error('Failed to send WebSocket batch broadcast', { events: chunk.length, error });
    }
  }
  return sent;
}

export type ProcessingStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled';

/**
 * Where the uploader's processing notification leads: a ready video opens on
 * its watch page; a failed one opens in the studio (its edit page) to fix it.
 */
export function uploadResultActionUrl(videoId: string, status: 'ready' | 'failed'): string {
  return status === 'ready' ? `/video/${videoId}` : `/video/${videoId}/edit`;
}

/**
 * Notify a video's processing/upload status change on `video:<id>` and, for
 * terminal states, send a notification to the uploader on `user:<userId>`.
 */
export async function notifyVideoProcessing(
  env: RealtimeEnv,
  videoId: string,
  userId: string | undefined,
  status: ProcessingStatus,
  data: { title?: string | undefined; error?: string | undefined; duration?: number | undefined } = {},
  /**
   * Id of the stored notification for terminal states. `null` means the
   * uploader disabled upload notifications (no notification is pushed);
   * undefined (no store configured) pushes one with a random id.
   */
  notificationId?: string | null
): Promise<void> {
  const tasks: Array<Promise<boolean>> = [
    broadcast(env, `video:${videoId}`, 'video_processing_update', { videoId, status, ...data }),
  ];
  if (userId) {
    tasks.push(broadcast(env, `user:${userId}`, 'video_processing_update', { videoId, status, ...data }));
    if ((status === 'ready' || status === 'failed') && notificationId !== null) {
      tasks.push(broadcast(env, `user:${userId}`, 'notification', {
        notificationId: notificationId ?? crypto.randomUUID(),
        persisted: !!notificationId,
        userId,
        notificationType: 'upload',
        notificationKey: status === 'ready' ? 'uploadReady' : 'uploadFailed',
        params: { videoTitle: data.title || '' },
        actionUrl: uploadResultActionUrl(videoId, status),
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
