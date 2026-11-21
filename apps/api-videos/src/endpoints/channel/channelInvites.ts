/**
 * Channel invitations and the team activity log (docs/specs/CHANNEL-ROLES.md §4, §9, §13).
 *
 * - POST   /api/channels/:id/invites             invite by @handle or email
 * - DELETE /api/channels/:id/invites/:inviteId   cancel a pending invitation
 * - GET    /api/channels/:id/audit               the channel's activity, newest first
 * - GET    /api/channel-invites                  my pending invitations
 * - POST   /api/channel-invites/:id/accept       accept (adds the member entry)
 * - POST   /api/channel-invites/:id/decline      decline
 *
 * Nobody gets a role without accepting an invitation. Invitations and the
 * log live in SEARCH_DB; the membership itself stays on the R2 channel
 * record. Email invitations never look the address up in Auth: they are
 * matched against the invitee's own token email when they load their
 * invitations, and every email gets the same answer.
 */

import { Str } from "../../lib/chanfana-params";
import { z } from "zod";
import {
	CHANNEL_MEMBER_ROLES,
	MAX_PENDING_CHANNEL_INVITES,
	MAX_SHARED_CHANNELS,
	canManageRole,
	can,
	channelMembersOf,
	channelRoleOf,
	normalizeInviteEmail,
	type ChannelAuditEntry,
	type ChannelMemberRole,
	type MyChannelInvite,
} from "@al-ummah/shared-types";
import { ResponseError } from "../../lib/types";
import { AuthenticatedRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import { normalizeHandleInput, resolveHandle } from "../../lib/channelHandles";
import {
	AlreadyInvited,
	claimInvite,
	closeInvite,
	EMAIL_INVITEE_ACTOR,
	insertInvite,
	inviteAuditTarget,
	inviteRateUse,
	invitesFor,
	listTeamActivity,
	notifyTeam,
	overInviteRate,
	pendingChannelInvites,
	readInvite,
	recordTeamActivity,
	memberChangedAfter,
	settleClaim,
	teamSeatLimit,
	type InviteRow,
} from "../../lib/channelTeam";
import { memberChannelRoles } from "../../lib/search/ownership";
import { MembersResponse, NO_STORE, changeMembers, fail, loadLiveChannel, profileSummary, teamState } from "./channelMembers";
import { channelParams } from '../../lib/channelName';

const MemberRoleEnum = z.enum(CHANNEL_MEMBER_ROLES as [ChannelMemberRole, ...ChannelMemberRole[]]);

function executionCtx(c: AppContext): { waitUntil(p: Promise<unknown>): void } | undefined {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
}

function searchDb(c: AppContext): D1Database | null {
	return (c.env.SEARCH_DB as D1Database | undefined) ?? null;
}

/**
 * The caller's email from their token. Auth issues a user subject only after
 * the email code is checked (password provider, the only one configured; no
 * email change; M2M tokens carry no email), so this address is proven.
 */
function tokenEmail(c: AppContext): string | null {
	const auth = c.get('auth') as { email?: string } | undefined;
	return normalizeInviteEmail(auth?.email);
}

const InviteBody = z.object({
	handle: z.string().trim().min(1).max(64).optional(),
	email: z.string().trim().min(3).max(254).optional(),
	role: z.string().min(1).max(32),
}).refine(b => !!b.handle !== !!b.email, { message: 'Give exactly one of handle or email' });

export class ChannelInviteCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Invite someone to a role on a channel",
		description: "By the exact @handle of one of their channels, or by email. Owners invite to any role; channel admins invite editors and moderators. Nobody gets the role until they accept. Every email gets the same answer, so the form cannot reveal who has an account.",
		request: {
			params: z.object({ id: Str({ description: "Channel ID" }) }),
			body: { content: { "application/json": { schema: InviteBody } } },
		},
		responses: {
			"200": { description: "Members and invitations after the invite", content: { "application/json": { schema: MembersResponse } } },
			"400": { description: "invalid_role, or no handle or email", content: { "application/json": { schema: ResponseError } } },
			"403": { description: "forbidden", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel or handle not found", content: { "application/json": { schema: ResponseError } } },
			"409": { description: "cannot_invite_owner, already_member, already_invited, member_limit or pending_limit", content: { "application/json": { schema: ResponseError } } },
			"429": { description: "rate_limited", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const actorId = this.getUserId(c);
		const db = searchDb(c);
		if (!db) return fail(c, 503, 'unavailable', 'Invitations are not available right now');
		if (!(CHANNEL_MEMBER_ROLES as readonly string[]).includes(body.role)) return fail(c, 400, 'invalid_role', 'Choose editor, moderator or channel admin');
		const role = body.role as ChannelMemberRole;

		const channel = await loadLiveChannel(c, params.id);
		if (!channel) return fail(c, 404, 'channel_not_found', 'Channel not found');
		const actorRole = channelRoleOf(channel, actorId);
		if (!canManageRole(actorRole, role)) return fail(c, 403, 'forbidden', 'You cannot invite people to this role');

		let inviteeUserId: string | null = null;
		let inviteeEmail: string | null = null;
		if (body.handle) {
			const handle = normalizeHandleInput(body.handle);
			const handleChannelId = await resolveHandle(c.env.channel_tabs, handle);
			const handleChannel = handleChannelId ? await loadLiveChannel(c, handleChannelId) : null;
			if (!handleChannel || (handleChannel.handle || '').toLowerCase() !== handle.toLowerCase()) {
				return fail(c, 404, 'person_not_found', 'No channel has that handle');
			}
			inviteeUserId = handleChannel.userId;
		} else {
			inviteeEmail = normalizeInviteEmail(body.email);
			if (!inviteeEmail) return fail(c, 400, 'invalid_email', 'Enter a valid email address');
		}

		const members = channelMembersOf(channel);
		if (inviteeUserId === actorId || inviteeUserId === channel.userId || (inviteeEmail && inviteeEmail === tokenEmail(c))) {
			return fail(c, 409, 'cannot_invite_owner', 'The owner already has every permission');
		}
		if (inviteeUserId && members.some(m => m.userId === inviteeUserId)) {
			return fail(c, 409, 'already_member', 'This person already has a role on this channel');
		}
		const pending = await pendingChannelInvites(db, channel.id);
		if (pending.length >= MAX_PENDING_CHANNEL_INVITES) return fail(c, 409, 'pending_limit', 'This channel has too many pending invitations');
		if (members.length + pending.length >= teamSeatLimit(channel.userId)) return fail(c, 409, 'member_limit', 'This channel\'s team is full');
		if (overInviteRate(await inviteRateUse(db, actorId, channel.id))) return fail(c, 429, 'rate_limited', 'Too many invitations. Try again later.');

		let invite: InviteRow;
		try {
			invite = await insertInvite(db, { channelId: channel.id, role, inviteeUserId, inviteeEmail, invitedBy: actorId });
		} catch (error) {
			if (error instanceof AlreadyInvited) return fail(c, 409, 'already_invited', 'This person already has a pending invitation');
			throw error;
		}

		await recordTeamActivity(c.env as never, executionCtx(c), [{ channelId: channel.id, actorId, action: 'invite_sent', targetUserId: inviteeUserId, newRole: role }]);
		if (inviteeUserId) {
			const { displayName } = await profileSummary(c, actorId);
			await notifyTeam(c.env as never, inviteeUserId, actorId, {
				notificationKey: 'channelInviteReceived',
				params: { inviter: displayName ?? '', ...channelParams('channel', channel), role },
				actionUrl: '/settings/channel-invites',
				entityId: channel.id,
				dedupeKey: `channel-invite:${invite.id}`,
			});
		}
		logger.debug('[ChannelInvites] Invitation sent', { channelId: channel.id, actorId, inviteId: invite.id, role, by: inviteeUserId ? 'handle' : 'email' });
		return c.json({ success: true, data: await teamState(c, channel, actorId) }, 200, NO_STORE);
	}
}

export class ChannelInviteCancel extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Cancel a pending channel invitation",
		description: "Needs the capability to invite to the invitation's role.",
		request: { params: z.object({ id: Str({ description: "Channel ID" }), inviteId: Str({ description: "Invitation id" }) }) },
		responses: {
			"200": { description: "Members and invitations after the change", content: { "application/json": { schema: MembersResponse } } },
			"403": { description: "forbidden", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel or invitation not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const actorId = this.getUserId(c);
		const db = searchDb(c);
		if (!db) return fail(c, 503, 'unavailable', 'Invitations are not available right now');
		const channel = await loadLiveChannel(c, params.id);
		if (!channel) return fail(c, 404, 'channel_not_found', 'Channel not found');
		const invite = await readInvite(db, params.inviteId);
		if (!invite || invite.channel_id !== channel.id || (invite.status !== 'pending' && invite.status !== 'claimed')) return fail(c, 404, 'invite_not_found', 'This invitation is no longer open');
		if (!canManageRole(channelRoleOf(channel, actorId), invite.role)) return fail(c, 403, 'forbidden', 'You cannot cancel this invitation');
		if (await closeInvite(db, invite.id, 'cancelled')) {
			await recordTeamActivity(c.env as never, executionCtx(c), [{ channelId: channel.id, actorId, action: 'invite_cancelled', targetUserId: inviteAuditTarget(invite), newRole: invite.role }]);
		}
		return c.json({ success: true, data: await teamState(c, channel, actorId) }, 200, NO_STORE);
	}
}

const AuditEntryView = z.object({
	id: Str(),
	action: Str(),
	actorId: Str(),
	actorName: Str().optional(),
	targetUserId: Str().optional(),
	targetName: Str().optional(),
	oldRole: MemberRoleEnum.optional(),
	newRole: MemberRoleEnum.optional(),
	createdAt: Str(),
});

export class ChannelAuditList extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "A channel's team activity, newest first",
		description: "Needs members.view (owner or channel admin). Rows are kept for one year.",
		request: {
			params: z.object({ id: Str({ description: "Channel ID" }) }),
			query: z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }),
		},
		responses: {
			"200": { description: "Activity", content: { "application/json": { schema: z.object({ success: z.boolean(), data: z.object({ entries: z.array(AuditEntryView), nextCursor: z.string().nullable() }) }) } } },
			"403": { description: "forbidden", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const channel = await loadLiveChannel(c, params.id);
		if (!channel) return fail(c, 404, 'channel_not_found', 'Channel not found');
		if (!can(channelRoleOf(channel, userId), 'members.view')) return fail(c, 403, 'forbidden', 'You cannot view this channel\'s team');
		const db = searchDb(c);
		if (!db) return c.json({ success: true, data: { entries: [], nextCursor: null } }, 200, NO_STORE);
		const { rows, nextCursor } = await listTeamActivity(db, channel.id, { cursor: query.cursor ?? null, limit: query.limit ?? 50 });
		const names = new Map<string, string | undefined>();
		const nameOf = async (id: string | null) => {
			if (!id) return undefined;
			if (!names.has(id)) names.set(id, (await profileSummary(c, id)).displayName);
			return names.get(id);
		};
		const entries: ChannelAuditEntry[] = [];
		for (const row of rows) {
			const actorName = await nameOf(row.actor_id);
			const targetName = await nameOf(row.target_user_id);
			entries.push({
				id: row.id,
				action: row.action,
				actorId: row.actor_id,
				...(actorName ? { actorName } : {}),
				...(row.target_user_id ? { targetUserId: row.target_user_id } : {}),
				...(targetName ? { targetName } : {}),
				...(row.old_role ? { oldRole: row.old_role as ChannelMemberRole } : {}),
				...(row.new_role ? { newRole: row.new_role as ChannelMemberRole } : {}),
				createdAt: row.created_at,
			});
		}
		return c.json({ success: true, data: { entries, nextCursor } }, 200, NO_STORE);
	}
}

