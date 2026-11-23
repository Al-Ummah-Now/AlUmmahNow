/**
 * POST /webhooks/support/:side/:vendor (wiki AUN-MEMBERS §9.4). side = collector | rail.
 * The raw body is read before anything parses it (the signature covers its exact bytes). Unknown
 * or unavailable vendors answer 404, which in production is every vendor today: only the test
 * adapters exist, and only on QA and the local stack.
 */
import type { Context } from 'hono';
import { logger } from '../../lib/logger';
import { receiveSupportWebhook, type SupportJobEnv } from '../../lib/support/jobs';

export async function handleSupportWebhook(c: Context) {
	const raw = await c.req.text();
	if (raw.length > 256 * 1024) return c.json({ received: false, error: 'Too large' }, 413);
	try {
		const outcome = await receiveSupportWebhook(c.env as SupportJobEnv, c.req.param('side') ?? '', c.req.param('vendor') ?? '', raw, c.req.raw.headers);
		if (outcome.status === 200) return c.json({ received: true, duplicate: outcome.duplicate });
		return c.json({ received: false, error: outcome.error }, outcome.status);
	} catch (error) {
		logger.error('[Support] Webhook intake failed', { side: c.req.param('side'), vendor: c.req.param('vendor'), error: error instanceof Error ? error.message : String(error) });
		return c.json({ received: false, error: 'Try again' }, 503);
	}
}
