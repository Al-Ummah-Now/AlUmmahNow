/**
 * The emails of a channel move (wiki AUN-CHANNEL-CLAIM §3.6, §5, CC-7c): the receiver when an offer is
 * made, and both owners when a channel moved, admin moves included. admin-api sends them from its
 * contact mail queue (lib/channel-move-mail.ts): the job carries ids only, and what it says is read
 * here when it is sent, so an email that no longer applies (an offer answered or withdrawn) is not.
 */
import { CHANNEL_MOVE_MAIL_EVENTS, featureGate, localizedDisplayNames, reportNeedsAction, resolveDisplayName, type ChannelMoveMail, type ChannelMoveMailEvent, type ChannelMoveMailJob, type ErrorReporterEnv, type NameFields, type SearchDb } from '@al-ummah/shared-types';
import { AdminError } from './admin/service';
import { readBan } from './admin/bans';
import { getJob } from './admin/jobs';
import { moveOutcome } from './channelMoveOutcome';
import { isGone, type MoveOfferRow } from './channelMoves';
import { keepsContactEmail } from './channelMoveViews';
import { logger } from './logger';
import R2Repository from './r2Repo';

type Row = Record<string, any>;
const parseJson = (raw: string | null): Record<string, unknown> => {
	try {
		return (JSON.parse(raw || '{}') as Record<string, unknown> | null) ?? {};
	} catch {
		return {};
	}
};
interface Env {
	SEARCH_DB?: unknown;
	profiles: R2Bucket;
	channels: R2Bucket;
}

/** Queues one email. Never throws: the move or offer stands, and a job that can't be queued is on the admin Errors page with Retry. */
export async function queueMoveMail(env: object, event: ChannelMoveMailEvent, id: string): Promise<void> {
	const job: ChannelMoveMailJob = { v: 1, kind: 'channel_move', event, id };
	try {
		const queue = (env as { CONTACT_MAIL_QUEUE?: { send(message: unknown, opts?: unknown): Promise<unknown> } }).CONTACT_MAIL_QUEUE;
		if (!queue) throw new Error('CONTACT_MAIL_QUEUE is not bound');
		await queue.send(job, { contentType: 'json' });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('[ChannelMoveMail] Not queued', { event, id, error: message });
		// Waited for: a report left running would be dropped when the request ends
		let reported: Promise<unknown> = Promise.resolve();
		reportNeedsAction('api-videos', env as ErrorReporterEnv, { waitUntil: (work) => void (reported = work) }, {
			key: `channel-move-mail:${event}:${id}`,
			source: 'email',
			title: 'Channel move email not sent',
			message: `The email could not be queued: ${message}`,
			itemType: 'channel-move-mail',
			itemId: id,
			retry: { kind: 'builtin', handler: 'channel-move-mail', args: { event, id } },
			retryLabel: 'Send again',
		});
		await reported;
	}
}

const gone = () => new AdminError(404, 'nothing_to_send');

/** Where an email's outcome is kept: on the offer, or on the move's job (json paths of columns neither writes again). */
const MAIL_STATE: Record<ChannelMoveMailEvent, { table: string; column: string; path: string }> = {
	offered: { table: 'channel_move_offers', column: 'options_json', path: '$.email' },
	moved_in: { table: 'admin_jobs', column: 'params', path: '$.emails.moved_in' },
	moved_out: { table: 'admin_jobs', column: 'params', path: '$.emails.moved_out' },
};
/** Outcomes after which nothing is sent again, whenever it is asked for (Resend forgets its key after a day). */
const MAIL_DONE = new Set(['sent', 'sunk', 'disabled', 'no_address']);

/** Keeps how an email ended. One that ended for good stays so: a late or overlapping failure never reopens it. */
export async function recordMoveMail(env: Env, event: string, id: string, status: string): Promise<void> {
	if (!(CHANNEL_MOVE_MAIL_EVENTS as readonly string[]).includes(event)) throw gone();
	const { table, column, path } = MAIL_STATE[event as ChannelMoveMailEvent];
	await (env.SEARCH_DB as D1Database)
		.prepare(`UPDATE ${table} SET ${column} = json_set(COALESCE(${column}, '{}'), ?2, ?3) WHERE id = ?1${table === 'admin_jobs' ? " AND kind = 'channel.transfer'" : ''}
			 AND COALESCE(json_extract(${column}, ?2), '') NOT IN (${[...MAIL_DONE].map((done) => `'${done}'`).join(', ')})`)
		.bind(id, path, status)
		.run();
}

