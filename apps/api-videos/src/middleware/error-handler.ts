import { Context } from 'hono';
import { logger } from '../lib/logger';

/**
 * Detect if we're running in development mode
 *
 * Checks multiple indicators:
 * 1. Wrangler dev mode (localhost URLs)
 * 2. NODE_ENV environment variable
 * 3. Custom ENVIRONMENT variable
 */
export function isDevelopmentMode(c: Context): boolean {
	// Check 1: URL-based detection (wrangler dev runs on localhost)
	const url = c.req.url;
	if (url.includes('localhost') || url.includes('127.0.0.1')) {
		return true;
	}

	// Check 2: Environment variable
	const nodeEnv = c.env?.NODE_ENV;
	if (nodeEnv === 'development' || nodeEnv === 'dev') {
		return true;
	}

	// Check 3: Custom environment variable
	const environment = c.env?.ENVIRONMENT;
	if (environment === 'development' || environment === 'dev' || environment === 'preview') {
		return true;
	}

	// Default to production (safe mode)
	return false;
}

/**
 * Extract useful error information
 */
function getErrorDetails(error: any) {
	const details: any = {
		message: error?.message || 'Unknown error',
		name: error?.name || 'Error',
	};

	// Add stack trace if available
	if (error?.stack) {
		details.stack = error.stack.split('\n').map((line: string) => line.trim());
	}

	// Add cause if available (nested errors)
	if (error?.cause) {
		details.cause = getErrorDetails(error.cause);
	}

	// Add any custom properties
	if (error && typeof error === 'object') {
		Object.keys(error).forEach(key => {
			if (!['message', 'name', 'stack', 'cause'].includes(key)) {
				details[key] = error[key];
			}
		});
	}

	return details;
}

/**
 * Format error response based on environment
 */
export function formatErrorResponse(error: any, isDev: boolean) {
	const baseResponse = {
		success: false,
		error: error?.message || 'Internal server error',
	};

	// In development, add detailed debugging information
	if (isDev) {
		return {
			...baseResponse,
			debug: {
				...getErrorDetails(error),
				timestamp: new Date().toISOString(),
				environment: 'development',
			},
		};
	}

	// In production, return minimal safe error
	return baseResponse;
}

/**
 * Determine HTTP status code from error
 */
export function getErrorStatusCode(error: any): number {
	// Check for explicit status code
	if (error?.status && typeof error.status === 'number') {
		return error.status;
	}

	if (error?.statusCode && typeof error.statusCode === 'number') {
		return error.statusCode;
	}

	// Check error name/type
	if (error?.name === 'ValidationError' || error?.name === 'ZodError') {
		return 400;
	}

	if (error?.name === 'UnauthorizedError' || error?.message?.includes('Unauthorized')) {
		return 401;
	}

	if (error?.name === 'ForbiddenError' || error?.message?.includes('Forbidden')) {
		return 403;
	}

	if (error?.name === 'NotFoundError' || error?.message?.includes('not found')) {
		return 404;
	}

	if (error?.name === 'ConflictError' || error?.message?.includes('already exists')) {
		return 409;
	}

	// Default to 500 for unknown errors
	return 500;
}

/**
 * Global error handler middleware
 *
 * Catches all unhandled errors and returns formatted responses.
 * In development: Returns detailed error information with stack traces.
 * In production: Returns safe, minimal error messages.
 *
 * Usage: Add as the LAST middleware in the chain (after all other middleware)
 *
 * @example
 * import { errorHandler } from './middleware/error-handler';
 * app.onError(errorHandler);
 */
export function errorHandler(err: Error, c: Context) {
	const isDev = isDevelopmentMode(c);
	const statusCode = getErrorStatusCode(err);

	// Log the error
	logger.error(`[ERROR HANDLER] ${err.name}: ${err.message}`, {
		error: getErrorDetails(err),
		statusCode,
		method: c.req.method,
		path: c.req.path,
		isDevelopment: isDev,
	});

	// Transient errors (a lost write race, ConcurrentUpdateError) say when to retry
	const retryAfter = (err as { retryAfterSeconds?: unknown })?.retryAfterSeconds;
	if (typeof retryAfter === 'number' && retryAfter > 0) c.header('Retry-After', String(retryAfter));

	// Format and return error response
	const response = formatErrorResponse(err, isDev);
	return c.json(response, statusCode as any);
}
