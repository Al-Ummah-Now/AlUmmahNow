/**
 * Per-channel roles (docs/specs/CHANNEL-ROLES.md).
 *
 * Channel roles are NOT site roles: they live on the videos side (the owner is
 * `channel.userId`, everyone else is in `channel.members` on the R2 channel
 * record), are never written to auth and never appear in tokens. A site admin
 * holds no channel role, and a channel admin holds no site role. `can()`
 * therefore takes no token and no site role.
 *
 * Pure and shared, so api-videos (enforcement) and the web (display only)
 * read the same matrix.
 */

export type ChannelRole = 'owner' | 'admin' | 'editor' | 'moderator';

/** Roles that can be granted. Ownership only moves by a super admin transfer. */
export type ChannelMemberRole = Exclude<ChannelRole, 'owner'>;

export const CHANNEL_MEMBER_ROLES: ReadonlyArray<ChannelMemberRole> = ['admin', 'editor', 'moderator'];

/** Display order: owner first, then by decreasing power. */
export const CHANNEL_ROLE_ORDER: ReadonlyArray<ChannelRole> = ['owner', 'admin', 'editor', 'moderator'];

/** Members one channel can hold (hard cap; the plan's studio.teamSeats can lower it). */
export const MAX_CHANNEL_MEMBERS = 50;

export type ChannelCapability =
  | 'channel.view_private'
  | 'channel.edit'
  | 'channel.handle'
  | 'channel.delete'
  | 'channel.speak'
  | 'video.upload'
  | 'video.view_private'
  | 'video.edit'
  | 'video.delete'
  | 'video.schedule'
  | 'post.manage'
  | 'playlist.manage'
  | 'comment.moderate'
  | 'live.manage'
  | 'live.moderate'
  | 'analytics.view'
  | 'members.view'
  | 'members.manage'
  | 'members.manage_admins';

/**
 * The permission matrix (spec §4). `video.delete` for an editor is limited to
 * their own uploads: `canDeleteVideo` adds that rule.
 */
const MATRIX: Readonly<Record<ChannelRole, ReadonlySet<ChannelCapability>>> = {
  owner: new Set<ChannelCapability>([
    'channel.view_private', 'channel.edit', 'channel.handle', 'channel.delete', 'channel.speak',
    'video.upload', 'video.view_private', 'video.edit', 'video.delete', 'video.schedule', 'post.manage', 'playlist.manage',
    'comment.moderate', 'live.manage', 'live.moderate', 'analytics.view',
    'members.view', 'members.manage', 'members.manage_admins',
  ]),
  admin: new Set<ChannelCapability>([
    'channel.view_private', 'channel.edit', 'channel.speak',
    'video.upload', 'video.view_private', 'video.edit', 'video.delete', 'video.schedule', 'post.manage', 'playlist.manage',
    'comment.moderate', 'live.manage', 'live.moderate', 'analytics.view',
    'members.view', 'members.manage',
  ]),
  editor: new Set<ChannelCapability>([
    'channel.speak',
    'video.upload', 'video.view_private', 'video.edit', 'video.delete', 'video.schedule', 'post.manage', 'playlist.manage',
  ]),
  moderator: new Set<ChannelCapability>([
    'channel.speak', 'comment.moderate', 'live.moderate',
  ]),
};

export function isChannelRole(value: unknown): value is ChannelRole {
  return typeof value === 'string' && (CHANNEL_ROLE_ORDER as ReadonlyArray<string>).includes(value);
}

export function isChannelMemberRole(value: unknown): value is ChannelMemberRole {
  return typeof value === 'string' && (CHANNEL_MEMBER_ROLES as ReadonlyArray<string>).includes(value);
}

/** Whether `role` (null = no role) grants `capability`. */
export function can(role: ChannelRole | null | undefined, capability: ChannelCapability): boolean {
  if (!role || !isChannelRole(role)) return false;
  return MATRIX[role].has(capability);
}

/** Every capability `role` grants, in a stable order (for API responses). */
export function capabilitiesOf(role: ChannelRole | null | undefined): ChannelCapability[] {
  if (!role || !isChannelRole(role)) return [];
  return [...MATRIX[role]];
}

/** One membership as stored on the channel record (`channel.members`). */
export interface ChannelMember {
  userId: string;
  role: ChannelMemberRole;
  addedBy: string;
  addedAt: string;
  updatedAt?: string;
}

/** The fields of a channel record this module reads. */
export interface ChannelRoleSource {
  userId?: string | null;
  members?: unknown;
}

/** Valid memberships on a channel record; malformed entries and the owner are ignored. */
export function channelMembersOf(channel: ChannelRoleSource | null | undefined): ChannelMember[] {
  if (!channel || !Array.isArray(channel.members)) return [];
  const seen = new Set<string>();
  const members: ChannelMember[] = [];
  for (const entry of channel.members as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const m = entry as Partial<ChannelMember>;
    if (typeof m.userId !== 'string' || !m.userId || !isChannelMemberRole(m.role)) continue;
    if (m.userId === channel.userId || seen.has(m.userId)) continue;
    seen.add(m.userId);
    members.push({
      userId: m.userId,
      role: m.role,
      addedBy: typeof m.addedBy === 'string' ? m.addedBy : '',
      addedAt: typeof m.addedAt === 'string' ? m.addedAt : '',
      ...(typeof m.updatedAt === 'string' ? { updatedAt: m.updatedAt } : {}),
    });
  }
  return members;
}

/** The caller's role on a channel record: 'owner' from `userId`, otherwise their membership. */
export function channelRoleOf(channel: ChannelRoleSource | null | undefined, userId: string | null | undefined): ChannelRole | null {
  if (!channel || !userId) return null;
  if (channel.userId && channel.userId === userId) return 'owner';
  return channelMembersOf(channel).find(m => m.userId === userId)?.role ?? null;
}

