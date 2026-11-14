/**
 * Calls api-videos' /internal/admin/* (the content data owner) over the VIDEOS
 * service binding, authenticated with the shared INTERNAL_API_KEY. The acting
 * admin's id travels in X-Admin-Actor. Local dev without the binding can point
 * VIDEOS_API_URL at a running api-videos instead.
 */

export interface VideosClientEnv {
  VIDEOS?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  VIDEOS_API_URL?: string;
  INTERNAL_API_KEY?: string | { get(): Promise<string> };
}

/** An api-videos answer that was not a success, passed on to the admin as is. */
export class VideosError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface VideosCall {
  method?: string;
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
  json?: unknown;
  form?: FormData;
  actorId?: string;
  /** Path prefix on api-videos (default /internal/admin; the CSAM routes are /internal/csam) */
  base?: '/internal/admin' | '/internal/csam';
}

async function internalKey(env: VideosClientEnv): Promise<string> {
  const binding = env.INTERNAL_API_KEY;
  const key = typeof binding === 'string' ? binding : await binding?.get();
  if (!key) throw new VideosError(500, 'not_configured', 'INTERNAL_API_KEY is not configured');
  return key;
}

export function queryString(query: VideosCall['query']): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(name, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The raw response of an api-videos internal route (streams: CSAM evidence downloads). */
export async function fetchVideosRaw(env: VideosClientEnv, path: string, call: Pick<VideosCall, 'actorId' | 'base'> = {}): Promise<Response> {
  const headers: Record<string, string> = { 'X-API-Key': await internalKey(env) };
  if (call.actorId) headers['X-Admin-Actor'] = call.actorId;
  const suffix = `${call.base ?? '/internal/admin'}${path}`;
  if (env.VIDEOS) return env.VIDEOS.fetch(`https://videos.internal${suffix}`, { headers });
  if (env.VIDEOS_API_URL) return fetch(`${env.VIDEOS_API_URL.replace(/\/$/, '')}${suffix}`, { headers });
  throw new VideosError(500, 'not_configured', 'The VIDEOS service binding is not configured');
}

export async function callVideos<T>(env: VideosClientEnv, path: string, call: VideosCall = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-API-Key': await internalKey(env) };
  if (call.actorId) headers['X-Admin-Actor'] = call.actorId;
  let body: BodyInit | undefined;
  if (call.form) body = call.form;
  else if (call.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(call.json);
  }
  const init: RequestInit = { method: call.method ?? 'GET', headers, body };
  const suffix = `${call.base ?? '/internal/admin'}${path}${queryString(call.query)}`;

  let response: Response;
  if (env.VIDEOS) response = await env.VIDEOS.fetch(`https://videos.internal${suffix}`, init);
  else if (env.VIDEOS_API_URL) response = await fetch(`${env.VIDEOS_API_URL.replace(/\/$/, '')}${suffix}`, init);
  else throw new VideosError(500, 'not_configured', 'The VIDEOS service binding is not configured');

  const payload = (await response.json().catch(() => null)) as { success?: boolean; result?: T; code?: string; error?: string } | null;
  if (!response.ok || !payload?.success) {
    throw new VideosError(
      response.ok ? 502 : response.status,
      payload?.code ?? 'videos_error',
      payload?.error ?? `api-videos answered ${response.status}`,
    );
  }
  return payload.result as T;
}
