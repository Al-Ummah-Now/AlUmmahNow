/**
 * Internal Studio comments endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). Not part of the public contract.
 *
 *   POST /internal/channel-comments/retry  { job: 'rebuild', channelId } | { job: 'purge' }
 *     The admin Errors page's Retry on a channel comment index rebuild or the
 *     daily removed-comment purge that gave up (admin-api runs it through its
 *     service binding, lib/errors-actions.ts): queues the job again.
 */

import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import { Hono } from 'hono';
import { retryChannelCommentsJob, type ChannelCommentsJobEnv } from '../../lib/channelComments/jobs';

const Retry = z.discriminatedUnion('job', [
	z.object({ job: z.literal('rebuild'), channelId: RecordId }),
	z.object({ job: z.literal('purge') }),
]);

export function createChannelCommentsInternalRouter() {
	const app = new Hono<{ Bindings: ChannelCommentsJobEnv }>();

	app.post('/retry', async (c) => {
		const parsed = Retry.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'A valid channelId is required for a rebuild' }, 400);
		const body = parsed.data;
		const queued = await retryChannelCommentsJob(c.env, body.job, body.job === 'rebuild' ? body.channelId : undefined);
		if (!queued) return c.json({ success: false, error: 'A valid channelId is required for a rebuild' }, 400);
		return c.json({ success: true, result: { queued: true } });
	});

	return app;
}
