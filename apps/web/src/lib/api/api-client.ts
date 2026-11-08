/**
 * Generic API Client Utility
 *
 * Provides a centralized method for making authenticated API calls
 * with automatic logging, error handling, and header management.
 */

import { getApiUrl } from "@/lib/runtime-config";
import {
  logApiStart,
  logApiEnd,
  logApiStep,
  logApiRequest,
  logApiResponse,
  logApiError,
  logApiSuccess,
  logApiAuth
} from "./logger";

export interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  functionName: string;
  /** Abort the request (and resolve null) after this many milliseconds */
  timeoutMs?: number;
}

export interface AuthContext {
  userId?: string; // Available server-side from JWT decode or session
  channelId?: string;
  accessToken?: string;
  // Note: userId is not sent from client, but available server-side from JWT token or session
}

/** Response body (null on failure) plus the HTTP status (null when no response arrived). */
interface ApiResult<T> {
  data: T | null;
  status: number | null;
}

/**
 * Make an authenticated API request with comprehensive logging
 */
export async function apiRequest<T>(
  options: ApiRequestOptions,
  authContext?: AuthContext
): Promise<T | null> {
  return (await sendApiRequest<T>(options, authContext)).data;
}

async function sendApiRequest<T>(
  options: ApiRequestOptions,
  authContext?: AuthContext
): Promise<ApiResult<T>> {
  const { method, url, body, headers = {}, functionName, timeoutMs } = options;

  logApiStart({ functionName, method, url });

  try {
    // Build headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    // Add authentication headers if context provided
    if (authContext) {
      if (authContext.accessToken) {
        requestHeaders['Authorization'] = `Bearer ${authContext.accessToken}`;
      }
      if (authContext.channelId) {
        requestHeaders['channelId'] = authContext.channelId;
      }

      // Log auth only if we have actual auth data
      if (authContext.accessToken) {
        logApiAuth(functionName, {
          hasToken: !!authContext.accessToken,
          tokenLength: authContext.accessToken?.length
        });
      }
    }

    // Log request
    logApiRequest({
      functionName,
      method,
      url,
      headers: requestHeaders,
      body
    });

    // Make request
    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    // Log response
    logApiResponse({
      functionName,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: response.headers
    });

    // Handle errors
    if (!response.ok) {
      const errorText = await response.text();
      logApiError(functionName, 'API request failed', {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText
      });
      logApiEnd(functionName, false);
      return { data: null, status: response.status };
    }

    // 204 No Content (e.g. DELETE /api/upload-defaults/:id) has no body to parse;
    // treating it as an error made successful deletes look like failures
    if (response.status === 204) {
      logApiEnd(functionName, true);
      return { data: { success: true } as T, status: response.status };
    }

    // Parse response
    logApiStep({ functionName, step: 'Parsing response body' });
    const result = await response.json();
    logApiSuccess(functionName, 'Request completed successfully', result);
    logApiEnd(functionName, true);

    return { data: result as T, status: response.status };
  } catch (error) {
    logApiError(functionName, 'Exception caught', error);
    logApiEnd(functionName, false);
    return { data: null, status: null };
  }
}

/**
 * Called once when an API answers 401: refreshes the tokens and returns the
 * auth context to retry with, or null to give up.
 */
export type UnauthorizedHandler = (authContext: AuthContext) => Promise<AuthContext | null>;

/** Default UnauthorizedHandler: refresh through the session cookie. */
export const refreshAuthAfterUnauthorized: UnauthorizedHandler = async (authContext) => {
  if (!authContext.accessToken) return null;
  // Imported lazily: the session manager imports this module too
  const { SessionManager } = await import('../auth/session-manager');
  const accessToken = await SessionManager.refreshAfterUnauthorized(authContext.userId, authContext.accessToken);
  return accessToken ? { ...authContext, accessToken } : null;
};

/**
 * Make an authenticated API request using server-side cookies
 * This requires 'use server' and must be called from server actions
 *
 * A 401 for a request that carried a token is retried exactly once, after
 * `onUnauthorized` has refreshed the token (never more: no loops).
 */
export async function apiRequestServer<T>(
  options: ApiRequestOptions,
  getAuth: () => Promise<AuthContext | null>,
  requireAuth: boolean = false,
  onUnauthorized: UnauthorizedHandler = refreshAuthAfterUnauthorized
): Promise<T | null> {
  const { functionName } = options;

  logApiStep({ functionName, step: 'Getting authentication context' });
  const authContext = await getAuth();

  if (!authContext && requireAuth) {
    logApiError(functionName, 'Authentication required but not available');
    return null;
  }

  const first = await sendApiRequest<T>(options, authContext || undefined);
  if (first.status !== 401 || !authContext?.accessToken) {
    return first.data;
  }

  let renewed: AuthContext | null = null;
  try {
    renewed = await onUnauthorized(authContext);
  } catch (error) {
    logApiError(functionName, 'Token refresh after 401 failed', error);
  }
  if (!renewed?.accessToken || renewed.accessToken === authContext.accessToken) {
    logApiStep({ functionName, step: '401: no renewed token, not retrying' });
    return first.data;
  }

  logApiStep({ functionName, step: '401: retrying once with a refreshed token' });
  return (await sendApiRequest<T>(options, { ...authContext, ...renewed })).data;
}

/**
 * Helper to build full API URL
 */
export function buildApiUrl(path: string): string {
  return `${getApiUrl()}${path}`;
}

/**
 * Helper to build query parameters
 */
export function buildQueryParams(params: Record<string, unknown>): string {
  const queryParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  });

  const queryString = queryParams.toString();
  return queryString ? `?${queryString}` : '';
}
