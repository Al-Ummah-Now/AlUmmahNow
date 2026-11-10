import { Context, Next } from 'hono';
import { configureLogging, SLOW_MS } from '@al-ummah/logger';
import { logger } from '../lib/logger';

const LOGGED = Symbol.for('al-ummah.request-logged');
/** Set by the error handler once it has logged a thrown error with its stack. */
export const ERROR_LOGGED = Symbol.for('al-ummah.request-error-logged');

type MarkedRequest = Request & { [LOGGED]?: boolean; [ERROR_LOGGED]?: boolean };

/** Marks the request so the summary does not log the same failure twice. */
export function markErrorLogged(c: Context): void {
	(c.req.raw as MarkedRequest)[ERROR_LOGGED] = true;
}

/**
 * Upload data (TUS chunks, thumbnails, community images) is slow by nature: a
 * 50 MB chunk takes seconds. Those requests warn only past 30 s.
 */
const UPLOAD_DATA = /\/tus(\/|$)|\/upload|\/thumbnail$|\/images$|\/gif$/;
const UPLOAD_SLOW_MS = 30_000;

export function slowThresholdMs(method: string, path: string): number {
	return method !== 'GET' && method !== 'HEAD' && UPLOAD_DATA.test(path) ? UPLOAD_SLOW_MS : SLOW_MS;
}

/** Short message from a JSON error body ({ error } / { message }), for 5xx summaries. */
async function errorMessage(res: Response): Promise<string | undefined> {
	try {
		const text = await res.clone().text();
		try {
			const body = JSON.parse(text) as { error?: unknown; message?: unknown };
			const msg = body?.error ?? body?.message;
			return typeof msg === 'string' ? msg.slice(0, 300) : undefined;
		} catch {
			return text.slice(0, 300) || undefined;
		}
	} catch {
		return undefined;
	}
}

/**
 * One summary line per request (logging policy, docs/operations/logging.md):
 * info with route, status, duration and ids — emitted at stage and below only —
 * warn when slower than SLOW_MS, error on a 5xx the error handler has not
 * already logged. Headers and bodies are never logged. Registered on the app and
 * on the OpenAPI router, which share requests, so it runs once per request.
 */
export async function loggingMiddleware(c: Context, next: Next) {
	const raw = c.req.raw as MarkedRequest;
	if (raw[LOGGED]) return next();
	raw[LOGGED] = true;
	configureLogging(c.env as Record<string, unknown> | undefined);

	const startTime = Date.now();
	let thrown: unknown;
	try {
		await next();
	} catch (err) {
		thrown = err;
		throw err; // Re-throw to let error handlers catch it
	} finally {
		const status = thrown ? 500 : c.res.status;
		const auth = c.get('auth') as { userId?: string } | undefined;
		const summary = {
			method: c.req.method,
			route: new URL(c.req.url).pathname,
			status,
			durationMs: Date.now() - startTime,
			ray: c.req.header('cf-ray') || undefined,
			userId: auth?.userId,
		};
		const slowMs = slowThresholdMs(summary.method, summary.route);
		if (status >= 500 || thrown) {
			if (!raw[ERROR_LOGGED]) {
				logger.request({ ...summary, error: thrown ?? (await errorMessage(c.res)) ?? `HTTP ${status}` }, slowMs);
			} else {
				logger.debug('request failed (logged by the error handler)', summary);
			}
		} else {
			logger.request(summary, slowMs);
		}
	}
}
