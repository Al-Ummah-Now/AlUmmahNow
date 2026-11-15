/**
 * Internal Studio comments endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). Not part of the public contract.
 *
 *   POST /internal/channel-comments/retry  { job: 'rebuild', channelId } | { job: 'purge' }
 *     The admin Errors page's Retry on a channel comment index rebuild or the
 *     daily removed-comment purge that gave up (admin-api runs it through its
 *     service binding, lib/errors-actions.ts): queues the job again.
 */

import { Hono } from 'hono';
import { retryChannelCommentsJob, type ChannelCommentsJobEnv } from '../../lib/channelComments/jobs';

export function createChannelCommentsInternalRouter() {
	const app = new Hono<{ Bindings: ChannelCommentsJobEnv }>();

	app.post('/retry', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { job?: unknown; channelId?: unknown } | null;
		const job = body?.job === 'rebuild' || body?.job === 'purge' ? body.job : null;
		const channelId = typeof body?.channelId === 'string' ? body.channelId : undefined;
		if (!job) return c.json({ success: false, error: "job must be 'rebuild' or 'purge'" }, 400);
		const queued = await retryChannelCommentsJob(c.env, job, channelId);
		if (!queued) return c.json({ success: false, error: 'A valid channelId is required for a rebuild' }, 400);
		return c.json({ success: true, result: { queued: true } });
	});

	return app;
}
