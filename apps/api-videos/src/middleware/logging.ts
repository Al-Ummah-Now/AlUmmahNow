import { Context, Next } from 'hono';
import { logger } from '../lib/logger';

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

const LOGGED = Symbol.for('al-ummah.request-logged');

/**
 * Request logging for the API.
 *
 * Workers Logs bills every log line, so successful requests log only at
 * debug (LOG_LEVEL=debug to see them); 4xx log a warning and 5xx/thrown
 * errors log an error. Headers are never logged (they carry cookies and
 * bearer tokens), nor are request or success response bodies outside debug.
 * The middleware is registered on the app and on the OpenAPI router, which
 * share requests, so it runs once per request.
 */
export async function loggingMiddleware(c: Context, next: Next) {
	const raw = c.req.raw as Request & { [LOGGED]?: boolean };
	if (raw[LOGGED]) return next();
	raw[LOGGED] = true;

	const requestId = generateRequestId();
	const startTime = Date.now();
	const method = c.req.method;
	const path = new URL(c.req.url).pathname;

	const auth = c.get('auth');
	logger.debug(`[API REQUEST] ${method} ${path}`, {
		requestId,
		method,
		path,
		auth: auth ? { userId: auth.userId } : undefined,
	});

	let error: unknown = null;
	try {
		await next();
	} catch (err) {
		error = err;
		throw err; // Re-throw to let error handlers catch it
	} finally {
		const status = c.res.status;
		const responseInfo = { requestId, status, duration: `${Date.now() - startTime}ms`, method, path };

		if (error) {
			logger.error(`[API RESPONSE] Error ${status} ${method} ${path}`, {
				...responseInfo,
				error: error instanceof Error ? error.message : 'Unknown error',
				stack: error instanceof Error ? error.stack : undefined,
			});
		} else if (status >= 400) {
			// Error bodies are short messages; success bodies may carry tokens.
			let body: unknown;
			try {
				const text = await c.res.clone().text();
				try {
					body = JSON.parse(text);
				} catch {
					body = text.substring(0, 500);
				}
			} catch {
				body = undefined;
			}
			if (status >= 500) {
				logger.error(`[API RESPONSE] Server Error ${status} ${method} ${path}`, { ...responseInfo, body });
			} else {
				logger.warn(`[API RESPONSE] Client Error ${status} ${method} ${path}`, { ...responseInfo, body });
			}
		} else {
			logger.debug(`[API RESPONSE] ${status} ${method} ${path}`, responseInfo);
		}
	}
}
