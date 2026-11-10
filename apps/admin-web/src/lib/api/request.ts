/**
 * The admin-api call shared by the server-action modules (admin.ts, auth-requests.ts).
 * Not a 'use server' module: it must not be callable from the browser.
 */
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { AdminApiError } from './errors';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

type ApiEnvelope = {
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

  logger.info(`[API Request] ${method} ${endpoint}`, { requestId, url, method, hasBody: !!options.body });

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
        'Content-Type': 'application/json',
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

  logger.info(`[API Response] ${response.status} ${method} ${endpoint}`, {
    requestId,
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok || body.success === false) {
    const message = envelopeError(body, `Admin API error: ${response.status} ${response.statusText}`);
    logger.error(`[API Error] ${response.status} ${method} ${endpoint}`, { requestId, status: response.status, error: message });
    throw new AdminApiError(message, response.ok ? 500 : response.status);
  }

  return body;
}

