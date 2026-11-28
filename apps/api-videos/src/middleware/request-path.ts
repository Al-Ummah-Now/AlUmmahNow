import type { Context, Next } from 'hono';
import { z } from 'zod';
import { apiError } from '../lib/api-error';

// The router splits on literal slashes. A decoded parameter must still occupy
// one segment when it reaches R2 keys, cache keys, or service paths.
const PathSegment = z.string().max(512).refine(
	(segment) => segment !== '.' && segment !== '..' &&
		!/[\\/\p{Cc}]/u.test(segment) && !segment.includes('::'),
);

export async function validateRequestPath(c: Context, next: Next): Promise<Response | void> {
	try {
		const segments = new URL(c.req.url).pathname.split('/');
		if (!segments.every((segment) => PathSegment.safeParse(decodeURIComponent(segment)).success)) {
			return apiError(c, 400, 'invalid_request');
		}
	} catch {
		return apiError(c, 400, 'invalid_request');
	}
	await next();
}
