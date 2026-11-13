/**
 * The admin-api client shared by the server actions (admin.ts, auth-requests.ts, content.ts):
 * calls admin-api with the session's bearer token. Not a 'use server' module,
 * so these helpers are never exposed as client-callable actions.
 */
import { headers as getHeaders } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { pathOfPageUrl, passkeyRedirectFor } from '@/lib/passkeys';
import { AdminApiError, type ActionResult } from './errors';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

export type ApiEnvelope = {
  success?: boolean;
  result?: unknown;
  error?: string;
  errors?: { message?: string }[];
  [key: string]: unknown;
};

function envelopeError(body: ApiEnvelope, fallback: string): string {
  return body.error || body.errors?.[0]?.message || fallback;
}

/**
 * Call admin-api with the session's bearer token and return the parsed JSON
 * envelope. Throws AdminApiError (with the HTTP status) on any failure.
 */
export async function requestAdmin(endpoint: string, options: RequestInit = {}): Promise<ApiEnvelope> {
  const method = options.method || 'GET';
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const url = `${ADMIN_API_URL}${endpoint}`;

  logger.debug(`[API Request] ${method} ${endpoint}`, { requestId, url, method, hasBody: !!options.body });

  const session = await getAdminSession();
  if (!session) {
    logger.error('[API Error] Not authenticated', { requestId, endpoint });
    throw new AdminApiError('Not authenticated', 401);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: {
        // FormData bodies (image uploads) get their multipart type from fetch
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${session.accessToken}`,
        ...options.headers,
      },
    });
  } catch (error) {
    logger.error('[API Error] Network/fetch error', {
      requestId,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AdminApiError('Admin API unreachable', 503);
  }

  const text = await response.text();
  let body: ApiEnvelope = {};
  try {
    body = text ? (JSON.parse(text) as ApiEnvelope) : {};
  } catch {
    body = { raw: text };
  }

  logger.debug(`[API Response] ${response.status} ${method} ${endpoint}`, {
    requestId,
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok || body.success === false) {
    const message = envelopeError(body, `Admin API error: ${response.status} ${response.statusText}`);
    logger.error(`[API Error] ${response.status} ${method} ${endpoint}`, { requestId, status: response.status, error: message });
    throw new AdminApiError(message, response.ok ? 500 : response.status, typeof body.code === 'string' ? body.code : undefined);
  }

  return body;
}

export async function fetchAdmin<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const body = await requestAdmin(endpoint, options);
  return body.result as T;
}


/**
 * Staff passkeys (lib/passkeys.ts): admin-api's `403 passkey_required` opens the
 * "Passkey needed" page and `401 step_up_required` a fresh sign-in
 * (prompt=login&max_age=900), both coming back to the page the action ran on
 * (the server action's Referer). Called first in every mutation wrapper's catch:
 * redirect() throws, so the server action navigates the browser instead of
 * returning an error. Any other error returns and is handled as before.
 */
export async function navigateForPasskey(error: unknown): Promise<void> {
  if (!(error instanceof AdminApiError)) return;
  let returnPath: string | null = null;
  try {
    const h = await getHeaders();
    const host = h.get('host');
    const origin = host ? `${host.includes('localhost') ? 'http' : 'https'}://${host}` : null;
    returnPath = pathOfPageUrl(h.get('referer'), origin);
  } catch {
    // outside a request (tests): no page to come back to
  }
  const target = passkeyRedirectFor(error, returnPath);
  if (!target) return;
  logger.debug('[API] Passkey answer from admin-api; navigating', { code: error.code, target });
  redirect(target);
}

/** Runs a mutation and returns a result object (production builds redact thrown server-action errors). */
export async function toResult<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message, ...(error.code ? { code: error.code } : {}) };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
