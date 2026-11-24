/**
 * Account events from Auth (AlUmmahNowAuth docs/account-hub/SPEC.md §5.4, push delivery RFC 8935):
 *
 *   POST /webhooks/auth/account-events   application/secevent+jwt: one signed event
 *       202  received (or received before): the worker does the rest (lib/account-events/jobs.ts)
 *       400  { err, description }: refused for good, the sender does not try again
 *       404  feature_off while the switch `accountEvents` is off (middleware/require-feature.ts)
 *       503  could not be checked, stored or queued: the sender tries again
 *   POST /internal/account-events/retry  { jti } the Errors page's Retry of an event that gave up (X-API-Key)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { apiError } from '../../lib/api-error';
import { logger } from '../../lib/logger';
import { ACCOUNT_ACTIONS, dbOf, enqueue, retryAccountEvent, type AccountActions, type AccountEventsEnv } from '../../lib/account-events/jobs';
import { readSet, SetError } from '../../lib/account-events/set';
import { readReceived, recordReceived } from '../../lib/account-events/store';

const MAX_BYTES = 8 * 1024;
type AppContext = Context<{ Bindings: AccountEventsEnv }>;

const refused = (c: Context, code: string, description: string) => c.json({ err: code, description }, 400, { 'Cache-Control': 'no-store' });

export const accountEventsHandler = (actions: AccountActions = ACCOUNT_ACTIONS) => async (c: AppContext) => {
	if (c.req.header('Content-Type')?.split(';')[0]!.trim().toLowerCase() !== 'application/secevent+jwt') return refused(c, 'invalid_request', 'Send application/secevent+jwt');
	const body = await c.req.arrayBuffer();
	if (body.byteLength > MAX_BYTES) return refused(c, 'invalid_request', 'Too long');
	try {
		const event = await readSet(new TextDecoder().decode(body).trim(), c.env);
		// Not handled here yet: refused, so Auth keeps it and can send it again
		if (event.type !== 'verification' && !actions[event.type]) return refused(c, 'invalid_request', 'The event is not handled here');
		const db = dbOf(c.env);
		const now = Date.now();
		await recordReceived(db, event, now);
		// Queued once. A repeat of an event whose first queueing failed queues it now
		const row = await readReceived(db, event.jti);
		if (row?.status === 'received' && row.queued_at === null) await enqueue(c.env, event.jti, now);
		return c.body(null, 202, { 'Cache-Control': 'no-store' });
	} catch (error) {
		if (error instanceof SetError) {
			logger.warn('[AccountEvents] Refused', { code: error.code, reason: error.message });
			return refused(c, error.code, error.message);
		}
		logger.error('[AccountEvents] Could not take the event', { error: error instanceof Error ? error.message : String(error) });
		return apiError(c, 503, 'service_unavailable', undefined, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
	}
};

export function createAccountEventsInternalRouter() {
	const app = new Hono<{ Bindings: AccountEventsEnv }>();
	app.post('/retry', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { jti?: unknown } | null;
		let ctx: ExecutionContext | undefined;
		try {
			ctx = c.executionCtx as ExecutionContext;
		} catch {
			// tests, outside a request
		}
		// Nothing left to retry: the Errors page dismisses the item on 404
		return (await retryAccountEvent(c.env, body?.jti, ctx)) ? c.json({ success: true, queued: true }, 202) : apiError(c, 404, 'not_found');
	});
	return app;
}
