/**
 * Channel team: invitations, the activity log, team limits and live key
 * rotation (docs/specs/CHANNEL-ROLES.md §4, §9, §11).
 *
 * Members themselves live on the R2 channel record (`members`); this module
 * keeps the invitations and the activity log in SEARCH_DB
 * (migrations/search/0055_channel_invites_audit.sql). Nothing here reads
 * token roles or writes to auth: channel roles are not site roles.
 */

import {
	CHANNEL_INVITE_DAYS,
	CHANNEL_INVITE_RATE,
	CHANNEL_AUDIT_RETENTION_DAYS,
	MAX_CHANNEL_MEMBERS,
	type ChannelAuditAction,
	type ChannelInviteStatus,
	type ChannelMemberRole,
	type NotificationCreatePayload,
	reportServerError,
} from '@al-ummah/shared-types';
import { FREE_DEFAULTS } from './entitlements';
import { logger } from './logger';
import { enqueueNotification, type NotificationsEnv } from './notifications';
import { endSession } from './live/service';
import type { LiveEnv } from './live/providers';
import type { LiveSessionRow } from './live/store';

export interface InviteRow {
	id: string;
	channel_id: string;
	role: ChannelMemberRole;
	invitee_user_id: string | null;
	invitee_email: string | null;
	/** 1 for an email invitation: its account is never shown to the inviter (audit, Team page, export). */
	by_email: number;
	invited_by: string;
	status: ChannelInviteStatus;
	created_at: string;
	expires_at: string;
	responded_at: string | null;
}

export interface AuditRow {
	id: string;
	channel_id: string;
	actor_id: string;
	action: ChannelAuditAction;
	target_user_id: string | null;
	old_role: string | null;
	new_role: string | null;
	created_at: string;
}

export interface TeamAuditEntry {
	channelId: string;
	actorId: string;
	action: ChannelAuditAction;
	targetUserId?: string | null;
	oldRole?: ChannelMemberRole | null;
	newRole?: ChannelMemberRole | null;
}

type Ctx = { waitUntil(p: Promise<unknown>): void } | undefined;

const DAY_MS = 86_400_000;

/**
 * Members one channel can hold: `studio.teamSeats` on the channel owner's
 * plan, capped at MAX_CHANNEL_MEMBERS. Plans are not built yet (Epic 27), so
 * every owner gets the Free value.
 */
export function teamSeatLimit(_ownerId: string): number {
	const free = Number(FREE_DEFAULTS['studio.teamSeats']);
	return Math.min(Number.isFinite(free) && free > 0 ? free : MAX_CHANNEL_MEMBERS, MAX_CHANNEL_MEMBERS);
}

