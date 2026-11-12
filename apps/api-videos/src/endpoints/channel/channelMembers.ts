/**
 * "My channels" with roles, and channel members (docs/specs/CHANNEL-ROLES.md).
 *
 * - GET    /api/channels/access                 channels the caller owns or holds a role on
 * - GET    /api/channels/:id/members            the owner and members (members.view)
 * - POST   /api/channels/:id/members            grant a role by @handle or user id
 * - PUT    /api/channels/:id/members/:userId    change a member's role
 * - DELETE /api/channels/:id/members/:userId    remove a member, or leave (yourself)
 *
 * Roles are stored on the R2 channel record (`members`) and written with a
 * conditional put, so a grant never drops a concurrent channel update. The
 * channel_access index follows every write through the shared ownership sync.
 * Channel roles are not site roles: site admins reach channels through the
 * videos admin, and nothing here reads token roles.
 */

import { Str } from "chanfana";
import { z } from "zod";
import {
	CHANNEL_MEMBER_ROLES,
	MAX_CHANNEL_MEMBERS,
	canManageRole,
	capabilitiesOf,
	channelMembersOf,
	channelRoleOf,
	can,
	type AccessibleChannel,
	type ChannelMember,
	type ChannelMemberRole,
	type ChannelRole,
} from "@al-ummah/shared-types";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { AuthenticatedRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import { FALLBACK_SCAN_OBJECTS } from "../../lib/scanBudget";
import { normalizeHandleInput, resolveHandle } from "../../lib/channelHandles";
import { memberChannelRoles, ownedChannelIds, scheduleOwnershipHeal, waitUntilOf } from "../../lib/search/ownership";
import { resolveDisplayName, type NameFields } from '@al-ummah/shared-types';

type ChannelType = z.infer<typeof BusinessChannel> & { isSuspended?: boolean; suspension?: { at?: string; reason?: string } };

const RoleEnum = z.enum(['owner', 'admin', 'editor', 'moderator']);
const MemberRoleEnum = z.enum(CHANNEL_MEMBER_ROLES as [ChannelMemberRole, ...ChannelMemberRole[]]);

const AccessibleChannelView = z.object({
	id: Str(),
	userId: Str(),
	name: Str(),
	nameLocalized: z.record(z.string()).optional(),
	avatarUrl: Str().optional(),
	handle: Str().optional(),
	isMain: z.boolean(),
	role: RoleEnum,
	capabilities: z.array(z.string()),
	isSuspended: z.boolean().optional(),
	suspension: z.object({ at: z.string(), reason: z.string().optional() }).optional(),
});

const MemberView = z.object({
	userId: Str(),
	role: RoleEnum,
	displayName: Str().optional(),
	avatarUrl: Str().optional(),
	addedAt: Str().optional(),
	isYou: z.boolean(),
});

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** Error body: a stable code for the client to translate, never internals. */
function fail(c: AppContext, status: 400 | 403 | 404 | 409 | 503, code: string, message: string) {
	return c.json({ success: false, code, error: message }, status, NO_STORE);
}

function toAccessible(channel: ChannelType, role: ChannelRole): AccessibleChannel & { capabilities: string[] } {
	return {
		id: channel.id,
		userId: channel.userId,
		name: channel.name,
		...(channel.nameLocalized ? { nameLocalized: channel.nameLocalized } : {}),
		...(channel.avatarUrl ? { avatarUrl: channel.avatarUrl } : {}),
		...(channel.handle ? { handle: channel.handle } : {}),
		isMain: role === 'owner' && channel.isMain === true,
		role,
		capabilities: capabilitiesOf(role),
		// Only the owner sees an admin suspension notice for their channel
		...(role === 'owner' && channel.isSuspended === true
			? { isSuspended: true, suspension: { at: channel.suspension?.at ?? '', ...(channel.suspension?.reason ? { reason: channel.suspension.reason } : {}) } }
			: {}),
	};
}

/**
 * Bounded scan of the channels bucket, for when the indexes cannot be
 * trusted yet (the same fallback "my channels" has always used).
 */
async function scanChannels(repository: R2Repository<ChannelType>, match: (channel: ChannelType) => boolean): Promise<ChannelType[]> {
	const found: ChannelType[] = [];
	let cursor: string | undefined;
	let scanned = 0;
	do {
		const page = await repository.listObjects(100, cursor);
		for (const channel of page.items || []) if (channel && match(channel)) found.push(channel);
		scanned += (page.items || []).length;
		cursor = page.cursor || undefined;
	} while (cursor && scanned < FALLBACK_SCAN_OBJECTS);
	return found;
}

/**
 * Channels `userId` owns plus channels where they hold a role, each once,
 * with the role re-read from the channel record (an index row alone never
 * grants anything). Deleted and moderation-hidden channels are left out, as
 * in "my channels". Owned first (main first), then managed.
 */
export async function listAccessibleChannels(c: AppContext, userId: string): Promise<Array<AccessibleChannel & { capabilities: string[] }>> {
	const repository = new R2Repository<ChannelType>(c.env.channels);
	const [ownedIds, memberRows] = await Promise.all([
		ownedChannelIds(c.env as never, userId),
		memberChannelRoles(c.env as never, userId),
	]);

	let candidates: ChannelType[];
	if (ownedIds && memberRows) {
		const ids = [...new Set([...ownedIds, ...memberRows.map(r => r.channelId)])];
		const loaded = await Promise.all(ids.map(id => repository.getObject(id)));
		candidates = loaded.filter((ch): ch is ChannelType => ch !== null);
		logger.debug('[ChannelAccess] Served from the ownership and access indexes', { userId, owned: ownedIds.length, member: memberRows.length });
	} else {
		candidates = await scanChannels(repository, ch => channelRoleOf(ch, userId) !== null);
		scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), 'channel');
		logger.debug('[ChannelAccess] Indexes not usable yet; served from a bounded scan', { userId, found: candidates.length });
	}

	const seen = new Set<string>();
	const result: Array<AccessibleChannel & { capabilities: string[] }> = [];
	for (const channel of candidates) {
		if (!channel?.id || seen.has(channel.id)) continue;
		if (channel.isDeleted || channel.isHidden) continue;
		const role = channelRoleOf(channel, userId);
		if (!role) continue;
		seen.add(channel.id);
		result.push(toAccessible(channel, role));
	}
	const name = (ch: { name: string }) => (ch.name || '').toLocaleLowerCase();
	return result.sort((a, b) =>
		Number(b.role === 'owner') - Number(a.role === 'owner')
		|| Number(b.isMain) - Number(a.isMain)
		|| name(a).localeCompare(name(b)));
}

