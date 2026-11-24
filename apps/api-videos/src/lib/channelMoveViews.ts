/**
 * Move offers as the offer page and channel settings show them (wiki AUN-CHANNEL-CLAIM §5, CC-7):
 * the channel and both people by name. Only the two people of an offer and the channel's owner may
 * read it; to anyone else it does not exist.
 */
import { localizedDisplayNames, resolveDisplayName, type NameFields } from '@al-ummah/shared-types';
import { logger } from './logger';
import { MOVE_COOLDOWN_DAYS, MOVE_STALE_ACCEPT_MS, type MoveOfferRow } from './channelMoves';
import R2Repository from './r2Repo';

type Env = { SEARCH_DB?: unknown; profiles?: R2Bucket; channels?: R2Bucket };
type Row = Record<string, any>;

export interface MovePerson {
	userId: string | null;
	/** Null when the account has no name, or is gone */
	name: string | null;
	nameLocalized?: Record<string, string>;
	avatarUrl: string | null;
}

export interface MoveOfferView {
	id: string;
	/** 'expired' as soon as it is, stored or not; 'accepting' while the move is starting */
	status: string;
	createdAt: string;
	expiresAt: string;
	respondedAt: string | null;
	keepContactEmail: boolean;
	channel: { id: string; name: string | null; nameLocalized?: Record<string, string>; handle: string | null; avatarUrl: string | null };
	from: MovePerson;
	to: MovePerson;
	/** What the reader is in this offer: who offered the channel, who it was offered to, or the channel's owner now */
	viewerRole: 'from' | 'to' | 'owner';
}

const iso = (ms: number) => new Date(ms).toISOString();
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Records of `bucket` by id, each read once; an unreadable one shows without its name. */
async function records(bucket: R2Bucket | undefined, ids: string[]): Promise<Map<string, Row>> {
	const out = new Map<string, Row>();
	if (!bucket) return out;
	const repository = new R2Repository<Row>(bucket);
	await Promise.all(
		[...new Set(ids)].map(async (id) => {
			try {
				const record = await repository.getObject(id);
				if (record) out.set(id, record);
			} catch (error) {
				logger.warn('[ChannelMoves] Record unreadable for an offer', { id, error: error instanceof Error ? error.message : String(error) });
			}
		}),
	);
	return out;
}

function person(id: string, profiles: Map<string, Row>): MovePerson {
	const profile = profiles.get(id);
	// Erased or deleted: the offer stays, the person doesn't
	if (!profile || profile.isDeleted) return { userId: profile ? id : null, name: null, avatarUrl: null };
	const localized = localizedDisplayNames(profile as NameFields);
	return { userId: id, name: resolveDisplayName(profile as NameFields) || null, ...(Object.keys(localized).length ? { nameLocalized: localized } : {}), avatarUrl: text(profile.avatarUrl) };
}

function statusOf(o: MoveOfferRow, now: number): string {
	if (o.status === 'offered' && o.expires_at <= iso(now)) return 'expired';
	return o.status;
}

function keepsContactEmail(o: MoveOfferRow): boolean {
	try {
		return (JSON.parse(o.options_json || '{}') as { keepContactEmail?: unknown }).keepContactEmail === true;
	} catch {
		return false;
	}
}

/** The offers `viewerId` may read, as views, in the given order. At most one read per channel and person. */
export async function offerViews(env: Env, offers: MoveOfferRow[], viewerId: string, now = Date.now()): Promise<MoveOfferView[]> {
	const [channels, profiles] = await Promise.all([
		records(env.channels, offers.map((o) => o.channel_id)),
		records(env.profiles, offers.flatMap((o) => [o.from_user_id, o.to_user_id])),
	]);
	const out: MoveOfferView[] = [];
	for (const o of offers) {
		const channel = channels.get(o.channel_id);
		const role = o.to_user_id === viewerId ? 'to' : o.from_user_id === viewerId ? 'from' : channel && !channel.isDeleted && channel.userId === viewerId ? 'owner' : null;
		if (!role) continue;
		out.push({
			id: o.id,
			status: statusOf(o, now),
			createdAt: o.created_at,
			expiresAt: o.expires_at,
			respondedAt: o.responded_at,
			keepContactEmail: keepsContactEmail(o),
			channel: {
				id: o.channel_id,
				name: channel && !channel.isDeleted ? text(channel.name) : null,
				...(channel && !channel.isDeleted && channel.nameLocalized ? { nameLocalized: channel.nameLocalized as Record<string, string> } : {}),
				handle: channel && !channel.isDeleted ? text(channel.handle) : null,
				avatarUrl: channel && !channel.isDeleted ? text(channel.avatarUrl) : null,
			},
			from: person(o.from_user_id, profiles),
			to: person(o.to_user_id, profiles),
			viewerRole: role,
		});
	}
	return out;
}

/** One offer, or null when it doesn't exist or isn't the reader's to see. */
export async function readOfferView(env: Env, id: string, viewerId: string, now = Date.now()): Promise<MoveOfferView | null> {
	const db = env.SEARCH_DB as D1Database | undefined;
	const offer = await db?.prepare('SELECT * FROM channel_move_offers WHERE id = ?').bind(id).first<MoveOfferRow>();
	if (!offer) return null;
	return (await offerViews(env, [offer], viewerId, now))[0] ?? null;
}

/** The query behind a channel's open offer (idx_channel_move_offers_open: at most one row). */
export const OPEN_OFFER_SQL = `SELECT * FROM channel_move_offers WHERE channel_id = ? AND status IN ('offered', 'accepting') LIMIT 1`;
/** The channel's last completed move (idx_channel_move_offers_channel). */
export const LAST_MOVE_SQL = `SELECT responded_at FROM channel_move_offers WHERE channel_id = ? AND status = 'moved' ORDER BY responded_at DESC LIMIT 1`;

/**
 * What channel settings show the owner: the open offer, if any, and from when the owner may move the
 * channel again (null: now). Null when the channel isn't `ownerId`'s.
 */
export async function channelMoveState(env: Env, channelId: string, ownerId: string, now = Date.now()): Promise<{ offer: MoveOfferView | null; movableAt: string | null } | null> {
	const channel = env.channels ? await new R2Repository<Row>(env.channels).getObject(channelId) : null;
	if (!channel || channel.isDeleted || channel.userId !== ownerId) return null;
	const db = env.SEARCH_DB as D1Database | undefined;
	if (!db) return { offer: null, movableAt: null };
	const [open, last] = await Promise.all([
		db.prepare(OPEN_OFFER_SQL).bind(channelId).first<MoveOfferRow>(),
		db.prepare(LAST_MOVE_SQL).bind(channelId).first<{ responded_at: string | null }>(),
	]);
	// Expired, or an accept that never finished: no longer open (the next offer settles the row)
	const live = open && (open.status === 'offered' ? open.expires_at > iso(now) : Date.parse(open.updated_at) > now - MOVE_STALE_ACCEPT_MS);
	const until = last?.responded_at ? Date.parse(last.responded_at) + MOVE_COOLDOWN_DAYS * 86_400_000 : 0;
	return { offer: live ? ((await offerViews(env, [open], ownerId, now))[0] ?? null) : null, movableAt: until > now ? iso(until) : null };
}