const MyInviteView = z.object({
	id: Str(),
	role: MemberRoleEnum,
	channel: z.object({ id: Str(), name: Str(), nameLocalized: z.record(z.string(), z.string()).optional(), handle: Str().optional(), avatarUrl: Str().optional() }),
	invitedBy: z.object({ userId: Str(), displayName: Str().optional() }),
	createdAt: Str(),
	expiresAt: Str(),
});

export class MyChannelInvites extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "My pending channel invitations",
		description: "Invitations to my account, and email invitations to the verified email in my token (tied to my account the first time they are seen).",
		responses: {
			"200": { description: "Invitations", content: { "application/json": { schema: z.object({ success: z.boolean(), data: z.object({ invites: z.array(MyInviteView) }) }) } } },
		},
	};

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		const db = searchDb(c);
		if (!db) return c.json({ success: true, data: { invites: [] } }, 200, NO_STORE);
		const rows = await invitesFor(db, userId, tokenEmail(c));
		const invites: MyChannelInvite[] = [];
		for (const row of rows) {
			const channel = await loadLiveChannel(c, row.channel_id);
			if (!channel) continue;
			const inviter = await profileSummary(c, row.invited_by);
			invites.push({
				id: row.id,
				role: row.role,
				channel: {
					id: channel.id,
					name: channel.name,
					...(channel.nameLocalized ? { nameLocalized: channel.nameLocalized as Record<string, string> } : {}),
					...(channel.handle ? { handle: channel.handle } : {}),
					...(channel.avatarUrl ? { avatarUrl: channel.avatarUrl } : {}),
				},
				invitedBy: { userId: row.invited_by, ...(inviter.displayName ? { displayName: inviter.displayName } : {}) },
				createdAt: row.created_at,
				expiresAt: row.expires_at,
			});
		}
		return c.json({ success: true, data: { invites } }, 200, NO_STORE);
	}
}

