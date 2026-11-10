/**
 * Invited creators (docs/admin/INVITES.md): the videos side of an invite.
 *
 * admin-api mints the user id and calls these before Auth has the account
 * (the Auth row comes through the auth-moderation-requests queue), so the
 * invited person is a videos user at once: a profile (searchable in admin,
 * a valid new owner for a channel transfer), a creator tier and channels.
 * Everything is written exactly as for a normal user: the profile and channel
 * objects in R2, and the ownership index through the R2 sync (withSearchSync).
 * At first sign-in the same id is in the token, so it is all already theirs.
 */
import R2Repository from '../r2Repo';
import Queue, { MessageType } from '../queue';
import { logger } from '../logger';
import { claimDefaultHandle, claimHandle, validateHandleFormat } from '../channelHandles';
import { createEntityDefaults } from '../transformations';
import { AdminError, type AdminServiceEnv } from './service';

type Row = Record<string, unknown>;

export const USER_ID_RE = /^usr_[0-9a-f]{32}$/;
const normEmail = (email: string) => email.trim().toLowerCase();

interface AuthUsersRead {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
}

export interface AccountLookup {
	/** The Auth account with this email (any live status, `invited` included). */
	authUser: { id: string; email: string; name: string | null; status: string } | null;
	/** The videos profile with this email (when it differs from authUser's, the admin decides). */
	profile: { id: string; displayName: string | null } | null;
}

/** Who already has this email: the Auth account (read-only AUTH_DB) and the videos profile. */
export async function lookupAccount(env: AdminServiceEnv, email: string): Promise<AccountLookup> {
	const wanted = normEmail(email);
	if (!wanted) throw new AdminError(400, 'invalid_request', 'email is required');
	const authDb = env.AUTH_DB as unknown as AuthUsersRead | undefined;
	let authUser: AccountLookup['authUser'] = null;
	if (authDb) {
		const { results } = await authDb
			.prepare('SELECT id, email, name, status FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1')
			.bind(wanted)
			.all<{ id: string; email: string; name: string | null; status: string }>();
		authUser = results?.[0] ?? null;
	}
	let profile: AccountLookup['profile'] = null;
	if (env.SEARCH_DB) {
		const row = await env.SEARCH_DB.prepare(
			`SELECT id, admin_title FROM content_ownership WHERE kind = 'profile' AND is_deleted = 0 AND lower(email) = ? LIMIT 1`,
		)
			.bind(wanted)
			.first<{ id: string; admin_title: string | null }>();
		if (row) profile = { id: row.id, displayName: row.admin_title };
	}
	return { authUser, profile };
}

/**
 * The invited user's videos profile, create-only: an existing profile (a
 * retried invite) is left as it is. Same shape as POST /api/profiles makes;
 * the person's own first profile save later only adds their fields to it.
 */
export async function provisionProfile(env: AdminServiceEnv, input: { userId: string; email: string; displayName?: string | null }): Promise<{ profile: Row; created: boolean }> {
	if (!USER_ID_RE.test(input.userId)) throw new AdminError(400, 'invalid_request', 'userId must be usr_ followed by 32 hex digits');
	const email = normEmail(input.email);
	if (!email.includes('@')) throw new AdminError(400, 'invalid_request', 'email is required');
	const initial = {
		...createEntityDefaults(),
		id: input.userId,
		email,
		...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
		channels: [],
	};
	let created = false;
	const stored = await new R2Repository<Row>(env.profiles).updateObject(
		input.userId,
		(fresh) => {
			if (fresh === (initial as Row)) {
				created = true;
				return true;
			}
			return false;
		},
		{ initial: () => initial as Row },
	);
	if (created) {
		try {
			await new Queue(env.queue as never).send(MessageType.ProfileCreate, { profileId: input.userId, userId: input.userId, timestamp: new Date().toISOString(), source: 'admin' });
		} catch (error) {
			logger.warn('[AdminInvites] Profile queue message not sent', { userId: input.userId, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { profile: (stored ?? initial) as Row, created };
}

/**
 * A new channel owned by `userId` (an admin making it for an invited creator):
 * the same object, default or chosen @handle and queue message as POST
 * /api/channels. The owner's first channel is their main one.
 */
export async function createChannelFor(
	env: AdminServiceEnv,
	userId: string,
	input: { name: string; handle?: string | null; description?: string | null },
): Promise<Row> {
	const name = String(input.name ?? '').trim();
	if (!name || name.length > 100) throw new AdminError(400, 'invalid_request', 'name is required (at most 100 characters)');
	const profile = await new R2Repository<Row>(env.profiles).getObject(userId);
	if (!profile) throw new AdminError(404, 'user_not_found', 'The user has no videos profile');
	if (input.handle) {
		const problem = validateHandleFormat(input.handle);
		if (problem) throw new AdminError(422, `handle_${problem}`, `The handle is not valid (${problem})`);
	}
	const channels = new R2Repository<Row>(env.channels);
	const ownedIds = env.SEARCH_DB
		? ((
				await env.SEARCH_DB.prepare(`SELECT id FROM content_ownership WHERE kind = 'channel' AND owner_id = ? AND is_deleted = 0`)
					.bind(userId)
					.all<{ id: string }>()
			).results ?? []).map((r) => r.id)
		: [];
	const owned = await Promise.all(ownedIds.map((id) => channels.getObject(id)));
	const wanted = name.toLocaleLowerCase();
	if (owned.some((ch) => ch && !ch.isDeleted && String(ch.name ?? '').trim().toLocaleLowerCase() === wanted)) {
		throw new AdminError(409, 'duplicate_channel_name', 'This user already has a channel with this name');
	}
	const channel: Row = {
		...createEntityDefaults(),
		userId,
		email: profile.email,
		name,
		...(input.description?.trim() ? { description: input.description.trim() } : {}),
		isMain: owned.every((ch) => !ch || ch.isDeleted),
		playlists: [],
		videos: [],
		subscribers: [],
		subscriptions: [],
		likes: [],
	};
	let handle: string | null = null;
	if (input.handle) {
		const claim = await claimHandle(env.channel_tabs!, input.handle, channel as { id: string; userId: string });
		if (claim.ok === false) throw new AdminError(409, `handle_${claim.reason}`, 'This handle is taken');
		handle = claim.handle;
	} else {
		try {
			handle = await claimDefaultHandle(env.channel_tabs!, channel as { id: string; userId: string; name: string });
		} catch (error) {
			logger.warn('[AdminInvites] Default handle not assigned', { channelId: channel.id, error: error instanceof Error ? error.message : String(error) });
		}
	}
	const stored = { ...channel, ...(handle ? { handle } : {}) };
	await channels.putObject(channel.id as string, stored);
	try {
		await new Queue(env.queue as never).send(MessageType.ChannelCreate, { channelId: channel.id, userId, timestamp: new Date().toISOString(), source: 'admin' });
	} catch (error) {
		logger.warn('[AdminInvites] Channel queue message not sent', { channelId: channel.id, error: error instanceof Error ? error.message : String(error) });
	}
	logger.info('[AdminInvites] Channel created for user', { channelId: channel.id, userId });
	return stored;
}
