/**
 * Social auto-post queue driver (wiki AUN-SOCIAL, SOC-1). api-videos owns the deliveries and does the network
 * calls; this consumer only drives them:
 *
 * - MessageType.SocialEvent: something announceable happened (sent beside the subscriber fan-out and for every
 *   new community post): api-videos plans one delivery per matching rule and webhook and queues them.
 * - MessageType.SocialDelivery: one attempt at one post or webhook call. A network's "try later" is retried with
 *   backoff (or the delay the network asked for); the last attempt, or a failure that retrying can't fix, gives up:
 *   the creator sees the failure in Studio and the admin gets an Errors page item with Retry.
 */
import type { Logger } from '@al-ummah/logger';
import {
  MessageType,
  SOCIAL_LAST_ATTEMPT,
  reportNeedsAction,
  resolveNeedsAction,
  socialDeliveryNeedsActionKey,
  socialRetryDelaySeconds,
  spendMonth,
  type ErrorReporterEnv,
  type ExecutionContextLike,
  type SocialAttemptResult,
  type SocialDeliveryPayload,
  type SocialEvent,
  type SocialEventPayload,
} from '@al-ummah/shared-types';

export interface SocialQueueEnv extends ErrorReporterEnv {
  VIDEOS?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  MESSAGE_QUEUE?: { send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown> };
}

