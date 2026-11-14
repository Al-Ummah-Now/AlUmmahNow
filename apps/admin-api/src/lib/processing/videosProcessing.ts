/**
 * Calls api-videos' /internal/* over the VIDEOS service binding with the
 * shared INTERNAL_API_KEY: /internal/processing/* (processing health and
 * repair; apps/api-videos/src/endpoints/video/processingInternal.ts) and
 * /internal/media/* (R2 delivery; endpoints/media/mediaInternal.ts). Local dev
 * without the binding can point VIDEOS_API_URL at a running api-videos.
 */

export interface ProcessingClientEnv {
  VIDEOS?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  VIDEOS_API_URL?: string;
  INTERNAL_API_KEY?: string | { get(): Promise<string> };
}

export class ProcessingApiError extends Error {
  /** `problems`: why api-videos refused a settings change (shared-types settingsProblems) */
  constructor(readonly status: number, message: string, readonly problems?: unknown) {
    super(message);
  }
}

export interface VideosInternalInit {
  method?: string;
  json?: unknown;
  query?: Record<string, string | undefined>;
}

/** `path` under /internal/processing (e.g. '/videos'). */
export function callProcessing<T>(env: ProcessingClientEnv, path: string, init: VideosInternalInit = {}): Promise<T> {
  return callVideosInternal<T>(env, `/internal/processing${path}`, init);
}

/** Any api-videos internal route (`path` starts with /internal/); returns `result`, throws ProcessingApiError. */
export async function callVideosInternal<T>(env: ProcessingClientEnv, path: string, init: VideosInternalInit = {}): Promise<T> {
  const binding = env.INTERNAL_API_KEY;
  const key = typeof binding === 'string' ? binding : await binding?.get();
  if (!key) throw new ProcessingApiError(500, 'INTERNAL_API_KEY is not configured');
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(init.query ?? {})) if (value) params.set(name, value);
  const suffix = `${path}${params.size ? `?${params}` : ''}`;
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
  else throw new ProcessingApiError(500, 'The VIDEOS service binding is not configured');
  const payload = (await response.json().catch(() => null)) as { success?: boolean; result?: T; error?: string; problems?: unknown } | null;
  if (!response.ok || !payload?.success) {
    throw new ProcessingApiError(response.ok ? 502 : response.status, payload?.error ?? `api-videos answered ${response.status}`, payload?.problems);
  }
  return payload.result as T;
}