/** What the email says now; 404 nothing_to_send when it no longer applies. */
export async function readMoveMail(env: Env, event: string, id: string, now = Date.now()): Promise<ChannelMoveMail> {
	if (!(CHANNEL_MOVE_MAIL_EVENTS as readonly string[]).includes(event)) throw gone();
	const profiles = new R2Repository<Row>(env.profiles);
	const channelOf = async (channelId: string) => {
		const channel = await new R2Repository<Row>(env.channels).getObject(channelId);
		if (!channel || channel.isDeleted) throw gone();
		return channel;
	};
	const named = (c: Row): ChannelMoveMail['channel'] => ({ id: c.id, name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null, ...(c.nameLocalized ? { nameLocalized: c.nameLocalized } : {}) });
	/** Nobody is written to while their account here is deleted or being deleted. A banned person is told of a move (CC-D11), not offered one. */
	const recipient = async (userId: string, offered: boolean) => {
		if (isGone(await profiles.getObject(userId))) throw gone();
		if (offered && (await readBan(env.SEARCH_DB as SearchDb, userId))) throw gone();
		return userId;
	};
	const person = async (userId: unknown): Promise<ChannelMoveMail['other']> => {
		const profile = typeof userId === 'string' ? await profiles.getObject(userId) : null;
		if (!profile || isGone(profile)) return { name: null };
		const localized = localizedDisplayNames(profile as NameFields);
		return { name: resolveDisplayName(profile as NameFields) || null, ...(Object.keys(localized).length ? { nameLocalized: localized } : {}) };
	};

	if (event === 'offered') {
		const offer = await (env.SEARCH_DB as D1Database).prepare('SELECT * FROM channel_move_offers WHERE id = ?').bind(id).first<MoveOfferRow>();
		// Answered, withdrawn, stopped or expired meanwhile, or the pages are off
		if (!offer || offer.status !== 'offered' || Date.parse(offer.expires_at) <= now) throw gone();
		if (MAIL_DONE.has((parseJson(offer.options_json) as { email?: string }).email ?? '')) throw gone();
		if (!(await featureGate(env as never, 'channelMove')).on) throw gone();
		const channel = await channelOf(offer.channel_id);
		if (channel.userId !== offer.from_user_id) throw gone();
		return {
			event,
			recipientId: await recipient(offer.to_user_id, true),
			channel: named(channel),
			other: await person(offer.from_user_id),
			reason: null,
			keptAsAdmin: false,
			offer: { id: offer.id, expiresAt: offer.expires_at, keepContactEmail: keepsContactEmail(offer) },
		};
	}

	const job = await getJob(env as never, id);
	const params = (job?.params ?? {}) as { newOwnerId?: string; previousOwnerId?: string | null; offerId?: string; reason?: string; keepPreviousOwnerAsAdmin?: boolean; emails?: Record<string, string> };
	if (!job || job.kind !== 'channel.transfer' || !params.newOwnerId) throw gone();
	if (MAIL_DONE.has(params.emails?.[event] ?? '')) throw gone();
	const recipientId = event === 'moved_in' ? params.newOwnerId : params.previousOwnerId;
	if (!recipientId) throw gone();
	const channel = await channelOf(job.targetId);
	if (moveOutcome(job, channel as { userId?: string }) !== 'moved') throw gone();
	// Moved on since: not theirs any more. The previous owner still hears that it left them, unless it came back
	if (event === 'moved_in' ? channel.userId !== recipientId : channel.userId === recipientId) throw gone();
	return {
		event: event as 'moved_in' | 'moved_out',
		recipientId: await recipient(recipientId, false),
		channel: named(channel),
		other: params.offerId ? await person(event === 'moved_in' ? params.previousOwnerId : params.newOwnerId) : null,
		reason: event === 'moved_out' && !params.offerId && params.reason?.trim() ? params.reason.trim() : null,
		keptAsAdmin: params.keepPreviousOwnerAsAdmin === true,
		offer: null,
	};
}