export class ChannelAccessList extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "My channels, with my role on each",
		description: "Channels the caller owns, then channels where they hold a channel role (admin, editor, moderator), each once with `role` and its capabilities. Channel roles are separate from site roles: a site admin's powers over other channels are not listed here. Deleted and moderation-hidden channels are left out. Never cached.",
		responses: {
			"200": {
				description: "Accessible channels",
				content: { "application/json": { schema: z.object({ success: z.boolean(), data: z.array(AccessibleChannelView) }) } },
			},
			"401": { description: "Authentication required", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		const data = await listAccessibleChannels(c, userId);
		return c.json({ success: true, data }, 200, NO_STORE);
	}
}

/** Display fields from the member's profile (best effort: a missing profile just shows no name). */
async function profileSummary(c: AppContext, userId: string): Promise<{ displayName?: string; avatarUrl?: string }> {
	try {
		const object = await c.env.profiles?.get(userId);
		if (!object) return {};
		const p = await object.json<Record<string, unknown>>();
		const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
		const displayName = resolveDisplayName(p as NameFields) || undefined;
		const avatarUrl = text(p.avatarUrl) ?? text(p.photoUrl);
		return { ...(displayName ? { displayName } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
	} catch (error) {
		logger.warn('[ChannelMembers] Profile unreadable for the member list', { userId, error: error instanceof Error ? error.message : String(error) });
		return {};
	}
}

async function loadLiveChannel(c: AppContext, id: string): Promise<ChannelType | null> {
	const channel = await new R2Repository<ChannelType>(c.env.channels).getObject(id);
	return channel && !channel.isDeleted ? channel : null;
}

async function memberViews(c: AppContext, channel: ChannelType, viewerId: string) {
	const owner = { userId: channel.userId, role: 'owner' as const };
	const all = [owner, ...channelMembersOf(channel)];
	return Promise.all(all.map(async (m) => ({
		userId: m.userId,
		role: m.role,
		...('addedAt' in m && m.addedAt ? { addedAt: m.addedAt } : {}),
		...(await profileSummary(c, m.userId)),
		isYou: m.userId === viewerId,
	})));
}

const MembersResponse = z.object({ success: z.boolean(), data: z.object({ members: z.array(MemberView), maxMembers: z.number() }) });

export class ChannelMembersList extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "List a channel's owner and members",
		description: "Needs the members.view channel capability (owner or channel admin).",
		request: { params: z.object({ id: Str({ description: "Channel ID" }) }) },
		responses: {
			"200": { description: "Members", content: { "application/json": { schema: MembersResponse } } },
			"403": { description: "No permission", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const channel = await loadLiveChannel(c, params.id);
		if (!channel) return fail(c, 404, 'channel_not_found', 'Channel not found');
		if (!can(channelRoleOf(channel, userId), 'members.view')) return fail(c, 403, 'forbidden', 'You cannot view this channel\'s team');
		return c.json({ success: true, data: { members: await memberViews(c, channel, userId), maxMembers: MAX_CHANNEL_MEMBERS } }, 200, NO_STORE);
	}
}

type Rejection = { status: 400 | 403 | 404 | 409; code: string; message: string };

/**
 * Apply one membership change on the fresh channel record (conditional put),
 * re-checking the actor's role on every attempt.
 */
async function changeMembers(
	c: AppContext,
	channelId: string,
	actorId: string,
	mutate: (channel: ChannelType, actorRole: ChannelRole | null, members: ChannelMember[]) => Rejection | ChannelMember[] | false,
) {
	const repository = new R2Repository<ChannelType>(c.env.channels);
	const { data, rejected } = await repository.updateObjectOrReject<Rejection>(channelId, (fresh) => {
		if (fresh.isDeleted) return { reject: { status: 404, code: 'channel_not_found', message: 'Channel not found' } };
		const outcome = mutate(fresh, channelRoleOf(fresh, actorId), channelMembersOf(fresh));
		if (outcome === false) return false;
		if (!Array.isArray(outcome)) return { reject: outcome };
		fresh.members = outcome;
		fresh.dateModified = new Date().toISOString();
		return true;
	});
	if (!data) return { rejected: { status: 404 as const, code: 'channel_not_found', message: 'Channel not found' } };
	return { channel: data, rejected };
}

const GrantBody = z.object({
	handle: z.string().min(1).max(64).optional(),
	userId: z.string().min(1).max(200).optional(),
	role: MemberRoleEnum,
}).refine(b => !!b.handle !== !!b.userId, { message: 'Give exactly one of handle or userId' });

export class ChannelMemberAdd extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Give someone a role on a channel",
		description: "Identify the person by the @handle of one of their channels, or by user id. Owners grant any role; channel admins grant editor and moderator. The owner holds no member role, and ownership itself only moves by a super admin transfer.",
		request: {
			params: z.object({ id: Str({ description: "Channel ID" }) }),
			body: { content: { "application/json": { schema: GrantBody } } },
		},
		responses: {
			"200": { description: "Members after the change", content: { "application/json": { schema: MembersResponse } } },
			"400": { description: "Invalid request", content: { "application/json": { schema: ResponseError } } },
			"403": { description: "No permission", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel or person not found", content: { "application/json": { schema: ResponseError } } },
			"409": { description: "Already a member, the owner, or the team is full", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const actorId = this.getUserId(c);

		let targetId = body.userId ?? null;
		if (body.handle) {
			const handle = normalizeHandleInput(body.handle);
			const handleChannelId = await resolveHandle(c.env.channel_tabs, handle);
			const handleChannel = handleChannelId ? await loadLiveChannel(c, handleChannelId) : null;
			if (!handleChannel || (handleChannel.handle || '').toLowerCase() !== handle.toLowerCase()) {
				return fail(c, 404, 'person_not_found', 'No channel has that handle');
			}
			targetId = handleChannel.userId;
		} else if (targetId && !(await c.env.profiles?.head(targetId))) {
			return fail(c, 404, 'person_not_found', 'No account with that id');
		}
		if (!targetId) return fail(c, 400, 'invalid_request', 'Give a handle or a user id');

		const now = new Date().toISOString();
		const { channel, rejected } = await changeMembers(c, params.id, actorId, (fresh, actorRole, members) => {
			if (!canManageRole(actorRole, body.role)) return { status: 403, code: 'forbidden', message: 'You cannot give this role on this channel' };
			if (targetId === fresh.userId) return { status: 409, code: 'cannot_invite_owner', message: 'The owner already has every permission' };
			if (members.some(m => m.userId === targetId)) return { status: 409, code: 'already_member', message: 'This person already has a role on this channel' };
			if (members.length >= MAX_CHANNEL_MEMBERS) return { status: 409, code: 'member_limit', message: 'This channel\'s team is full' };
			return [...members, { userId: targetId!, role: body.role, addedBy: actorId, addedAt: now }];
		});
		if (rejected) return fail(c, rejected.status, rejected.code, rejected.message);
		logger.debug('[ChannelMembers] Role granted', { channelId: params.id, actorId, targetId, role: body.role });
		return c.json({ success: true, data: { members: await memberViews(c, channel!, actorId), maxMembers: MAX_CHANNEL_MEMBERS } }, 200, NO_STORE);
	}
}

export class ChannelMemberUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Change a member's role on a channel",
		description: "Owners change any member; channel admins change editors and moderators, and only to editor or moderator.",
		request: {
			params: z.object({ id: Str({ description: "Channel ID" }), userId: Str({ description: "Member's user id" }) }),
			body: { content: { "application/json": { schema: z.object({ role: MemberRoleEnum }) } } },
		},
		responses: {
			"200": { description: "Members after the change", content: { "application/json": { schema: MembersResponse } } },
			"403": { description: "No permission", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel or member not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const actorId = this.getUserId(c);
		const { channel, rejected } = await changeMembers(c, params.id, actorId, (_fresh, actorRole, members) => {
			const target = members.find(m => m.userId === params.userId);
			if (!target) return { status: 404, code: 'member_not_found', message: 'This person has no role on this channel' };
			if (!canManageRole(actorRole, target.role) || !canManageRole(actorRole, body.role)) {
				return { status: 403, code: 'forbidden', message: 'You cannot change this person\'s role' };
			}
			if (target.role === body.role) return false;
			return members.map(m => (m.userId === target.userId ? { ...m, role: body.role, updatedAt: new Date().toISOString() } : m));
		});
		if (rejected) return fail(c, rejected.status, rejected.code, rejected.message);
		logger.debug('[ChannelMembers] Role changed', { channelId: params.id, actorId, targetId: params.userId, role: body.role });
		return c.json({ success: true, data: { members: await memberViews(c, channel!, actorId), maxMembers: MAX_CHANNEL_MEMBERS } }, 200, NO_STORE);
	}
}

export class ChannelMemberRemove extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Remove a member from a channel, or leave it",
		description: "Owners remove anyone; channel admins remove editors and moderators; any member may remove themselves (leave). The owner cannot be removed: ownership only moves by a super admin transfer. Takes effect on the member's next request.",
		request: { params: z.object({ id: Str({ description: "Channel ID" }), userId: Str({ description: "Member's user id" }) }) },
		responses: {
			"200": { description: "Removed", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
			"403": { description: "No permission", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel or member not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const actorId = this.getUserId(c);
		const { rejected } = await changeMembers(c, params.id, actorId, (fresh, actorRole, members) => {
			if (params.userId === fresh.userId) return { status: 403, code: 'cannot_remove_owner', message: 'The owner cannot be removed' };
			const target = members.find(m => m.userId === params.userId);
			if (!target) return { status: 404, code: 'member_not_found', message: 'This person has no role on this channel' };
			const leaving = params.userId === actorId;
			if (!leaving && !canManageRole(actorRole, target.role)) return { status: 403, code: 'forbidden', message: 'You cannot remove this person' };
			return members.filter(m => m.userId !== target.userId);
		});
		if (rejected) return fail(c, rejected.status, rejected.code, rejected.message);
		logger.debug('[ChannelMembers] Member removed', { channelId: params.id, actorId, targetId: params.userId });
		return c.json({ success: true }, 200, NO_STORE);
	}
}
