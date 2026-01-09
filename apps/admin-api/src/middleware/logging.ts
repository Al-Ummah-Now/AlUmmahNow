import { Context, Next } from 'hono';
import { logger } from '../lib/logger';

/**
 * Mask email address to prevent PII exposure in logs
 * Example: john.doe@example.com -> j***e@example.com
 */
function maskEmail(email?: string): string | undefined {
  if (!email) return undefined;

  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return email;

  if (localPart.length <= 2) {
    return `${localPart[0]}***@${domain}`;
  }

  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
}

/**
 * Sanitize sensitive headers
 */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized = { ...headers };

  // Sanitize Authorization header
  if (sanitized.authorization) {
    const parts = sanitized.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      sanitized.authorization = `Bearer ${parts[1].substring(0, 20)}...`;
    }
  }

  return sanitized;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Comprehensive logging middleware for ALL Admin API requests
 * Logs in a consistent format matching frontend logging
 */
export async function loggingMiddleware(c: Context, next: Next) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Extract request information
  const method = c.req.method;
  const url = c.req.url;
  const path = new URL(url).pathname;
  const query = new URL(url).searchParams.toString();

  // Get headers
  const rawHeaders: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    rawHeaders[key] = value;
  });
  const headers = sanitizeHeaders(rawHeaders);

  // Get authentication context if available
  const userId = c.get('userId') || c.req.header('userId') || 'unauthenticated';
  const auth = c.get('auth');

  const requestInfo = {
    requestId,
    timestamp: new Date().toISOString(),
    method,
    path,
    query: query || undefined,
    userId,
    headers,
    auth: auth ? { userId: auth.userId, email: maskEmail(auth.email), roles: auth.roles } : undefined,
  };

  logger.info(`[API REQUEST] ${method} ${path}`, requestInfo);

  // Log request body for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      const clonedReq = c.req.raw.clone();
      const contentType = c.req.header('content-type');

      if (contentType?.includes('application/json')) {
        const body = await clonedReq.json();
        logger.debug(`[API REQUEST] Body`, { requestId, body });
      } else if (contentType?.includes('multipart/form-data')) {
        logger.debug(`[API REQUEST] Body: FormData - File Upload`, { requestId });
      } else {
        logger.debug(`[API REQUEST] Body: ${contentType || 'unknown content type'}`, { requestId });
      }
    } catch (error) {
      logger.warn(`[API REQUEST] Unable to parse body`, { requestId, error });
    }
  }

  // Process the request
  let error: unknown = null;
  try {
    await next();
  } catch (err) {
    error = err;
    throw err; // Re-throw to let error handlers catch it
  } finally {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const status = c.res.status;

    const responseInfo = {
      requestId,
      status,
      duration: `${duration}ms`,
      method,
      path,
    };

    if (error) {
      logger.error(`[API RESPONSE] Error ${status} ${method} ${path}`, {
        ...responseInfo,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    } else {
      // Log response body for errors or non-GET requests
      if (status >= 400 || method !== 'GET') {
        try {
          const clonedRes = c.res.clone();
          const responseBody = await clonedRes.text();

          try {
            const json = JSON.parse(responseBody);
            if (status >= 500) {
              logger.error(`[API RESPONSE] Server Error ${status} ${method} ${path}`, {
                ...responseInfo,
                body: json,
              });
            } else if (status >= 400) {
              logger.warn(`[API RESPONSE] Client Error ${status} ${method} ${path}`, {
                ...responseInfo,
                body: json,
              });
            } else {
              logger.info(`[API RESPONSE] ${status} ${method} ${path}`, {
                ...responseInfo,
                body: json,
              });
            }
          } catch {
            logger.debug(`[API RESPONSE] ${status} ${method} ${path}`, {
              ...responseInfo,
              body: responseBody.substring(0, 500),
            });
          }
        } catch {
          logger.warn(`[API RESPONSE] Unable to read response body`, responseInfo);
        }
      } else {
        // Success - just log the basics
        logger.info(`[API RESPONSE] ${status} ${method} ${path}`, responseInfo);
      }
    }
  }
}