export interface SocialQueueMessage {
  body: { id?: string; type?: number; payload?: unknown };
  attempts?: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

const EVENTS: readonly SocialEvent[] = ['video', 'short', 'live', 'post'];

export function isSocialMessage(message: { body?: { type?: number } }): boolean {
  return message.body?.type === MessageType.SocialEvent || message.body?.type === MessageType.SocialDelivery;
}

function isEventPayload(p: unknown): p is SocialEventPayload {
  const x = p as SocialEventPayload | null;
  return !!x && typeof x.channelId === 'string' && !!x.channelId && typeof x.entityId === 'string' && !!x.entityId && EVENTS.includes(x.event);
}

function isDeliveryPayload(p: unknown): p is SocialDeliveryPayload {
  const x = p as SocialDeliveryPayload | null;
  return !!x && (x.kind === 'post' || x.kind === 'webhook') && typeof x.deliveryId === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(x.deliveryId);
}

async function secret(binding: unknown): Promise<string> {
  if (typeof binding === 'string') return binding;
  const b = binding as { get?: () => Promise<string> } | undefined;
  return (await b?.get?.()) ?? '';
}

class ApiError extends Error {}

async function api<T>(env: SocialQueueEnv, path: string, body: unknown): Promise<T> {
  if (!env.VIDEOS) throw new ApiError('VIDEOS service binding missing');
  const res = await env.VIDEOS.fetch(`https://videos.internal/internal/social${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': await secret((env as { INTERNAL_API_KEY?: unknown }).INTERNAL_API_KEY) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`api-videos ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/** The message that announces an event to social (built by the fan-out and the community post handler). */
export function socialEventMessage(payload: SocialEventPayload) {
  return { id: `social:${payload.event}:${payload.entityId}`, type: MessageType.SocialEvent, timestamp: Date.now(), payload: payload as unknown as Record<string, unknown> };
}

interface GiveUp {
  channelId: string;
  network?: string;
  entityId: string;
  event?: string;
  error?: string | null;
  host?: string;
}

async function giveUp(env: SocialQueueEnv, ctx: ExecutionContextLike | undefined, p: SocialDeliveryPayload, error: string, logger: Logger, startedAt: number): Promise<void> {
  let info: GiveUp | null = null;
  try {
    info = await api<GiveUp>(env, `/deliveries/${encodeURIComponent(p.deliveryId)}/give-up`, { kind: p.kind, error });
  } catch (e) {
    logger.warn('[Social] Could not record a given-up delivery', { deliveryId: p.deliveryId, error: e instanceof Error ? e.message : String(e) });
  }
  const reason = (info?.error || error).slice(0, 500);
  reportNeedsAction('processor', env, ctx, {
    key: socialDeliveryNeedsActionKey(p.kind, p.deliveryId),
    source: 'queue',
    title: p.kind === 'webhook' ? 'Channel webhook delivery failed' : `Social post to ${info?.network ?? 'a network'} failed`,
    message: reason,
    itemType: 'channel',
    ...(info?.channelId ? { itemId: info.channelId } : {}),
    retry: { kind: 'service', service: 'api-videos', path: '/internal/social/deliveries/retry', body: { kind: p.kind, deliveryId: p.deliveryId } },
    retryLabel: 'Try again',
    extra: { deliveryId: p.deliveryId, kind: p.kind, entityId: info?.entityId ?? null, event: info?.event ?? null, host: info?.host ?? null },
  });
  logger.job({ job: `social-${p.kind}`, outcome: 'failed', deliveryId: p.deliveryId, network: info?.network, reason, durationMs: Date.now() - startedAt });
}

export async function processSocialMessages(messages: SocialQueueMessage[], env: SocialQueueEnv, ctx: ExecutionContextLike | undefined, logger: Logger): Promise<void> {
  for (const message of messages) {
    const type = message.body?.type;
    const p = message.body?.payload;
    const attempts = message.attempts ?? 1;
    const startedAt = Date.now();

    if (type === MessageType.SocialEvent) {
      if (!isEventPayload(p)) {
        logger.warn('[Social] Invalid event message dropped', { id: message.body?.id });
        message.ack();
        continue;
      }
      try {
        const planned = await api<{ posts: number; webhooks: number }>(env, '/events', p);
        if (planned.posts || planned.webhooks) logger.job({ job: 'social-plan', outcome: 'ok', channelId: p.channelId, event: p.event, entityId: p.entityId, ...planned, durationMs: Date.now() - startedAt });
        message.ack();
      } catch (error) {
        // Retried by the queue, then the DLQ (which flags the admin with a replay)
        logger.warn('[Social] Planning failed; retrying', { channelId: p.channelId, event: p.event, attempts, error: error instanceof Error ? error.message : String(error) });
        message.retry({ delaySeconds: socialRetryDelaySeconds(attempts) });
      }
      continue;
    }

    if (!isDeliveryPayload(p)) {
      logger.warn('[Social] Invalid delivery message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    const last = attempts >= SOCIAL_LAST_ATTEMPT;
    let result: SocialAttemptResult;
    try {
      result = await api<SocialAttemptResult>(env, `/deliveries/${encodeURIComponent(p.deliveryId)}/attempt`, { kind: p.kind });
    } catch (error) {
      result = { outcome: 'retry', error: error instanceof Error ? error.message : String(error) };
    }

    if (result.outcome === 'sent') {
      resolveNeedsAction(env, ctx, socialDeliveryNeedsActionKey(p.kind, p.deliveryId));
      logger.job({ job: `social-${p.kind}`, outcome: 'ok', deliveryId: p.deliveryId, attempts, durationMs: Date.now() - startedAt });
      message.ack();
      continue;
    }
    if (result.outcome === 'skipped') {
      message.ack();
      continue;
    }
    if (result.outcome === 'blocked') {
      // Paused by the admin, or the month's X budget is spent: the creator sees it; the cap is the admin's to raise
      if (result.flagAdmin && result.error === 'x_budget_reached') {
        reportNeedsAction('processor', env, ctx, {
          key: `social-x-cap:${spendMonth()}`,
          source: 'queue',
          title: "This month's X budget is spent",
          message: 'Posts to X are paused until next month. Raise the monthly X cap on the Social page to post sooner.',
          itemType: 'settings',
          itemUrl: '/social',
        });
      }
      message.ack();
      continue;
    }
    if (result.outcome === 'retry' && !last) {
      const delay = Math.min(3600, Math.max(result.retryAfterSeconds ?? 0, socialRetryDelaySeconds(attempts)));
      logger.warn('[Social] Delivery attempt failed; retrying', { deliveryId: p.deliveryId, kind: p.kind, attempts, delay, error: result.error });
      message.retry({ delaySeconds: delay });
      continue;
    }
    await giveUp(env, ctx, p, result.error ?? 'failed', logger, startedAt);
    message.ack();
  }
}