/**
 * Whether `actor` may grant, change or remove `targetRole` (spec §4): the
 * owner manages everyone, a channel admin manages editors and moderators
 * only, so one admin cannot remove the others.
 */
export function canManageRole(actor: ChannelRole | null | undefined, targetRole: ChannelMemberRole): boolean {
  if (targetRole === 'admin') return can(actor, 'members.manage_admins');
  return can(actor, 'members.manage');
}

/** Editors delete only their own uploads; owners and admins delete any of the channel's videos. */
export function canDeleteVideo(
  role: ChannelRole | null | undefined,
  video: { uploadedBy?: string | null },
  userId: string,
): boolean {
  if (!can(role, 'video.delete')) return false;
  if (role === 'editor') return !!video.uploadedBy && video.uploadedBy === userId;
  return true;
}

/** A channel the caller can act as, with their role (GET /api/channels/access). */
export interface AccessibleChannel {
  id: string;
  userId: string;
  name: string;
  nameLocalized?: Record<string, string>;
  avatarUrl?: string;
  handle?: string;
  isMain: boolean;
  role: ChannelRole;
  isSuspended?: boolean;
  suspension?: { at: string; reason?: string };
}

/** Response of GET /api/channels/access. */
export interface ChannelAccessResponse {
  data: AccessibleChannel[];
}

/**
 * Split an access list into the menu's two groups: channels the user owns
 * ("Your channels"), then channels where they hold a role ("Channels you
 * manage"). A channel appears once; owned wins over a duplicate role entry.
 * Owned channels keep main first; managed ones sort by role, then name.
 */
export function groupChannelsByRole<T extends { id: string; role?: ChannelRole | null; isMain?: boolean; name?: string }>(
  channels: ReadonlyArray<T>,
): { owned: T[]; managed: T[] } {
  const byId = new Map<string, T>();
  for (const channel of channels) {
    if (!channel?.id || !channel.role) continue;
    const existing = byId.get(channel.id);
    if (!existing || (existing.role !== 'owner' && channel.role === 'owner')) byId.set(channel.id, channel);
  }
  const all = [...byId.values()];
  const name = (c: T) => (c.name ?? '').toLocaleLowerCase();
  const owned = all
    .filter(c => c.role === 'owner')
    .sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain) || name(a).localeCompare(name(b)));
  const managed = all
    .filter(c => c.role !== 'owner')
    .sort((a, b) => CHANNEL_ROLE_ORDER.indexOf(a.role!) - CHANNEL_ROLE_ORDER.indexOf(b.role!) || name(a).localeCompare(name(b)));
  return { owned, managed };
}

// ---------------------------------------------------------------------------
// Invitations and the activity log (docs/specs/CHANNEL-ROLES.md §4, §9, §11)
// ---------------------------------------------------------------------------

/** Days an invitation stays open. */
export const CHANNEL_INVITE_DAYS = 14;
/** Pending invitations one channel can have. */
export const MAX_PENDING_CHANNEL_INVITES = 50;
/** Channels one account can hold a role on. */
export const MAX_SHARED_CHANNELS = 50;
/** Invitations one person can send per hour, and one channel can receive per day. */
export const CHANNEL_INVITE_RATE = { perInviterHour: 30, perChannelDay: 100 } as const;
/** Activity log rows are kept this many days. */
export const CHANNEL_AUDIT_RETENTION_DAYS = 365;

/** `claimed` is transient: an accept in flight, settled within the request (or by the daily sweep). */
export type ChannelInviteStatus = 'pending' | 'claimed' | 'accepted' | 'declined' | 'cancelled' | 'expired';

/** Lower-cased, trimmed email, or null when it isn't one. */
export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || /\s/.test(email)) return null;
  // One @, a local part, and a domain with a dot that neither starts nor ends it
  // (split, not one regex: a backtracking pattern here is a ReDoS)
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return null;
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1 ? email : null;
}

/** A pending invitation as the Team page shows it. */
export interface ChannelInviteView {
  id: string;
  role: ChannelMemberRole;
  /** Set for @handle invitations, and for email ones once the invitee has seen them. */
  inviteeUserId?: string;
  inviteeName?: string;
  inviteeAvatarUrl?: string;
  /** Set for email invitations (the inviter typed it). */
  inviteeEmail?: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
}

/** One of my pending invitations (GET /api/channel-invites). */
export interface MyChannelInvite {
  id: string;
  role: ChannelMemberRole;
  channel: { id: string; name: string; nameLocalized?: Record<string, string>; handle?: string; avatarUrl?: string };
  invitedBy: { userId: string; displayName?: string };
  createdAt: string;
  expiresAt: string;
}

export const CHANNEL_AUDIT_ACTIONS = [
  'invite_sent',
  'invite_cancelled',
  'invite_accepted',
  'invite_declined',
  'invite_expired',
  'role_changed',
  'member_removed',
  'member_left',
  'member_removed_account_deleted',
  'transfer_kept_old_owner',
  'video_deleted',
  'channel_edited',
  'stream_key_rotated',
  'comment_removed',
  'post_deleted',
] as const;
export type ChannelAuditAction = (typeof CHANNEL_AUDIT_ACTIONS)[number];

/** One activity log row (GET /api/channels/:id/audit). Never carries an email address. */
export interface ChannelAuditEntry {
  id: string;
  action: ChannelAuditAction;
  actorId: string;
  actorName?: string;
  targetUserId?: string;
  targetName?: string;
  oldRole?: ChannelMemberRole;
  newRole?: ChannelMemberRole;
  createdAt: string;
}
