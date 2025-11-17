/**
 * API Logging Utility
 *
 * Provides structured logging for API calls with consistent formatting.
 * Used by both client-side API classes and server-side actions.
 */

export type LogLevel = 'info' | 'success' | 'error' | 'warn';

export interface ApiLogContext {
  functionName: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  step?: string;
  data?: unknown;
}

/**
 * Format log message with consistent prefix and emoji
 */
function formatMessage(level: LogLevel, functionName: string, message: string): string {
  const emoji = {
    info: '📝',
    success: '✅',
    error: '❌',
    warn: '⚠️',
  }[level];

  return `[${functionName}] ${emoji} ${message}`;
}

/**
 * Log API call start
 * Should be called at the beginning of every API function
 */
export function logApiStart(context: ApiLogContext): void {
  const { functionName, method, url } = context;

  console.log(`[${functionName}] ${'='.repeat(50)}`);
  console.log(`[${functionName}] START`);
  console.log(`[${functionName}] Timestamp: ${new Date().toISOString()}`);

  if (method && url) {
    console.log(`[${functionName}] 📡 ${method} ${url}`);
  }
}

/**
 * Log API call end (success)
 */
export function logApiEnd(functionName: string, success: boolean = true): void {
  const status = success ? 'SUCCESS' : 'FAILURE';
  const emoji = success ? '✅' : '❌';

  console.log(`[${functionName}] ${emoji} END (${status})`);
  console.log(`[${functionName}] ${'='.repeat(50)}`);
}

/**
 * Log a step in the API call process
 */
export function logApiStep(context: ApiLogContext): void {
  const { functionName, step, data } = context;

  console.log(`[${functionName}] 📝 ${step || 'Processing...'}`);

  if (data !== undefined) {
    console.log(`[${functionName}] Data:`, data);
  }
}

/**
 * Log successful operation
 */
export function logApiSuccess(functionName: string, message: string, data?: unknown): void {
  console.log(formatMessage('success', functionName, message));

  if (data !== undefined) {
    console.log(`[${functionName}] Response:`, data);
  }
}

/**
 * Log error
 */
export function logApiError(functionName: string, message: string, error?: unknown): void {
  console.error(formatMessage('error', functionName, message));

  if (error) {
    if (error instanceof Error) {
      console.error(`[${functionName}] Error message:`, error.message);
      if (error.stack) {
        console.error(`[${functionName}] Stack trace:`, error.stack);
      }
    } else {
      console.error(`[${functionName}] Error details:`, error);
    }
  }
}

/**
 * Log warning
 */
export function logApiWarn(functionName: string, message: string, data?: unknown): void {
  console.warn(formatMessage('warn', functionName, message));

  if (data !== undefined) {
    console.warn(`[${functionName}] Details:`, data);
  }
}

/**
 * Log request details (headers, body, etc.)
 */
export function logApiRequest(context: ApiLogContext & {
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
}): void {
  const { functionName, method, url, headers, body, params } = context;

  console.log(`[${functionName}] 📤 Request Details:`);

  if (method && url) {
    console.log(`[${functionName}]   Method: ${method}`);
    console.log(`[${functionName}]   URL: ${url}`);
  }

  if (params && Object.keys(params).length > 0) {
    console.log(`[${functionName}]   Query Params:`, params);
  }

  if (headers) {
    // Sanitize sensitive headers (show only first/last chars of tokens)
    const sanitizedHeaders = { ...headers };
    if (sanitizedHeaders.Authorization) {
      const token = sanitizedHeaders.Authorization.replace('Bearer ', '');
      sanitizedHeaders.Authorization = `Bearer ${token.substring(0, 20)}...${token.substring(token.length - 5)}`;
    }
    console.log(`[${functionName}]   Headers:`, sanitizedHeaders);
  }

  if (body !== undefined) {
    console.log(`[${functionName}]   Body:`, body);
  }
}

/**
 * Log response details
 */
export function logApiResponse(context: ApiLogContext & {
  status: number;
  statusText: string;
  ok: boolean;
  headers?: Headers;
  body?: unknown;
}): void {
  const { functionName, status, statusText, ok, headers, body } = context;

  const emoji = ok ? '✅' : '❌';
  console.log(`[${functionName}] 📥 Response: ${emoji} ${status} ${statusText}`);

  if (headers) {
    console.log(`[${functionName}]   Headers:`, Object.fromEntries(headers.entries()));
  }

  if (body !== undefined) {
    console.log(`[${functionName}]   Body:`, body);
  }
}

/**
 * Log authentication details (sanitized)
 */
export function logApiAuth(functionName: string, context: {
  userId?: string;
  hasToken?: boolean;
  tokenLength?: number;
}): void {
  console.log(`[${functionName}] 🔐 Authentication:`);

  if (context.userId) {
    console.log(`[${functionName}]   User ID: ${context.userId}`);
  }

  if (context.hasToken !== undefined) {
    console.log(`[${functionName}]   Has Token: ${context.hasToken}`);
  }

  if (context.tokenLength) {
    console.log(`[${functionName}]   Token Length: ${context.tokenLength} chars`);
  }
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
  logApiStart(context);

  try {
    const result = await apiCall();
    logApiSuccess(context.functionName, 'API call completed successfully');
    logApiEnd(context.functionName, true);
    return result;
  } catch (error) {
    logApiError(context.functionName, 'API call failed', error);
    logApiEnd(context.functionName, false);
    return null;
  }
}

/**
 * Compact logging for client-side (less verbose)
 */
export function logApiCompact(
  functionName: string,
  level: LogLevel,
  message: string,
  data?: unknown
): void {
  const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  logFn(formatMessage(level, functionName, message));

  if (data !== undefined) {
    logFn(data);
  }
}
