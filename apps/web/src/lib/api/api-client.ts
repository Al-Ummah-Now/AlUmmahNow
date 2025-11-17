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

const baseUrl = getApiUrl();

export interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  functionName: string;
}

export interface AuthContext {
  userId?: string;
  channelId?: string;
  accessToken?: string;
}

/**
 * Make an authenticated API request with comprehensive logging
 */
export async function apiRequest<T>(
  options: ApiRequestOptions,
  authContext?: AuthContext
): Promise<T | null> {
  const { method, url, body, headers = {}, functionName } = options;

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
      if (authContext.userId) {
        requestHeaders['userId'] = authContext.userId;
      }
      if (authContext.channelId) {
        requestHeaders['channelId'] = authContext.channelId;
      }

      // Log auth only if we have actual auth data
      if (authContext.accessToken || authContext.userId) {
        logApiAuth(functionName, {
          userId: authContext.userId,
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
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      ...(body && { body: JSON.stringify(body) })
    });

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
      return null;
    }

    // Parse response
    logApiStep({ functionName, step: 'Parsing response body' });
    const result = await response.json();
    logApiSuccess(functionName, 'Request completed successfully', result);
    logApiEnd(functionName, true);

    return result as T;
  } catch (error) {
    logApiError(functionName, 'Exception caught', error);
    logApiEnd(functionName, false);
    return null;
  }
}

/**
 * Make an authenticated API request using server-side cookies
 * This requires 'use server' and must be called from server actions
 */
export async function apiRequestServer<T>(
  options: ApiRequestOptions,
  getAuth: () => Promise<AuthContext | null>,
  requireAuth: boolean = false
): Promise<T | null> {
  const { functionName } = options;

  logApiStep({ functionName, step: 'Getting authentication context' });
  const authContext = await getAuth();

  if (!authContext && requireAuth) {
    logApiError(functionName, 'Authentication required but not available');
    return null;
  }

  return apiRequest<T>(options, authContext || undefined);
}

/**
 * Helper to build full API URL
 */
export function buildApiUrl(path: string): string {
  return `${baseUrl}${path}`;
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
