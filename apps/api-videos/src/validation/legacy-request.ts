import type { HonoRequest } from 'hono';
import { z } from 'zod';

/** Backfill and maintenance routes historically accept a POST with no body. */
export function optionalJson(req: HonoRequest): Promise<unknown> {
	return req.raw.body === null ? Promise.resolve({}) : req.json().catch(() => null);
}

/** Decimal integer query strings without coercion from empty values or fractions. */
export const IntegerQuery = z.string().max(12).regex(/^[0-9]+$/).transform(Number);

/** Bucket object references must preserve each component when passed to another service. */
export const ObjectKey = z.string().max(512).regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/)
	.refine((key) => key.split('/').every((part) => part !== '.' && part !== '..'));
