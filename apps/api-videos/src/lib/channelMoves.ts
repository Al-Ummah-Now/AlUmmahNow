/**
 * Channel moves by owners (wiki AUN-CHANNEL-CLAIM §5, owner decisions CC-D1 to CC-D4 of 2026-11-23).
 *
 * An owner offers their channel to one of its current channel admins; the admin accepts, and the
 * move runs at once through the same job as an admin move (`channel.transfer`, lib/admin/service.ts),
 * so every record, lock, live, support and channel-limit rule is the same. Nobody else can receive a
 * channel this way: a move to someone who isn't one of its admins is an admin move or a claim.
 *
 * A channel that accepts payments (creator support set up) is refused here until moves of such
 * channels can wait for an admin's approval on the approval workflow system (AUN-WORKFLOWS).
 */
import { channelRoleOf, localizedDisplayNames, resolveDisplayName, stripBidiControls, type NameFields } from '@al-ummah/shared-types';
import { OFFICIAL_HANDLES } from './channelHandles';
import R2Repository from './r2Repo';
import { logger } from './logger';
import { channelParams } from './channelName';
import { enqueueNotification } from './notifications';
import { readBan } from './admin/bans';
import { channelReportUnderReview, type ReportStatusEnv } from './channelReportStatus';
import { AdminError, channelHasSupport, channelIsLive, hasChannelRoom, openTransferJob, transferChannel, type AdminServiceEnv } from './admin/service';

/** An offer stays open this long. */
export const MOVE_OFFER_DAYS = 7;
/** The owner must have signed in this recently to make an offer. */
export const MOVE_REAUTH_SECONDS = 10 * 60;
/** An accept still claimed after this long never finished. */
export const MOVE_STALE_ACCEPT_MS = 10 * 60 * 1000;
/** A channel can be moved by its owner at most once in this many days. */
export const MOVE_COOLDOWN_DAYS = 30;

export type MoveOfferStatus = 'offered' | 'accepting' | 'moved' | 'declined' | 'cancelled' | 'expired' | 'stopped' | 'refused';

export interface MoveOfferRow {
	id: string;
	channel_id: string;
	from_user_id: string;
	to_user_id: string;
	options_json: string;
	status: MoveOfferStatus;
	job_id: string | null;
	created_at: string;
	expires_at: string;
	responded_at: string | null;
	updated_at: string;
}

export class MoveError extends Error {
	constructor(public status: 400 | 403 | 404 | 409 | 503, public code: string, message?: string) {
		super(message ?? code);
	}
}

type Row = Record<string, any>;
type Env = AdminServiceEnv & ReportStatusEnv & { SEARCH_DB?: D1Database; profiles: R2Bucket; channels: R2Bucket };

const db = (env: Env): D1Database => {
	if (!env.SEARCH_DB) throw new MoveError(503, 'unavailable', 'Channel moves are not available right now');
	return env.SEARCH_DB as D1Database;
};
const iso = (ms: number) => new Date(ms).toISOString();

async function loadChannel(env: Env, channelId: string): Promise<Row> {
	const channel = await new R2Repository<Row>(env.channels).getObject(channelId);
	if (!channel || channel.isDeleted) throw new MoveError(404, 'channel_not_found', 'Channel not found');
	return channel;
}

async function profileOf(env: Env, userId: string): Promise<Row | null> {
	return new R2Repository<Row>(env.profiles).getObject(userId);
}

/** A person in a notice: `owner`, and `owner_ar`/`owner_en`; never an id, a handle or an email. */
function personParams(key: string, profile: Row | null): Record<string, string> {
	const name = resolveDisplayName(profile as NameFields | null);
	// As the web says it (i18n-channel-moves `someone`)
	if (!name) return { [key]: 'Someone', [`${key}_en`]: 'Someone', [`${key}_ar`]: 'أحد الأشخاص' };
	return { [key]: name, ...Object.fromEntries(Object.entries(localizedDisplayNames(profile as NameFields | null)).map(([lang, text]) => [`${key}_${lang}`, text])) };
}

/** A profile whose person is not shown: none, deleted, or its videos data is being deleted. */
export const isGone = (profile: Row | null | undefined): boolean => !profile || profile.isDeleted === true || !!profile.adminDeletion;

/**
 * The channel's admins (channel roles), for the owner's receiver autocomplete, matched on name in any
 * language. The receiver is always picked by user id from this list, never matched by an email.
 */
