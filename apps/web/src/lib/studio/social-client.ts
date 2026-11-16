'use client';

/** Studio → Social, from the browser (api-videos /api/social/channel/:channelId/*, signed in). */
import type { SocialAccountView, SocialEvent, SocialFormat, SocialLanguage, SocialNetwork, SocialTemplate, SocialWebhookEvent, SocialWebhookView } from '@al-ummah/shared-types';
import { socialFailureReason, type SocialFailureReason } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import type { ShareKit, SocialOverview } from './social';

export type SocialResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; body?: Record<string, unknown> };

async function call<T>(channelId: string, path: string, init: RequestInit = {}): Promise<SocialResult<T>> {
  const send = async (force: boolean) => {
    const { accessToken } = await fetchClientAuthInfo(force);
    if (!accessToken) return null;
    return fetch(`${getApiUrl().replace(/\/$/, '')}/api/social/channel/${encodeURIComponent(channelId)}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  };
  try {
    let res = await send(false);
    if (res?.status === 401) res = await send(true);
    if (!res) return { ok: false, status: 401, code: 'unauthorized' };
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) return { ok: false, status: res.status, code: body?.error ?? 'generic', body: (body ?? undefined) as Record<string, unknown> | undefined };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, code: 'generic' };
  }
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export type ConnectResult = { kind: 'redirect'; authorizeUrl: string } | { kind: 'telegram'; code: string; botUsername: string; expiresAt: string };

export const socialClient = {
  overview: (channelId: string) => call<SocialOverview>(channelId, ''),
  connect: (channelId: string, input: { network: SocialNetwork; language: SocialLanguage; returnLang: SocialLanguage; handle?: string; instance?: string }) =>
    call<ConnectResult>(channelId, '/connect', json('POST', input)),
  /** The network sent the person back: link the account (only the person who started connecting can) */
  confirmConnect: (channelId: string, id: string) => call<{ account: SocialAccountView }>(channelId, '/connect/confirm', json('POST', { id })),
  telegramPending: (channelId: string, code: string) => call<{ pending: boolean }>(channelId, `/telegram/${encodeURIComponent(code)}`),
  updateAccount: (channelId: string, accountId: string, patch: { language?: SocialLanguage; rules?: Array<{ event: SocialEvent; enabled: boolean; format: SocialFormat; includeLink: boolean }> }) =>
    call<{ account: SocialAccountView }>(channelId, `/accounts/${encodeURIComponent(accountId)}`, json('PATCH', patch)),
  disconnect: (channelId: string, accountId: string) => call<{ ok: true }>(channelId, `/accounts/${encodeURIComponent(accountId)}`, json('DELETE')),
  saveTemplates: (channelId: string, templates: SocialTemplate[]) => call<{ templates: SocialTemplate[] }>(channelId, '/templates', json('PUT', { templates })),
  retry: (channelId: string, deliveryId: string, format?: SocialFormat) => call<{ ok: true }>(channelId, `/deliveries/${encodeURIComponent(deliveryId)}/retry`, json('POST', format ? { format } : {})),
  createWebhook: (channelId: string, url: string, events: SocialWebhookEvent[]) => call<{ webhook: SocialWebhookView; secret: string }>(channelId, '/webhooks', json('POST', { url, events })),
  updateWebhook: (channelId: string, id: string, patch: { enabled?: boolean; events?: SocialWebhookEvent[] }) => call<{ webhook: SocialWebhookView }>(channelId, `/webhooks/${encodeURIComponent(id)}`, json('PATCH', patch)),
  deleteWebhook: (channelId: string, id: string) => call<{ ok: true }>(channelId, `/webhooks/${encodeURIComponent(id)}`, json('DELETE')),
  testWebhook: (channelId: string, id: string) => call<{ deliveryId: string }>(channelId, `/webhooks/${encodeURIComponent(id)}/test`, json('POST', {})),
  rotateSecret: (channelId: string, id: string) => call<{ secret: string }>(channelId, `/webhooks/${encodeURIComponent(id)}/secret`, json('POST', {})),
  shareKit: (channelId: string, videoId: string, clip?: string) => call<ShareKit>(channelId, `/share-kit/${encodeURIComponent(videoId)}${clip ? `?clip=${encodeURIComponent(clip)}` : ''}`),
};

/** A delivery's stored error → the reason key Studio explains it with. */
export function reasonKey(error: string | undefined): SocialFailureReason {
  return socialFailureReason(error);
}

/** Whether a failure is fixed by posting a link instead of the video. */
export const linkFixes = (error: string | undefined) => ['video_too_long', 'video_too_large', 'video_not_available'].includes(reasonKey(error));
