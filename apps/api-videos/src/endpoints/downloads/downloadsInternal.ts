/**
 * Platform download rate-limit settings (internal; admin-api proxies with settings:manage and audit log).
 *
 *   GET /internal/downloads/rate-limit   { perDay, burstPerMinute, updatedAt, updatedBy }
 *   PUT /internal/downloads/rate-limit   { perDay, burstPerMinute, actorId }
 */

import { Hono } from 'hono';
import { validateDownloadRateLimit } from '@al-ummah/shared-types';
import { readDownloadRateLimit, writeDownloadRateLimit } from '../../lib/downloads/rate-limit-settings';
import { apiError } from '../../lib/api-error';
import { logger } from '../../lib/logger';

type Env = { global_settings?: R2Bucket };

export function createDownloadsInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	app.get('/rate-limit', async (c) => c.json({ success: true, result: await readDownloadRateLimit(c.env, true) }));

	app.put('/rate-limit', async (c) => {
		const body = (await c.req.json().catch(() => null)) as {
			perDay?: unknown;
			burstPerMinute?: unknown;
			actorId?: unknown;
		} | null;
		if (!body || typeof body.actorId !== 'string' || !body.actorId) {
			return apiError(c, 400, 'invalid_request', { error: 'actorId is required' });
		}
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