export async function moveReceivers(env: Env, channelId: string, ownerId: string, q: string): Promise<Array<{ userId: string; name: string | null; nameLocalized?: Record<string, string>; avatarUrl: string | null }>> {
	const channel = await loadChannel(env, channelId);
	if (channel.userId !== ownerId) throw new MoveError(403, 'not_owner', 'Only the channel owner can move it');
	const admins = (Array.isArray(channel.members) ? channel.members : []).filter((m: Row) => m?.role === 'admin' && typeof m.userId === 'string');
	const needle = q.trim().toLowerCase();
	const out = [];
	for (const member of admins) {
		const profile = await profileOf(env, member.userId);
		if (isGone(profile)) continue;
		const name = resolveDisplayName(profile as NameFields) || null;
		const nameLocalized = localizedDisplayNames(profile as NameFields);
		if (needle && ![name ?? '', ...Object.values(nameLocalized)].some((v) => v.toLowerCase().includes(needle))) continue;
		out.push({ userId: member.userId, name, ...(Object.keys(nameLocalized).length ? { nameLocalized } : {}), avatarUrl: typeof profile!.avatarUrl === 'string' ? profile!.avatarUrl : null });
	}
	return out;
}

/** A notice about an offer; it opens the offer's page. */
async function notify(env: Env, recipient: string, key: string, params: Record<string, string>, channelId: string, offerId: string, dedupeKey: string): Promise<void> {
	try {
		await enqueueNotification(env as never, { notificationId: crypto.randomUUID(), recipientUserId: recipient, notificationKey: key as never, params, actionUrl: `/channel-moves/${offerId}`, entityId: channelId, dedupeKey, createdAt: Date.now() });
	} catch (error) {
		logger.warn('[ChannelMoves] Notice failed', { channelId, key, error: error instanceof Error ? error.message : String(error) });
	}
}

/** Everything that must hold for the channel to go from its owner to `toUserId` (offer and accept both check it). */
async function checkMovable(env: Env, channel: Row, toUserId: string): Promise<void> {
	// Spec §5: a suspended channel stays with its owner until the suspension is lifted
	// ... and one hidden with its owner's account (a ban, or its data being deleted) stays with it
	if (channel.isSuspended || (Array.isArray(channel.suspensionHolds) && channel.suspensionHolds.length)) throw new MoveError(409, 'channel_suspended', 'A suspended channel can’t be moved');
	if (channelRoleOf(channel as never, toUserId) !== 'admin') throw new MoveError(409, 'receiver_not_channel_admin', 'The channel can only go to one of its admins');
	const handle = typeof channel.handle === 'string' ? channel.handle.toLowerCase() : '';
	if (handle && OFFICIAL_HANDLES.has(handle)) throw new MoveError(409, 'official_handle', 'A channel with an official handle is moved by the team');
	if (await openTransferJob(env, channel.id)) throw new MoveError(409, 'transfer_in_progress');
	if (await channelIsLive(env, channel.id)) throw new MoveError(409, 'channel_is_live');
	if (await channelHasSupport(env, channel.id)) throw new MoveError(409, 'channel_has_support', 'A channel that accepts payments needs the team’s approval to move');
	if (await readBan(db(env) as never, toUserId)) throw new MoveError(409, 'new_owner_banned');
	if (!(await hasChannelRoom(db(env), toUserId))) throw new MoveError(409, 'new_owner_channel_limit');
	// Spec §5: not while the team is reviewing a report about the channel; unknown is refused too
	const underReview = await channelReportUnderReview(env, channel.id);
	if (underReview === null) throw new MoveError(503, 'move_check_unavailable', 'The channel could not be checked');
	if (underReview) throw new MoveError(409, 'channel_under_review', 'A report about this channel is under review');
}

/**
 * The owner offers the channel to one of its admins. Needs a sign-in in the last 10 minutes and the
 * channel's @handle typed; one open offer per channel, one completed move per 30 days.
 */
