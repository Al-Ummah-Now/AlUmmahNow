'use client';

/**
 * The browser's typed client for the content pass-through
 * (/api/content/<path>, app/api/content/[...path]/route.ts). Answers are
 * admin-api's envelope; a failure throws AdminClientError with the HTTP status
 * and admin-api's error code, so the UI can say what went wrong in the admin's
 * language. An expired session goes through /api/auth/refresh and comes back.
 */
import { logger } from '@/lib/logger-client';

export class AdminClientError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AdminClientError';
    this.status = status;
    this.code = code;
  }
}

type Envelope<T> = { success?: boolean; result?: T; error?: string; code?: string; errors?: { message?: string }[] };

export type QueryValues = Record<string, string | number | undefined>;

export function contentUrl(path: string, query: QueryValues = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return `/api/content/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

let refreshing = false;

/** The session ran out: refresh it the way a page render does, then return here. */
function refreshSession(): void {
  if (refreshing || typeof window === 'undefined') return;
  refreshing = true;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/api/auth/refresh?next=${encodeURIComponent(next)}`);
}

export async function contentRequest<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, opts: { query?: QueryValues; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const url = contentUrl(path, opts.query);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal: opts.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    logger.warn('[list] Request did not reach the server', { method, path, error: error instanceof Error ? error.message : String(error) });
    throw new AdminClientError('Network error', 0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || body.success === false) {
    const code = typeof body.code === 'string' ? body.code : undefined;
    if (res.status === 401 && code === 'session_expired') refreshSession();
    const message = body.error || body.errors?.[0]?.message || `HTTP ${res.status}`;
    // 4xx is the admin's or the data's problem (shown, not an error); 5xx is ours
    if (res.status >= 500) logger.error('[list] Request failed', { method, path, status: res.status, code });
    else logger.debug('[list] Request refused', { method, path, status: res.status, code });
    throw new AdminClientError(message, res.status, code);
  }
  return body.result as T;
}

export const contentApi = {
  get: <T>(path: string, query?: QueryValues, signal?: AbortSignal) => contentRequest<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => contentRequest<T>('POST', path, { body: body ?? {} }),
  delete: <T>(path: string, body?: unknown) => contentRequest<T>('DELETE', path, { body: body ?? {} }),
};
