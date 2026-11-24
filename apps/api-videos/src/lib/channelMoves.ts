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
import { channelRoleOf } from '@al-ummah/shared-types';
import { OFFICIAL_HANDLES } from './channelHandles';
import R2Repository from './r2Repo';
import { logger } from './logger';
import { channelParams } from './channelName';
import { enqueueNotification } from './notifications';
import { readBan } from './admin/bans';
import { AdminError, channelHasSupport, channelIsLive, hasChannelRoom, openTransferJob, transferChannel, type AdminServiceEnv } from './admin/service';

/** An offer stays open this long. */
export const MOVE_OFFER_DAYS = 7;
/** The owner must have signed in this recently to make an offer. */
export const MOVE_REAUTH_SECONDS = 10 * 60;
/** A channel can be moved by its owner at most once in this many days. */
export const MOVE_COOLDOWN_DAYS = 30;

export type MoveOfferStatus = 'offered' | 'moved' | 'declined' | 'cancelled' | 'expired' | 'stopped' | 'refused';

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
type Env = AdminServiceEnv & { SEARCH_DB?: D1Database; profiles: R2Bucket; channels: R2Bucket };

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

function nameOf(profile: Row | null, fallback: string): string {
	const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
	return pick(profile?.displayName) || [pick(profile?.firstName), pick(profile?.lastName)].filter(Boolean).join(' ') || pick(profile?.userName) || fallback;
}

/**
 * The channel's admins (channel roles), for the owner's receiver autocomplete, matched on name or
 * @username. The receiver is always picked by user id from this list, never matched by an email.
 */
export async function moveReceivers(env: Env, channelId: string, ownerId: string, q: string): Promise<Array<{ userId: string; name: string; userName: string | null; avatarUrl: string | null }>> {
	const channel = await loadChannel(env, channelId);
	if (channel.userId !== ownerId) throw new MoveError(403, 'not_owner', 'Only the channel owner can move it');
	const admins = (Array.isArray(channel.members) ? channel.members : []).filter((m: Row) => m?.role === 'admin' && typeof m.userId === 'string');
	const needle = q.trim().replace(/^@/, '').toLowerCase();
	const out = [];
	for (const member of admins) {
		const profile = await profileOf(env, member.userId);
		if (!profile || profile.isDeleted) continue;
		const name = nameOf(profile, member.userId);
		const userName = typeof profile.userName === 'string' ? profile.userName : null;
		if (needle && ![name.toLowerCase(), (userName ?? '').toLowerCase()].some((v) => v.includes(needle))) continue;
		out.push({ userId: member.userId, name, userName, avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : null });
	}
	return out;
}

async function notify(env: Env, recipient: string, key: string, params: Record<string, string>, channelId: string, dedupeKey: string): Promise<void> {
	try {
		await enqueueNotification(env as never, { notificationId: crypto.randomUUID(), recipientUserId: recipient, notificationKey: key as never, params, actionUrl: `/channel-moves`, entityId: channelId, dedupeKey, createdAt: Date.now() });
	} catch (error) {
		logger.warn('[ChannelMoves] Notice failed', { channelId, key, error: error instanceof Error ? error.message : String(error) });
	}
}