export async function createMoveOffer(
	env: Env,
	input: { channelId: string; ownerId: string; toUserId: string; typed: string; keepContactEmail?: boolean; authTime: number; now?: number },
): Promise<MoveOfferRow> {
	const now = input.now ?? Date.now();
	const channel = await loadChannel(env, input.channelId);
	if (channel.userId !== input.ownerId) throw new MoveError(403, 'not_owner', 'Only the channel owner can move it');
	if (input.toUserId === input.ownerId) throw new MoveError(400, 'already_owner');
	if (!input.authTime || now / 1000 - input.authTime > MOVE_REAUTH_SECONDS) throw new MoveError(403, 'reauth_required', 'Sign in again to move this channel');
	const want = String(channel.handle ?? channel.id).toLowerCase();
	// Copied from a label, the handle brings its isolates
	if (stripBidiControls(input.typed).trim().replace(/^@/, '').toLowerCase() !== want) throw new MoveError(400, 'confirm_mismatch', 'Type the channel’s @handle to confirm');
	await checkMovable(env, channel, input.toUserId);
	// An accept that never finished no longer blocks a new offer; before the 30-day check, because one that did start its move counts
	await settleStaleAccept(env, channel.id, now);
	const since = iso(now - MOVE_COOLDOWN_DAYS * 86_400_000);
	const recent = await db(env)
		.prepare(`SELECT 1 AS moved FROM channel_move_offers WHERE channel_id = ? AND status = 'moved' AND responded_at > ? LIMIT 1`)
		.bind(channel.id, since)
		.first<{ moved: number }>();
	if (recent) throw new MoveError(409, 'moved_recently', 'This channel was moved less than 30 days ago');
	const offer: MoveOfferRow = {
		id: crypto.randomUUID(),
		channel_id: channel.id,
		from_user_id: input.ownerId,
		to_user_id: input.toUserId,
		options_json: JSON.stringify({ keepContactEmail: input.keepContactEmail === true }),
		status: 'offered',
		job_id: null,
		created_at: iso(now),
		expires_at: iso(now + MOVE_OFFER_DAYS * 86_400_000),
		responded_at: null,
		updated_at: iso(now),
	};
	// An open offer that has expired no longer blocks a new one
	await db(env).prepare(`UPDATE channel_move_offers SET status = 'expired', updated_at = ? WHERE channel_id = ? AND status = 'offered' AND expires_at <= ?`).bind(iso(now), channel.id, iso(now)).run();
	const inserted = await db(env)
		.prepare(
			`INSERT OR IGNORE INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, options_json, status, job_id, created_at, expires_at, responded_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'offered', NULL, ?, ?, NULL, ?)`,
		)
		.bind(offer.id, offer.channel_id, offer.from_user_id, offer.to_user_id, offer.options_json, offer.created_at, offer.expires_at, offer.updated_at)
		.run();
	if (Number(inserted.meta?.changes ?? 0) !== 1) throw new MoveError(409, 'offer_open', 'This channel already has an open offer');
	const owner = await profileOf(env, input.ownerId);
	await notify(env, input.toUserId, 'channelMoveOffered', { ...channelParams('channel', channel as never), ...personParams('owner', owner) }, channel.id, offer.id, `move-offer:${offer.id}`);
	logger.info('[ChannelMoves] Offer made', { channelId: channel.id, offerId: offer.id });
	return offer;
}

/**
 * An accept whose worker died after the claim: moved when its move job was created (so the 30-day
 * limit still counts it), else refused.
 */
async function settleStaleAccept(env: Env, channelId: string, now: number): Promise<void> {
	const stale = await db(env)
		.prepare(`SELECT * FROM channel_move_offers WHERE channel_id = ? AND status = 'accepting' AND updated_at <= ?`)
		.bind(channelId, iso(now - MOVE_STALE_ACCEPT_MS))
		.first<MoveOfferRow>();
	if (!stale) return;
	const job = await db(env)
		.prepare(
			`SELECT id FROM admin_jobs WHERE target_kind = 'channel' AND target_id = ? AND created_at >= ? AND kind = 'channel.transfer'
			 AND json_extract(params, '$.newOwnerId') = ? AND json_extract(params, '$.previousOwnerId') = ? ORDER BY created_at LIMIT 1`,
		)
		.bind(channelId, stale.updated_at, stale.to_user_id, stale.from_user_id)
		.first<{ id: string }>();
	await db(env)
		.prepare(`UPDATE channel_move_offers SET status = ?, job_id = COALESCE(?, job_id), responded_at = updated_at, updated_at = ? WHERE id = ? AND status = 'accepting'`)
		.bind(job ? 'moved' : 'refused', job?.id ?? null, iso(now), stale.id)
		.run();
}

async function readOffer(env: Env, id: string): Promise<MoveOfferRow | null> {
	return db(env).prepare('SELECT * FROM channel_move_offers WHERE id = ?').bind(id).first<MoveOfferRow>();
}

/** Closes an open offer; false when it was no longer open (a race, or already answered). */
async function closeOffer(env: Env, id: string, status: MoveOfferStatus, now: number, jobId: string | null = null): Promise<boolean> {
	const res = await db(env)
		.prepare(`UPDATE channel_move_offers SET status = ?, job_id = COALESCE(?, job_id), responded_at = ?, updated_at = ? WHERE id = ? AND status = 'offered'`)
		.bind(status, jobId, iso(now), iso(now), id)
		.run();
	return Number(res.meta?.changes ?? 0) === 1;
}

