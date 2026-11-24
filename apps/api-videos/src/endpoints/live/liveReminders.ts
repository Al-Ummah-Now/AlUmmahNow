/**
 * Reminders (wiki E17 §5.5), behind the `liveReminders` switch:
 *
 *   POST   /api/live-streams/:id/reminders   remind me
 *   DELETE /api/live-streams/:id/reminders   do not
 */
import { z } from 'zod';
import { AppContext, AuthenticatedRoute } from '../../base';
import { apiError } from '../../lib/api-error';
import { Str } from '../../lib/chanfana-params';
import { remindable, setReminder } from '../../lib/live/reminders';
import { addAuthToSchema } from '../../lib/openapi-auth';

const schemaFor = (summary: string) =>
	addAuthToSchema({
		tags: ['Live Streams'],
		summary,
		description: '🔒 A public stream or premiere that has not started. 30 minutes before and when it starts, within the person’s notification settings and quiet hours.',
		request: { params: z.object({ id: Str({ description: 'Live stream id' }) }) },
		responses: {
			'200': { description: 'Saved', content: { 'application/json': { schema: z.object({ success: z.boolean(), result: z.object({ set: z.boolean(), count: z.number().int() }) }) } } },
			'404': { description: 'Nothing to be reminded of', content: { 'application/json': { schema: z.object({ success: z.boolean(), code: z.string(), error: z.string() }) } } },
		},
	});

async function change(c: AppContext, streamId: string, userId: string, on: boolean) {
	const { SEARCH_DB: db, NOTIFICATIONS_DB: ndb } = c.env as { SEARCH_DB?: D1Database; NOTIFICATIONS_DB?: D1Database };
	if (!db || !ndb) return apiError(c, 503, 'service_unavailable', { retryAfter: 5 }, { 'Retry-After': '5' });
	const stream = await remindable(c.env as never, streamId);
	// Taking a reminder back always works
	if (!stream && on) return apiError(c, 404, 'not_found');
	const count = await setReminder(db, ndb, streamId, userId, on, stream?.count ?? 0);
	return c.json({ success: true, result: { set: on, count } });
}

export class LiveReminderSet extends AuthenticatedRoute {
	schema = schemaFor('Remind me of a live stream');
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		return change(c, params.id, this.getUserId(c), true);
	}
}

export class LiveReminderClear extends AuthenticatedRoute {
	schema = schemaFor('Do not remind me of a live stream');
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		return change(c, params.id, this.getUserId(c), false);
	}
}
