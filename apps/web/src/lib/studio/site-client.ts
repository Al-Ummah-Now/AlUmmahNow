'use client';

/** Studio → Site, from the browser: save (ETag-guarded), preview, logo/favicon upload. */
import type { SiteSettings, SiteSettingsUpdate } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';

export type SiteCallResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null };

async function call<T>(path: string, init: RequestInit): Promise<SiteCallResult<T>> {
  const send = async (force: boolean) => {
    const { accessToken } = await fetchClientAuthInfo(force);
    if (!accessToken) return null;
    return fetch(`${getApiUrl().replace(/\/$/, '')}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  };
  let res = await send(false);
  if (res?.status === 401) res = await send(true);
  if (!res) return { ok: false, status: 401, code: 'unauthorized' };
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) return { ok: false, status: res.status, code: body?.error ?? null };
  return { ok: true, data: body as T };
}

export function saveSiteSettings(channelId: string, update: SiteSettingsUpdate, etag: string) {
  return call<{ site: SiteSettings; etag: string }>(`/api/sites/channel/${encodeURIComponent(channelId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': `"${etag}"` },
    body: JSON.stringify(update),
  });
}

export function previewSiteSettings(channelId: string, update: SiteSettingsUpdate) {
  return call<{ token: string; expiresAt: string; url: string }>(`/api/sites/channel/${encodeURIComponent(channelId)}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
}

/** Logo and favicon go through the channel image upload (magic-byte checked, stored on the image CDN). */
export async function uploadSiteImage(channelId: string, file: File): Promise<SiteCallResult<{ url: string }>> {
  const form = new FormData();
  form.append('images', file);
  const r = await call<{ images?: { url: string }[]; result?: { images?: { url: string }[] } }>(`/api/community/media/upload/images`, { method: 'POST', headers: { channelId }, body: form });
  if (!r.ok) return r;
  const url = r.data.images?.[0]?.url ?? r.data.result?.images?.[0]?.url;
  return url ? { ok: true, data: { url } } : { ok: false, status: 502, code: 'upload_failed' };
}