async function openOfferFor(env: Env, id: string, now: number): Promise<MoveOfferRow> {
	const offer = await readOffer(env, id);
	if (!offer || offer.status !== 'offered') throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	if (offer.expires_at <= iso(now)) {
		await closeOffer(env, id, 'expired', now);
		throw new MoveError(404, 'offer_not_found', 'This offer has expired');
	}
	return offer;
}

/**
 * The admin accepts: the move runs at once (CC-D3) through the admin move job; the old owner keeps
 * no access (CC-D4). The offer is claimed first (offered → accepting, only while open and unexpired,
 * only by its receiver), so a cancel, decline or stop at the same moment either wins before the
 * claim (the accept is refused) or finds the offer no longer open (the move goes ahead). A refusal
 * after the claim puts the offer back as it was, or closes it when it can never succeed.
 */
export async function acceptMoveOffer(env: Env, id: string, userId: string, now = Date.now()): Promise<{ offer: MoveOfferRow; jobId: string }> {
	const claimed = await db(env)
		.prepare(`UPDATE channel_move_offers SET status = 'accepting', updated_at = ? WHERE id = ? AND to_user_id = ? AND status = 'offered' AND expires_at > ?`)
		.bind(iso(now), id, userId, iso(now))
		.run();
	if (Number(claimed.meta?.changes ?? 0) !== 1) {
		// Expired: closed now, so it stops showing; anything else was answered, withdrawn or stopped first
		await db(env).prepare(`UPDATE channel_move_offers SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'offered' AND expires_at <= ?`).bind(iso(now), id, iso(now)).run();
		throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	}
	const offer = (await readOffer(env, id))!;
	const settle = (status: MoveOfferStatus, jobId: string | null = null) =>
		db(env)
			.prepare(`UPDATE channel_move_offers SET status = ?, job_id = COALESCE(?, job_id), responded_at = CASE WHEN ? = 'offered' THEN NULL ELSE ? END, updated_at = ? WHERE id = ? AND status = 'accepting'`)
			.bind(status, jobId, status, iso(now), iso(now), id)
			.run();
	let channel: Row;
	let jobId: string;
	try {
		channel = await loadChannel(env, offer.channel_id);
		if (channel.userId !== offer.from_user_id) {
			throw new MoveError(409, 'owner_changed', 'The channel’s owner changed since the offer');
		}
		await checkMovable(env, channel, userId);
		const options = JSON.parse(offer.options_json || '{}') as { keepContactEmail?: boolean };
		// The owner is the actor: the new owner gets "You are now the owner", the owner hears "accepted" below
		const { job } = await transferChannel(env, offer.channel_id, userId, offer.from_user_id, {
			keepPreviousOwnerAsAdmin: false,
			keepContactEmail: options.keepContactEmail === true,
			expectedOwnerId: offer.from_user_id,
			offerId: id,
			// Under the lock: still this offer, between these two people. An erasure of either may have closed it since the claim
			confirm: async () => {
				const fresh = await readOffer(env, id);
				return fresh?.status === 'accepting' && fresh.to_user_id === userId && fresh.from_user_id === offer.from_user_id;
			},
		});
		jobId = job.id;
	} catch (error) {
		const refusal = error instanceof AdminError ? new MoveError(error.status === 422 ? 409 : (error.status as 400 | 403 | 404 | 409), error.code) : error;
		// No longer the channel's admin, or the channel is gone: the offer can never be accepted
		const final = refusal instanceof MoveError && ['receiver_not_channel_admin', 'channel_not_found', 'owner_changed'].includes(refusal.code);
		await settle(final ? 'refused' : 'offered').catch((e) => logger.error('[ChannelMoves] Could not settle a refused accept', { offerId: id, error: String(e) }));
		throw refusal;
	}
	// The move is queued: a failed write here must not answer as if it weren't (settleStaleAccept closes it later)
	const settled = await settle('moved', jobId).catch((e) => {
		logger.error('[ChannelMoves] Could not close an accepted offer', { offerId: id, jobId, error: String(e) });
		return null;
	});
	// An erasure closed it after the job was made: the job stops before the channel changes hands, unless it already has
	if (settled && Number(settled.meta?.changes ?? 0) !== 1 && (await readOffer(env, id))?.status !== 'moved') throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	const receiver = await profileOf(env, userId);
	await notify(env, offer.from_user_id, 'channelMoveAccepted', { ...channelParams('channel', channel as never), ...personParams('member', receiver) }, channel.id, id, `move-offer:${id}:accepted`);
	logger.info('[ChannelMoves] Offer accepted; move queued', { channelId: channel.id, offerId: id, jobId });
	return { offer: { ...offer, status: 'moved', job_id: jobId }, jobId };
}