/** The invitation if it is open and the caller's (by account, or by token email); null hides all three cases (§4.2). */
async function openInviteFor(c: AppContext, db: D1Database, inviteId: string, userId: string): Promise<InviteRow | null> {
	const invite = await readInvite(db, inviteId);
	if (!invite || invite.status !== 'pending' || invite.expires_at <= new Date().toISOString()) return null;
	if (invite.invitee_user_id) return invite.invitee_user_id === userId ? invite : null;
	const email = tokenEmail(c);
	return email && invite.invitee_email === email ? invite : null;
}

const RespondParams = z.object({ id: Str({ description: "Invitation id" }) });

export class ChannelInviteAccept extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Accept a channel invitation",
		description: "Adds you to the channel's team with the invited role. Expired, closed and other people's invitations all answer 404 invite_not_found.",
		request: { params: RespondParams },
		responses: {
			"200": { description: "Accepted", content: { "application/json": { schema: z.object({ success: z.boolean(), data: z.object({ channelId: Str(), role: MemberRoleEnum }) }) } } },
			"404": { description: "invite_not_found", content: { "application/json": { schema: ResponseError } } },
			"409": { description: "member_limit or shared_limit", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const db = searchDb(c);
		if (!db) return fail(c, 503, 'unavailable', 'Invitations are not available right now');
		const invite = await openInviteFor(c, db, params.id, userId);
		if (!invite) return fail(c, 404, 'invite_not_found', 'This invitation is no longer open');

		const shared = await memberChannelRoles(c.env as never, userId);
		if (shared && shared.length >= MAX_SHARED_CHANNELS && !shared.some(s => s.channelId === invite.channel_id)) {
			return fail(c, 409, 'shared_limit', 'You already help run the most channels allowed');
		}

		// Claim it first: a cancel that races this accept finds it closed (spec §4.2)
		if (!(await claimInvite(db, invite.id, userId))) return fail(c, 404, 'invite_not_found', 'This invitation is no longer open');

		const now = new Date().toISOString();
		let joined = false;
		let outcome: Awaited<ReturnType<typeof changeMembers>>;
		try {
			outcome = await changeMembers(c, invite.channel_id, userId, (fresh, _role, members) => {
				joined = false;
				// The inviter must still be allowed to give this role (a demoted admin's
				// invitations are cancelled, but never trust that step alone)
				if (!canManageRole(channelRoleOf(fresh, invite.invited_by), invite.role)) {
					return { status: 404, code: 'inviter_lost_role', message: 'This invitation is no longer open' };
				}
				// Removed, left or re-roled after this was sent: the later change outranks it
				// (checked on the fresh record, in the same put as the grant)
				if (memberChangedAfter(fresh as never, userId, invite.created_at)) {
					return { status: 404, code: 'invite_superseded', message: 'This invitation is no longer open' };
				}
				if (fresh.userId === userId || members.some(m => m.userId === userId)) return false;
				joined = true;
				if (members.length >= teamSeatLimit(fresh.userId)) return { status: 409, code: 'member_limit', message: 'This channel\'s team is full' };
				return [...members, { userId, role: invite.role, addedBy: invite.invited_by, addedAt: now }];
			});
		} catch (error) {
			// The grant didn't happen: the invitation stays open for a retry
			await settleClaim(db, invite.id, 'reopen');
			throw error;
		}
		const { channel, rejected } = outcome;
		if (rejected) {
			if (rejected.code === 'channel_not_found' || rejected.code === 'inviter_lost_role' || rejected.code === 'invite_superseded') {
				await settleClaim(db, invite.id, 'cancelled');
				return fail(c, 404, 'invite_not_found', 'This invitation is no longer open');
			}
			await settleClaim(db, invite.id, 'reopen');
			return fail(c, rejected.status, rejected.code, rejected.message);
		}

		// Already on the team (an email invitation sent before they joined): closed, nobody told
		if (!joined) {
			await settleClaim(db, invite.id, 'cancelled');
		} else {
			if (!(await settleClaim(db, invite.id, 'accepted'))) {
				// Cancelled (or the account erased) while the role was being written:
				// the revocation wins, so take back exactly the seat this accept added
				await changeMembers(c, invite.channel_id, userId, (_fresh, _role, members) => {
					const kept = members.filter(m => !(m.userId === userId && m.addedAt === now && m.role === invite.role));
					return kept.length === members.length ? false : kept;
				});
				logger.info('[ChannelInvites] Accept overtaken by a cancel; grant undone', { channelId: invite.channel_id, inviteId: invite.id });
				return fail(c, 404, 'invite_not_found', 'This invitation is no longer open');
			}
			await recordTeamActivity(c.env as never, executionCtx(c), [{ channelId: invite.channel_id, actorId: userId, action: 'invite_accepted', targetUserId: userId, newRole: invite.role }]);
			const { displayName } = await profileSummary(c, userId);
			await notifyTeam(c.env as never, invite.invited_by, userId, {
				notificationKey: 'channelInviteAccepted',
				params: { member: displayName ?? '', ...channelParams('channel', channel!), role: invite.role },
				actionUrl: `/settings/channel/${invite.channel_id}/team`,
				entityId: invite.channel_id,
				dedupeKey: `channel-invite-accepted:${invite.id}`,
			});
		}
		const role = channelRoleOf(channel!, userId);
		logger.debug('[ChannelInvites] Invitation accepted', { channelId: invite.channel_id, userId, inviteId: invite.id });
		return c.json({ success: true, data: { channelId: invite.channel_id, role: role && role !== 'owner' ? role : invite.role } }, 200, NO_STORE);
	}
}

export class ChannelInviteDecline extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Decline a channel invitation",
		description: "Closes the invitation. Nobody is notified; the channel's Activity tab shows it.",
		request: { params: RespondParams },
		responses: {
			"200": { description: "Declined", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
			"404": { description: "invite_not_found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const db = searchDb(c);
		if (!db) return fail(c, 503, 'unavailable', 'Invitations are not available right now');
		const invite = await openInviteFor(c, db, params.id, userId);
		if (!invite) return fail(c, 404, 'invite_not_found', 'This invitation is no longer open');
		if (await closeInvite(db, invite.id, 'declined')) {
			// Declining an email invitation doesn't name the account to the inviter
			const who = invite.by_email ? EMAIL_INVITEE_ACTOR : userId;
			await recordTeamActivity(c.env as never, executionCtx(c), [{ channelId: invite.channel_id, actorId: who, action: 'invite_declined', targetUserId: invite.by_email ? null : userId, newRole: invite.role }]);
		}
		return c.json({ success: true }, 200, NO_STORE);
	}
}
