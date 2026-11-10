/**
 * Calls api-videos' /internal/uploads/* (the upload reaper's admin side; see
 * apps/api-videos/src/endpoints/video/uploadsInternal.ts) over the VIDEOS
 * service binding with the shared INTERNAL_API_KEY. Local dev without the
 * binding can point VIDEOS_API_URL at a running api-videos.
 */

export interface UploadsClientEnv {
  VIDEOS?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  VIDEOS_API_URL?: string;
  INTERNAL_API_KEY?: string | { get(): Promise<string> };
}

export class UploadsApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function callUploads<T>(
  env: UploadsClientEnv,
  path: string,
  init: { method?: string; json?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const binding = env.INTERNAL_API_KEY;
  const key = typeof binding === 'string' ? binding : await binding?.get();
  if (!key) throw new UploadsApiError(500, 'INTERNAL_API_KEY is not configured');
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(init.query ?? {})) if (value) params.set(name, value);
  const suffix = `/internal/uploads${path}${params.size ? `?${params}` : ''}`;
  const headers: Record<string, string> = { 'X-API-Key': key };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const request = { method: init.method ?? 'GET', headers, body };
  let response: Response;
  if (env.VIDEOS) response = await env.VIDEOS.fetch(`https://videos.internal${suffix}`, request);
  else if (env.VIDEOS_API_URL) response = await fetch(`${env.VIDEOS_API_URL.replace(/\/$/, '')}${suffix}`, request);
  else throw new UploadsApiError(500, 'The VIDEOS service binding is not configured');
  const payload = (await response.json().catch(() => null)) as { success?: boolean; result?: T; error?: string } | null;
  if (!response.ok || !payload?.success) {
    throw new UploadsApiError(response.ok ? 502 : response.status, payload?.error ?? `api-videos answered ${response.status}`);
  }
  return payload.result as T;
}
