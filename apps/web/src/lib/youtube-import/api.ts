/**
 * Browser client for the YouTube import API (api-videos /api/youtube-import,
 * wiki AUN-YT-IMPORT). Bearer auth like the other Studio calls; failures throw
 * YtImportApiError with the server's code (never shown as is).
 */
import type { YtFileMatch, YtImport, YtImportItem, YtImportPlaylist, YtVisibilityMode } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';

export class YtImportApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly serverRef?: string,
  ) {
    super(`YouTube import request failed (${status}${code ? ` ${code}` : ''})`);
    this.name = 'YtImportApiError';
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const send = async (force: boolean) => {
    const { accessToken } = await fetchClientAuthInfo(force);
    if (!accessToken) throw new YtImportApiError(401, null);
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}), Authorization: `Bearer ${accessToken}` };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(`${getApiUrl().replace(/\/$/, '')}${path}`, { ...init, headers, cache: 'no-store' });
  };
  let res = await send(false);
  // The cached token expired between two calls: one retry with a fresh one
  if (res.status === 401) res = await send(true);
  return res;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);
  const body = (await res.json().catch(() => null)) as ({ success?: boolean; code?: string; reference?: string; result?: T } & T) | null;
  if (!res.ok || !body || body.success === false) {
    throw new YtImportApiError(res.status, body?.code ?? null, res.headers.get('X-Error-Ref') || body?.reference || undefined);
  }
  // The answer's fields sit beside success ({ success, import, items }); a { result } envelope is read the same way
  return body.result && typeof body.result === 'object' ? body.result : body;
}

const base = '/api/youtube-import';
const importPath = (id: string) => `${base}/${encodeURIComponent(id)}`;

export interface YtImportStatusView {
  ready: boolean;
  captionsAvailable: boolean;
  import: YtImport | null;
}

export interface YtImportDetail {
  import: YtImport;
  items: YtImportItem[];
  playlists: YtImportPlaylist[];
}

export async function getImportStatus(channelId: string, signal?: AbortSignal): Promise<YtImportStatusView> {
  const r = await call<YtImportStatusView>(`${base}/status?channelId=${encodeURIComponent(channelId)}`, { signal });
  return { ready: !!r.ready, captionsAvailable: !!r.captionsAvailable, import: r.import ?? null };
}

export async function startOAuth(channelId: string, captions: boolean, locale: 'en' | 'ar'): Promise<string> {
  const r = await call<{ url: string }>(`${base}/oauth/start`, { method: 'POST', body: JSON.stringify({ channelId, captions, locale }) });
  return r.url;
}

export async function getImport(importId: string, signal?: AbortSignal): Promise<YtImportDetail> {
  const r = await call<YtImportDetail>(importPath(importId), { signal });
  return { import: r.import, items: r.items ?? [], playlists: r.playlists ?? [] };
}

export async function saveSelection(importId: string, selection: { itemIds: string[]; playlistIds: string[]; visibilityMode: YtVisibilityMode }): Promise<YtImport> {
  return (await call<{ import: YtImport }>(`${importPath(importId)}/selection`, { method: 'PUT', body: JSON.stringify(selection) })).import;
}

/** The server takes at most this many matches per call. */
export const MATCHES_PER_CALL = 500;

export async function saveMatches(importId: string, matches: { itemId: string; match: YtFileMatch | null }[]): Promise<number> {
  let updated = 0;
  for (let i = 0; i < matches.length; i += MATCHES_PER_CALL) {
    const part = matches.slice(i, i + MATCHES_PER_CALL);
    updated += (await call<{ updated: number }>(`${importPath(importId)}/matches`, { method: 'PUT', body: JSON.stringify({ matches: part }) })).updated ?? 0;
  }
  return updated;
}

export async function startImport(importId: string): Promise<YtImport> {
  return (await call<{ import: YtImport }>(`${importPath(importId)}/start`, { method: 'POST' })).import;
}

export async function retryItem(importId: string, itemId: string): Promise<YtImportItem> {
  return (await call<{ item: YtImportItem }>(`${importPath(importId)}/items/${encodeURIComponent(itemId)}/retry`, { method: 'POST' })).item;
}

export async function cancelImport(importId: string): Promise<YtImport> {
  return (await call<{ import: YtImport }>(`${importPath(importId)}/cancel`, { method: 'POST' })).import;
}

/** The link-back CSV, fetched with auth (a plain link would carry no token). */
export async function downloadLinkBackCsv(importId: string): Promise<Blob> {
  const res = await request(`${importPath(importId)}/link-back.csv`);
  if (!res.ok) throw new YtImportApiError(res.status, null, res.headers.get('X-Error-Ref') || undefined);
  return res.blob();
}
