/**
 * Platform download rate-limit settings (internal; admin-api proxies with settings:manage and audit log).
 *
 *   GET /internal/downloads/rate-limit   { perDay, burstPerMinute, updatedAt, updatedBy }
 *   PUT /internal/downloads/rate-limit   { perDay, burstPerMinute, actorId }
 */

import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import { Hono } from 'hono';
import { validateDownloadRateLimit } from '@al-ummah/shared-types';
import { readDownloadRateLimit, writeDownloadRateLimit } from '../../lib/downloads/rate-limit-settings';
import { apiError } from '../../lib/api-error';
import { logger } from '../../lib/logger';

type Env = { global_settings?: R2Bucket };

const RateLimitBody = z.object({ actorId: RecordId, perDay: z.number(), burstPerMinute: z.number() });

export function createDownloadsInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	app.get('/rate-limit', async (c) => c.json({ success: true, result: await readDownloadRateLimit(c.env, true) }));

	app.put('/rate-limit', async (c) => {
		const input = RateLimitBody.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return apiError(c, 400, 'invalid_request', { error: 'Expected actorId, perDay and burstPerMinute' });
		const body = input.data;
		const parsed = validateDownloadRateLimit({ perDay: body.perDay, burstPerMinute: body.burstPerMinute });
		if ('error' in parsed) {
			const err = parsed.error;
			const msg =
				err.reason === 'exceeds_per_day'
					? 'burstPerMinute must not exceed perDay'
					: `${err.field} must be a whole number from ${err.min} to ${err.max}`;
			return apiError(c, 400, 'invalid_request', { error: msg });
		}
		const result = await writeDownloadRateLimit(c.env, parsed.value, body.actorId);
		logger.info('[Downloads] Rate-limit settings changed', {
			perDay: result.perDay,
			burstPerMinute: result.burstPerMinute,
			actorId: body.actorId,
		});
		return c.json({ success: true, result });
	});

	return app;
}