/** Everything that must hold for the channel to go from its owner to `toUserId` (offer and accept both check it). */
async function checkMovable(env: Env, channel: Row, toUserId: string): Promise<void> {
	if (channelRoleOf(channel as never, toUserId) !== 'admin') throw new MoveError(409, 'receiver_not_channel_admin', 'The channel can only go to one of its admins');
	const handle = typeof channel.handle === 'string' ? channel.handle.toLowerCase() : '';
	if (handle && OFFICIAL_HANDLES.has(handle)) throw new MoveError(409, 'official_handle', 'A channel with an official handle is moved by the team');
	if (await openTransferJob(env, channel.id)) throw new MoveError(409, 'transfer_in_progress');
	if (await channelIsLive(env, channel.id)) throw new MoveError(409, 'channel_is_live');
	if (await channelHasSupport(env, channel.id)) throw new MoveError(409, 'channel_has_support', 'A channel that accepts payments needs the team’s approval to move');
	if (await readBan(db(env) as never, toUserId)) throw new MoveError(409, 'new_owner_banned');
	if (!(await hasChannelRoom(db(env), toUserId))) throw new MoveError(409, 'new_owner_channel_limit');
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
	if (input.typed.trim().replace(/^@/, '').toLowerCase() !== want) throw new MoveError(400, 'confirm_mismatch', 'Type the channel’s @handle to confirm');
	await checkMovable(env, channel, input.toUserId);
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
	await notify(env, input.toUserId, 'channelMoveOffered', { ...channelParams('channel', channel as never), owner: nameOf(owner, input.ownerId) }, channel.id, `move-offer:${offer.id}`);
	logger.info('[ChannelMoves] Offer made', { channelId: channel.id, offerId: offer.id });
	return offer;
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

/** The admin accepts: the move runs at once (CC-D3) through the admin move job; the old owner keeps no access (CC-D4). */
export async function acceptMoveOffer(env: Env, id: string, userId: string, now = Date.now()): Promise<{ offer: MoveOfferRow; jobId: string }> {
	const offer = await openOfferFor(env, id, now);
	if (offer.to_user_id !== userId) throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	const channel = await loadChannel(env, offer.channel_id);
	if (channel.userId !== offer.from_user_id) {
		await closeOffer(env, id, 'refused', now);
		throw new MoveError(409, 'owner_changed', 'The channel’s owner changed since the offer');
	}
	await checkMovable(env, channel, userId);
	const options = JSON.parse(offer.options_json || '{}') as { keepContactEmail?: boolean };
	let jobId: string;
	try {
		// The owner is the actor: the new owner gets "You are now the owner", the owner hears "accepted" below
		const { job } = await transferChannel(env, offer.channel_id, userId, offer.from_user_id, { keepPreviousOwnerAsAdmin: false, keepContactEmail: options.keepContactEmail === true });
		jobId = job.id;
	} catch (error) {
		if (error instanceof AdminError) throw new MoveError(error.status === 422 ? 409 : (error.status as 400 | 403 | 404 | 409), error.code);
		throw error;
	}
	await closeOffer(env, id, 'moved', now, jobId);
	const receiver = await profileOf(env, userId);
	await notify(env, offer.from_user_id, 'channelMoveAccepted', { ...channelParams('channel', channel as never), member: nameOf(receiver, userId) }, channel.id, `move-offer:${id}:accepted`);
	logger.info('[ChannelMoves] Offer accepted; move queued', { channelId: channel.id, offerId: id, jobId });
	return { offer: { ...offer, status: 'moved', job_id: jobId }, jobId };
}

export async function declineMoveOffer(env: Env, id: string, userId: string, now = Date.now()): Promise<void> {
	const offer = await openOfferFor(env, id, now);
	if (offer.to_user_id !== userId) throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	if (!(await closeOffer(env, id, 'declined', now))) return;
	const channel = await loadChannel(env, offer.channel_id).catch(() => ({ id: offer.channel_id }) as Row);
	const receiver = await profileOf(env, userId);
	await notify(env, offer.from_user_id, 'channelMoveDeclined', { ...channelParams('channel', channel as never), member: nameOf(receiver, userId) }, offer.channel_id, `move-offer:${id}:declined`);
}

/** The owner withdraws the offer. */
export async function cancelMoveOffer(env: Env, id: string, userId: string, now = Date.now()): Promise<void> {
	const offer = await readOffer(env, id);
	if (!offer || offer.from_user_id !== userId || offer.status !== 'offered') throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	if (!(await closeOffer(env, id, 'cancelled', now))) return;
	const channel = await loadChannel(env, offer.channel_id).catch(() => ({ id: offer.channel_id }) as Row);
	await notify(env, offer.to_user_id, 'channelMoveCancelled', channelParams('channel', channel as never), offer.channel_id, `move-offer:${id}:cancelled`);
}

/** An admin stops an open offer (CC-D1: "an admin can stop a move"); both sides are told. */
export async function stopMoveOffer(env: Env, id: string, now = Date.now()): Promise<MoveOfferRow> {
	const offer = await readOffer(env, id);
	if (!offer || offer.status !== 'offered') throw new MoveError(404, 'offer_not_found', 'This offer is no longer open');
	await closeOffer(env, id, 'stopped', now);
	const channel = await loadChannel(env, offer.channel_id).catch(() => ({ id: offer.channel_id }) as Row);
	for (const who of [offer.from_user_id, offer.to_user_id]) {
		await notify(env, who, 'channelMoveStopped', channelParams('channel', channel as never), offer.channel_id, `move-offer:${id}:stopped:${who}`);
	}
	return { ...offer, status: 'stopped' };
}

/** Open offers made to me and by me (indexed by user and status). */
export async function myMoveOffers(env: Env, userId: string, now = Date.now()): Promise<{ received: MoveOfferRow[]; sent: MoveOfferRow[] }> {
	const at = iso(now);
	const [received, sent] = await Promise.all([
		db(env).prepare(`SELECT * FROM channel_move_offers WHERE to_user_id = ? AND status = 'offered' AND expires_at > ? ORDER BY created_at DESC LIMIT 20`).bind(userId, at).all<MoveOfferRow>(),
		db(env).prepare(`SELECT * FROM channel_move_offers WHERE from_user_id = ? AND status = 'offered' AND expires_at > ? ORDER BY created_at DESC LIMIT 20`).bind(userId, at).all<MoveOfferRow>(),
	]);
	return { received: received.results ?? [], sent: sent.results ?? [] };
}
