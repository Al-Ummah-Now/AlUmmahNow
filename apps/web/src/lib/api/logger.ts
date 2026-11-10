import { logger } from '@/lib/logger-server';

/**
 * API logging helpers for server-side API calls.
 *
 * Logging policy (docs/operations/logging.md): progress lines (start, step,
 * request, response, auth, success, end) are single debug lines, so they show in
 * QA/dev only. Failures are one error line with the step and the Error (stack
 * kept). Headers and bodies are never logged: they carry tokens and user data.
 */

export type LogLevel = 'info' | 'success' | 'error' | 'warn';

export interface ApiLogContext {
  functionName: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  step?: string;
  data?: unknown;
}

/** Path of a URL without its query string (queries can carry tokens or search text). */
function pathOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0];
  }
}

export function logApiStart(context: ApiLogContext): void {
  logger.debug(`[${context.functionName}] start`, { method: context.method, path: pathOf(context.url) });
}

export function logApiEnd(functionName: string, success: boolean = true): void {
  logger.debug(`[${functionName}] end`, { success });
}

export function logApiStep(context: ApiLogContext): void {
  logger.debug(`[${context.functionName}] ${context.step || 'step'}`);
}

/** Success: debug, without the response payload. */
export function logApiSuccess(functionName: string, message: string, _data?: unknown): void {
  logger.debug(`[${functionName}] ${message}`);
}

/** Failure: one error line with full context (the Error keeps its stack). */
export function logApiError(functionName: string, message: string, error?: unknown): void {
  logger.error(`[${functionName}] ${message}`, error === undefined ? undefined : { error });
}

export function logApiWarn(functionName: string, message: string, data?: unknown): void {
  logger.warn(`[${functionName}] ${message}`, data);
}

/** Request: method and path only (never headers, query or body). */
export function logApiRequest(context: ApiLogContext & {
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
}): void {
  logger.debug(`[${context.functionName}] request`, { method: context.method, path: pathOf(context.url) });
}

/** Response: status only (never headers or body). */
export function logApiResponse(context: ApiLogContext & {
  status: number;
  statusText: string;
  ok: boolean;
  headers?: Headers;
  body?: unknown;
}): void {
  logger.debug(`[${context.functionName}] response ${context.status}`, { ok: context.ok });
}

/** Auth context, without any token material. */
export function logApiAuth(functionName: string, context: {
  userId?: string;
  hasToken?: boolean;
  tokenLength?: number;
}): void {
  logger.debug(`[${functionName}] auth`, { userId: context.userId, hasToken: context.hasToken });
}

/**
 * Wrapper function for API calls with automatic logging
 *
 * @example
 * return withApiLogging({
 *   functionName: 'VideosAPI.list',
 *   method: 'GET',
 *   url: `${baseUrl}/api/videos`,
 * }, async () => {
 *   const response = await fetch(...);
 *   return response.json();
 * });
 */
export async function withApiLogging<T>(
  context: ApiLogContext,
  apiCall: () => Promise<T>
): Promise<T | null> {
  try {
    return await apiCall();
  } catch (error) {
    logger.error(`[${context.functionName}] API call failed`, { method: context.method, path: pathOf(context.url), error });
    return null;
  }
}

/** Compact logging (one line through the policy logger). */
export function logApiCompact(
  functionName: string,
  level: LogLevel,
  message: string,
  data?: unknown
): void {
  const line = `[${functionName}] ${message}`;
  if (level === 'error') logger.error(line, data);
  else if (level === 'warn') logger.warn(line, data);
  else logger.debug(line, data);
}