export function inviteExpiry(now: Date): string {
	return new Date(now.getTime() + CHANNEL_INVITE_DAYS * DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/** A channel's open invitations (pending and not expired), oldest first. */
export async function pendingChannelInvites(db: D1Database, channelId: string, now = new Date()): Promise<InviteRow[]> {
	const { results } = await db
		.prepare(`SELECT * FROM channel_invites WHERE channel_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at, id`)
		.bind(channelId, now.toISOString())
		.all<InviteRow>();
	return results ?? [];
}

export async function readInvite(db: D1Database, id: string): Promise<InviteRow | null> {
	return db.prepare('SELECT * FROM channel_invites WHERE id = ?').bind(id).first<InviteRow>();
}

/** Invitations sent in the last hour by `inviterId`, and in the last day on `channelId`. */
export async function inviteRateUse(db: D1Database, inviterId: string, channelId: string, now = new Date()): Promise<{ inviterHour: number; channelDay: number }> {
	const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
	const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
	const [byInviter, byChannel] = await db.batch<{ n: number }>([
		db.prepare('SELECT COUNT(*) AS n FROM channel_invites WHERE invited_by = ? AND created_at > ?').bind(inviterId, hourAgo),
		db.prepare('SELECT COUNT(*) AS n FROM channel_invites WHERE channel_id = ? AND created_at > ?').bind(channelId, dayAgo),
	]);
	return { inviterHour: Number(byInviter.results?.[0]?.n ?? 0), channelDay: Number(byChannel.results?.[0]?.n ?? 0) };
}

export function overInviteRate(use: { inviterHour: number; channelDay: number }): boolean {
	return use.inviterHour >= CHANNEL_INVITE_RATE.perInviterHour || use.channelDay >= CHANNEL_INVITE_RATE.perChannelDay;
}

export class AlreadyInvited extends Error {}

/**
 * Store a new invitation. An existing pending invitation for the same person
 * (the unique indexes) raises AlreadyInvited; an expired one that the cron
 * hasn't closed yet is expired first, so it never blocks a new one.
 */
export async function insertInvite(
	db: D1Database,
	invite: { channelId: string; role: ChannelMemberRole; inviteeUserId: string | null; inviteeEmail: string | null; invitedBy: string },
	now = new Date(),
): Promise<InviteRow> {
	const nowIso = now.toISOString();
	await db
		.prepare(
			`UPDATE channel_invites SET status = 'expired', invitee_email = NULL, responded_at = ?
			 WHERE channel_id = ? AND status = 'pending' AND expires_at <= ? AND (invitee_user_id = ? OR invitee_email = ?)`,
		)
		.bind(nowIso, invite.channelId, nowIso, invite.inviteeUserId, invite.inviteeEmail)
		.run();
	const row: InviteRow = {
		id: crypto.randomUUID(),
		channel_id: invite.channelId,
		role: invite.role,
		invitee_user_id: invite.inviteeUserId,
		invitee_email: invite.inviteeEmail,
		by_email: invite.inviteeEmail ? 1 : 0,
		invited_by: invite.invitedBy,
		status: 'pending',
		created_at: nowIso,
		expires_at: inviteExpiry(now),
		responded_at: null,
	};
	try {
		await db
			.prepare(
				`INSERT INTO channel_invites (id, channel_id, role, invitee_user_id, invitee_email, by_email, invited_by, status, created_at, expires_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
			)
			.bind(row.id, row.channel_id, row.role, row.invitee_user_id, row.invitee_email, row.by_email, row.invited_by, row.created_at, row.expires_at)
			.run();
	} catch (error) {
		if (/UNIQUE/i.test(error instanceof Error ? error.message : String(error))) throw new AlreadyInvited();
		throw error;
	}
	return row;
}

/**
 * Close a pending invitation (guarded on status, so a double click or a
 * race closes it once). Clears the stored email. Returns whether this call
 * closed it.
 */
export async function closeInvite(db: D1Database, id: string, status: Exclude<ChannelInviteStatus, 'pending' | 'claimed'>, now = new Date()): Promise<boolean> {
	// A cancel also closes an accept in flight (claimed): settleClaim then
	// finds it closed and the accept undoes its grant, so the revocation wins
	const open = status === 'cancelled' ? `status IN ('pending', 'claimed')` : `status = 'pending'`;
	const result = await db
		.prepare(`UPDATE channel_invites SET status = ?, invitee_email = NULL, responded_at = ? WHERE id = ? AND ${open}`)
		.bind(status, now.toISOString(), id)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

/** A claim older than this was left by an accept that never finished (resolveStaleClaims). */
export const STALE_CLAIM_MS = 10 * 60_000;

/**
 * Accept step 1: claim a pending, unexpired invitation for `userId` in one
 * guarded update (status `claimed`), before the role is written. Cancels and
 * account erasure close claimed rows too, so a revocation during the accept
 * always wins: settleClaim only settles a row still claimed. The email stays
 * until settleClaim, so a refused grant can reopen it as it was.
 */
export async function claimInvite(db: D1Database, id: string, userId: string, now = new Date()): Promise<boolean> {
	const nowIso = now.toISOString();
	const result = await db
		.prepare(`UPDATE channel_invites SET status = 'claimed', invitee_user_id = COALESCE(invitee_user_id, ?), responded_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`)
		.bind(userId, nowIso, id, nowIso)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

/**
 * Accept step 2: keep the claim (email cleared), turn it into a cancellation
 * (the channel or the inviter's right is gone, or they were already on the
 * team), or reopen it (a full team: they may accept once a seat frees up).
 * Only a row still claimed changes. Returns false when a cancel or erasure
 * closed it meanwhile: the accept must then undo any grant it made.
 */
export async function settleClaim(db: D1Database, id: string, outcome: 'accepted' | 'cancelled' | 'reopen', now = new Date()): Promise<boolean> {
	if (outcome === 'reopen') {
		try {
			const result = await db.prepare(`UPDATE channel_invites SET status = 'pending', responded_at = NULL WHERE id = ? AND status = 'claimed'`).bind(id).run();
			return (result.meta?.changes ?? 0) > 0;
		} catch (error) {
			// Another pending invitation for the same person took its place meanwhile
			if (!/UNIQUE/i.test(error instanceof Error ? error.message : String(error))) throw error;
			outcome = 'cancelled';
		}
	}
	const result = await db
		.prepare(`UPDATE channel_invites SET status = ?, invitee_email = NULL, responded_at = ? WHERE id = ? AND status = 'claimed'`)
		.bind(outcome, now.toISOString(), id)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

/**
 * Daily: settle claims an accept left behind (the Worker stopped between the
 * claim and the settle). Accepted when the person holds a role on the channel,
 * otherwise reopened (or expired, past its 14 days), and the email is cleared
 * on every closed row. `roleOf` reads the live channel record.
 */
export async function resolveStaleClaims(
	db: D1Database,
	roleOf: (channelId: string, userId: string) => Promise<string | null>,
	now = new Date(),
	limit = 200,
): Promise<number> {
	const cutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
	const { results } = await db
		.prepare(`SELECT * FROM channel_invites WHERE status = 'claimed' AND responded_at < ? ORDER BY responded_at LIMIT ?`)
		.bind(cutoff, limit)
		.all<InviteRow>();
	const rows = results ?? [];
	for (const row of rows) {
		const holds = row.invitee_user_id ? await roleOf(row.channel_id, row.invitee_user_id) : null;
		if (holds) await settleClaim(db, row.id, 'accepted', now);
		else if (row.expires_at <= now.toISOString()) {
			await db
				.prepare(`UPDATE channel_invites SET status = 'expired', invitee_email = NULL, responded_at = ? WHERE id = ? AND status = 'claimed'`)
				.bind(now.toISOString(), row.id)
				.run();
		} else await settleClaim(db, row.id, 'reopen', now);
	}
	return rows.length;
}

/**
 * The account an activity row may name for this invitation: none for an email
 * invitation, even once tied to an account, so the log never tells the inviter
 * who owns the address (§4.1).
 */
export function inviteAuditTarget(row: Pick<InviteRow, 'by_email' | 'invitee_user_id'>): string | null {
	return row.by_email ? null : row.invitee_user_id;
}

/** Actor of an email invitee's decline in the log: shown as "someone", never the account. */
export const EMAIL_INVITEE_ACTOR = 'email-invitee';

/**
 * Whether `userId` was removed from the channel after `since`: an invitation
 * from before a removal can't bring them back (the removal outranks it).
 */
export async function removedSince(db: D1Database, channelId: string, userId: string, since: string): Promise<boolean> {
	const row = await db
		.prepare(`SELECT 1 FROM channel_audit WHERE channel_id = ? AND target_user_id = ? AND action = 'member_removed' AND created_at > ? LIMIT 1`)
		.bind(channelId, userId, since)
		.first();
	return Boolean(row);
}

/** Cancel the open invitations (pending, or claimed by an accept in flight) matching `where`. Returns the closed rows. */

async function cancelWhere(db: D1Database, where: string, binds: unknown[], now = new Date()): Promise<InviteRow[]> {
	const { results } = await db.prepare(`SELECT * FROM channel_invites WHERE status IN ('pending', 'claimed') AND ${where}`).bind(...binds).all<InviteRow>();
	const rows = results ?? [];
	if (!rows.length) return [];
	await db
		.prepare(`UPDATE channel_invites SET status = 'cancelled', invitee_email = NULL, responded_at = ? WHERE status IN ('pending', 'claimed') AND ${where}`)
		.bind(now.toISOString(), ...binds)
		.run();
	return rows;
}

export const cancelChannelInvites = (db: D1Database, channelId: string, now?: Date) => cancelWhere(db, 'channel_id = ?', [channelId], now);
export const cancelInvitesSentBy = (db: D1Database, channelId: string, inviterId: string, now?: Date) =>
	cancelWhere(db, 'channel_id = ? AND invited_by = ?', [channelId, inviterId], now);
export const cancelInvitesTo = (db: D1Database, channelId: string, userId: string, now?: Date) =>
	cancelWhere(db, 'channel_id = ? AND invitee_user_id = ?', [channelId, userId], now);
/** Account erasure: every invitation to or from the user, on any channel. */
export const cancelInvitesOfUser = (db: D1Database, userId: string, now?: Date) =>
	cancelWhere(db, '(invitee_user_id = ? OR invited_by = ?)', [userId, userId], now);

/**
 * The caller's open invitations: by account, and by the email in their own
 * token (§4.1). An email invitation seen for the first time is tied to the
 * account (invitee_user_id), so it keeps reaching them if the email changes.
 * One per channel is listed (an @handle invitation first). Nothing visible to
 * the inviter changes when an email invitation is tied or set aside: that
 * would tell them who owns the address.
 */
export async function invitesFor(db: D1Database, userId: string, email: string | null, now = new Date()): Promise<InviteRow[]> {
	const nowIso = now.toISOString();
	if (email) {
		const { results: byEmail } = await db
			.prepare(`SELECT * FROM channel_invites WHERE invitee_email = ? AND invitee_user_id IS NULL AND status = 'pending' AND expires_at > ?`)
			.bind(email, nowIso)
			.all<InviteRow>();
		for (const row of byEmail ?? []) {
			try {
				await db.prepare(`UPDATE channel_invites SET invitee_user_id = ? WHERE id = ? AND invitee_user_id IS NULL AND status = 'pending'`).bind(userId, row.id).run();
			} catch (error) {
				if (!/UNIQUE/i.test(error instanceof Error ? error.message : String(error))) throw error;
				await closeInvite(db, row.id, 'cancelled', now);
			}
		}
	}
	const { results } = await db
		.prepare(`SELECT * FROM channel_invites WHERE invitee_user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY by_email, created_at DESC, id`)
		.bind(userId, nowIso)
		.all<InviteRow>();
	const seen = new Set<string>();
	return (results ?? [])
		.filter((row) => !seen.has(row.channel_id) && Boolean(seen.add(row.channel_id)))
		.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id.localeCompare(b.id)));
}

/**
 * Daily: close invitations past their 14 days (clearing the email) and log
 * `invite_expired` on each channel. Returns how many closed.
 */
export async function expireInvites(db: D1Database, now = new Date(), limit = 500): Promise<number> {
	const nowIso = now.toISOString();
	const { results } = await db
		.prepare(`SELECT * FROM channel_invites WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at LIMIT ?`)
		.bind(nowIso, limit)
		.all<InviteRow>();
	const rows = results ?? [];
	if (!rows.length) return 0;
	await db.batch(
		rows.flatMap((row) => [
			db.prepare(`UPDATE channel_invites SET status = 'expired', invitee_email = NULL, responded_at = ? WHERE id = ? AND status = 'pending'`).bind(nowIso, row.id),
			auditStatement(db, { channelId: row.channel_id, actorId: row.invited_by, action: 'invite_expired', targetUserId: inviteAuditTarget(row), newRole: row.role }, now),
		]),
	);
	return rows.length;
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

let auditSeq = 0;

/**
 * Activity ids sort in write order: time, then a per-isolate counter, then
 * random. Rows written in the same millisecond still list newest first
 * (listTeamActivity orders by created_at, id).
 */
function auditId(now: Date): string {
	auditSeq = (auditSeq + 1) % 1_679_616;
	return `${now.getTime().toString(36).padStart(9, '0')}${auditSeq.toString(36).padStart(4, '0')}-${crypto.randomUUID()}`;
}

function auditStatement(db: D1Database, entry: TeamAuditEntry, now = new Date()): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO channel_audit (id, channel_id, actor_id, action, target_user_id, old_role, new_role, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(auditId(now), entry.channelId, entry.actorId, entry.action, entry.targetUserId ?? null, entry.oldRole ?? null, entry.newRole ?? null, now.toISOString());
}

/**
 * Write activity rows right after the change they record (§9). R2 and D1
 * can't share a transaction, so a failed write never undoes the change: it is
 * logged and reported to the admin Errors page.
 */
export async function recordTeamActivity(env: { SEARCH_DB?: D1Database }, ctx: Ctx, entries: TeamAuditEntry[], now = new Date()): Promise<void> {
	if (!entries.length) return;
	const db = env.SEARCH_DB;
	try {
		if (!db) throw new Error('SEARCH_DB is not bound');
		await db.batch(entries.map((entry) => auditStatement(db, entry, now)));
	} catch (error) {
		logger.error('[ChannelTeam] Activity log write failed', { channelId: entries[0].channelId, actions: entries.map((e) => e.action), error: error instanceof Error ? error.message : String(error) });
		reportServerError('api-videos', env as never, ctx, error, { route: 'channel-team:audit', extra: { channelId: entries[0].channelId } });
	}
}

/** A channel's activity, newest first, keyset paged by "<createdAt>|<id>". */
export async function listTeamActivity(db: D1Database, channelId: string, opts: { cursor?: string | null; limit?: number } = {}): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
	const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
	const [at, id] = (opts.cursor ?? '').split('|');
	const stmt = at && id
		? db
			.prepare(`SELECT * FROM channel_audit WHERE channel_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`)
			.bind(channelId, at, at, id, limit + 1)
		: db.prepare(`SELECT * FROM channel_audit WHERE channel_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(channelId, limit + 1);
	const { results } = await stmt.all<AuditRow>();
	const rows = results ?? [];
	const more = rows.length > limit;
	const page = more ? rows.slice(0, limit) : rows;
	const last = page[page.length - 1];
	return { rows: page, nextCursor: more && last ? `${last.created_at}|${last.id}` : null };
}

/** Daily: delete activity rows older than a year. */
export async function pruneTeamActivity(db: D1Database, now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - CHANNEL_AUDIT_RETENTION_DAYS * DAY_MS).toISOString();
	// Closed invitations go after the same year (the activity rows recorded them)
	const [audit, invites] = await db.batch([
		db.prepare('DELETE FROM channel_audit WHERE created_at < ?').bind(cutoff),
		db.prepare(`DELETE FROM channel_invites WHERE status NOT IN ('pending', 'claimed') AND created_at < ?`).bind(cutoff),
	]);
	return (audit.meta?.changes ?? 0) + (invites.meta?.changes ?? 0);
}

/**
 * Account erasure: the user's id in activity rows and in closed invitations
 * becomes `deletedId` (cancel their open invitations first).
 */
export async function anonymizeTeamActivity(db: D1Database, userId: string, deletedId: string): Promise<void> {
	await db.batch([
		db.prepare('UPDATE channel_audit SET actor_id = ? WHERE actor_id = ?').bind(deletedId, userId),
		db.prepare('UPDATE channel_audit SET target_user_id = ? WHERE target_user_id = ?').bind(deletedId, userId),
		db.prepare(`UPDATE channel_invites SET invited_by = ? WHERE invited_by = ? AND status NOT IN ('pending', 'claimed')`).bind(deletedId, userId),
		db.prepare(`UPDATE channel_invites SET invitee_user_id = ? WHERE invitee_user_id = ? AND status NOT IN ('pending', 'claimed')`).bind(deletedId, userId),
	]);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Queue a team notification (account category, always delivered). Never to the actor themselves. */
export async function notifyTeam(
	env: NotificationsEnv,
	recipientUserId: string | null | undefined,
	actorUserId: string,
	notification: Pick<NotificationCreatePayload, 'notificationKey' | 'params' | 'actionUrl' | 'entityId' | 'dedupeKey'>,
): Promise<void> {
	if (!recipientUserId || recipientUserId === actorUserId) return;
	await enqueueNotification(env, { notificationId: crypto.randomUUID(), recipientUserId, actorUserId, createdAt: Date.now(), ...notification });
}

// ---------------------------------------------------------------------------
// Live keys
// ---------------------------------------------------------------------------

/**
 * A member who held live.manage was removed, left or lost it: end the
 * channel's live sessions that haven't started, so the next start provisions
 * a fresh session with a new stream key (§4.3). A broadcast on air keeps
 * running; its session ends with it. Returns how many sessions ended.
 */
export async function rotateChannelLiveKeys(env: LiveEnv & { SEARCH_DB?: D1Database }, channelId: string, now = Date.now()): Promise<number> {
	const db = env.SEARCH_DB;
	if (!db) return 0;
	const { results } = await db
		.prepare(`SELECT * FROM live_sessions WHERE channel_id = ? AND status = 'provisioned'`)
		.bind(channelId)
		.all<LiveSessionRow>();
	let ended = 0;
	for (const session of results ?? []) {
		await endSession(env, session, 'key_rotated', now);
		ended++;
	}
	return ended;
}
