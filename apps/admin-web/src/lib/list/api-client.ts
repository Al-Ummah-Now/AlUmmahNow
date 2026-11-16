'use client';

/**
 * The browser's typed client for the content pass-through
 * (/api/content/<path>, app/api/content/[...path]/route.ts). Answers are
 * admin-api's envelope; a failure throws AdminClientError with the HTTP status
 * and admin-api's error code, so the UI can say what went wrong in the admin's
 * language. An expired session goes through /api/auth/refresh and comes back.
 */
import { logger } from '@/lib/logger-client';
import { passkeyRedirectFor } from '@/lib/passkeys';

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

/** The pass-throughs this client talks to: content (lists) and billing (Payments page). */
export type ProxyBase = '/api/content' | '/api/billing';

export function proxyUrl(base: ProxyBase, path: string, query: QueryValues = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return `${base}/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

export function contentUrl(path: string, query: QueryValues = {}): string {
  return proxyUrl('/api/content', path, query);
}

let refreshing = false;

/** The session ran out: refresh it the way a page render does, then return here. */
function refreshSession(): void {
  if (refreshing || typeof window === 'undefined') return;
  refreshing = true;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/api/auth/refresh?next=${encodeURIComponent(next)}`);
}

/**
 * Staff passkeys (lib/passkeys.ts): admin-api's `401 step_up_required` (a high-risk action needs
 * a sign-in under 15 minutes old) and `403 passkey_required` send the browser through the same
 * fresh sign-in or "Passkey needed" page as the server actions do, coming back to this page.
 * True when it navigated.
 */
function navigateForPasskey(status: number, code: string | undefined): boolean {
  if (typeof window === 'undefined') return false;
  const target = passkeyRedirectFor({ status, code }, `${window.location.pathname}${window.location.search}`);
  if (!target) return false;
  logger.debug('[list] Passkey answer from admin-api; navigating', { code });
  window.location.assign(target);
  return true;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type RequestOptions = { query?: QueryValues; body?: unknown; signal?: AbortSignal };

export function contentRequest<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  return proxyRequest<T>('/api/content', method, path, opts);
}

/** The billing pass-through (/api/billing/<path>, app/api/billing/[...path]/route.ts). */
export function billingRequest<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  return proxyRequest<T>('/api/billing', method, path, opts);
}

async function proxyRequest<T>(base: ProxyBase, method: Method, path: string, opts: RequestOptions): Promise<T> {
  const url = proxyUrl(base, path, opts.query);
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
    else navigateForPasskey(res.status, code);
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