export async function declineMoveOffer(env: Env, id: string, userId: string, now = Date.now()): Promise<void> {
	const offer = await openOfferFor(env, id, now);
	if (offer.to_user_id !== userId) throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	if (!(await closeOffer(env, id, 'declined', now))) throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	const channel = await loadChannel(env, offer.channel_id).catch(() => ({ id: offer.channel_id }) as Row);
	const receiver = await profileOf(env, userId);
	await notify(env, offer.from_user_id, 'channelMoveDeclined', { ...channelParams('channel', channel as never), ...personParams('member', receiver) }, offer.channel_id, id, `move-offer:${id}:declined`);
}

/** The owner withdraws the offer. */
export async function cancelMoveOffer(env: Env, id: string, userId: string, now = Date.now()): Promise<void> {
	const offer = await readOffer(env, id);
	if (!offer || offer.from_user_id !== userId) throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	// Expired (closed now) or no longer open: nothing to withdraw, and nobody is told
	await openOfferFor(env, id, now);
	if (!(await closeOffer(env, id, 'cancelled', now))) throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	const channel = await loadChannel(env, offer.channel_id).catch(() => ({ id: offer.channel_id }) as Row);
	await notify(env, offer.to_user_id, 'channelMoveCancelled', channelParams('channel', channel as never), offer.channel_id, id, `move-offer:${id}:cancelled`);
}

/** An admin stops an open offer (CC-D1: "an admin can stop a move"); both sides are told. */
export async function stopMoveOffer(env: Env, channelId: string, id: string, now = Date.now()): Promise<MoveOfferRow> {
	const offer = await openOfferFor(env, id, now);
	if (offer.channel_id !== channelId) throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	// Lost to an accept, decline or cancel at the same moment: nothing stopped, nobody told
	if (!(await closeOffer(env, id, 'stopped', now))) throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	const channel = await loadChannel(env, offer.channel_id).catch(() => ({ id: offer.channel_id }) as Row);
	for (const who of [offer.from_user_id, offer.to_user_id]) {
		await notify(env, who, 'channelMoveStopped', channelParams('channel', channel as never), offer.channel_id, id, `move-offer:${id}:stopped:${who}`);
	}
	return { ...offer, status: 'stopped' };
}

/** Offers per page and side. */
export const MOVE_OFFERS_PAGE = 10;

/**
 * My open offers, newest first: a page of one side after a cursor. The rows of each status come from
 * the side's index in row order, which is the order they were made in, so neither is sorted.
 */
export const MY_OFFERS_SQL = Object.fromEntries(
	(['to_user_id', 'from_user_id'] as const).map((side) => [
		side,
		`SELECT rowid AS seq, * FROM channel_move_offers WHERE ${side} = ?1 AND status = 'offered' AND rowid < ?2
		 UNION ALL SELECT rowid AS seq, * FROM channel_move_offers WHERE ${side} = ?1 AND status = 'accepting' AND rowid < ?2
		 ORDER BY seq DESC LIMIT ?3`,
	]),
) as Record<'to_user_id' | 'from_user_id', string>;

export interface MoveOfferPage {
	offers: MoveOfferRow[];
	/** Pass back for the next page; null: no more */
	cursor: string | null;
}

/** Offered and not expired, or being accepted (an accept that never finished is neither). */
export function isOpenOffer(o: MoveOfferRow, now: number): boolean {
	if (o.status === 'offered') return o.expires_at > iso(now);
	return o.status === 'accepting' && Date.parse(o.updated_at) > now - MOVE_STALE_ACCEPT_MS;
}

/** One page of the open offers made to me (`received`) or by me (`sent`). */
export async function myMoveOffers(env: Env, userId: string, side: 'received' | 'sent', cursor?: string | null, now = Date.now()): Promise<MoveOfferPage> {
	const before = cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER;
	const { results } = await db(env)
		.prepare(MY_OFFERS_SQL[side === 'received' ? 'to_user_id' : 'from_user_id'])
		.bind(userId, before, MOVE_OFFERS_PAGE + 1)
		.all<MoveOfferRow & { seq: number }>();
	const rows = (results ?? []).slice(0, MOVE_OFFERS_PAGE);
	// Every offer is open for the same time, so past one that expired there are only older ones, expired too
	const expired = rows.some((o) => o.status === 'offered' && o.expires_at <= iso(now));
	const more = !expired && (results ?? []).length > MOVE_OFFERS_PAGE;
	return { offers: rows.filter((o) => isOpenOffer(o, now)), cursor: more ? String(rows[rows.length - 1].seq) : null };
}
