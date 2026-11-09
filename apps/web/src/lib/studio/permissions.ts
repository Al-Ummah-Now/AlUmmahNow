/**
 * Channel roles and what each can do in Studio (docs/specs/CREATOR-STUDIO.md §5).
 *
 * Channel roles are per channel and live on the videos side. They are never
 * site roles and never come from a token. This mirrors the matrix in the channel
 * roles spec (PR #462), and is replaced by its shared `can()` when that ships.
 * Display only: the API is what enforces these.
 */

export type StudioRole = 'owner' | 'admin' | 'editor' | 'moderator';

export type StudioCapability =
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
  | 'comment.moderate'
  | 'live.manage'
  | 'live.moderate'
  | 'analytics.view'
  | 'members.view'
  | 'members.manage'
  | 'members.manage_admins';

const ADMIN: readonly StudioCapability[] = [
  'channel.view_private',
  'channel.edit',
  'channel.speak',
  'video.upload',
  'video.view_private',
  'video.edit',
  'video.delete',
  'video.schedule',
  'post.manage',
  'comment.moderate',
  'live.manage',
  'live.moderate',
  'analytics.view',
  'members.view',
  'members.manage',
];

const MATRIX: Record<StudioRole, ReadonlySet<StudioCapability>> = {
  owner: new Set<StudioCapability>([...ADMIN, 'channel.handle', 'channel.delete', 'members.manage_admins']),
  admin: new Set(ADMIN),
  // Delete is limited to the editor's own uploads by the server
  editor: new Set<StudioCapability>([
    'channel.speak',
    'video.upload',
    'video.view_private',
    'video.edit',
    'video.delete',
    'video.schedule',
    'post.manage',
  ]),
  moderator: new Set<StudioCapability>(['channel.speak', 'comment.moderate', 'live.moderate']),
};

export function can(role: StudioRole | null, capability: StudioCapability): boolean {
  return role !== null && MATRIX[role].has(capability);
}

/** Until channel roles ship, the owner is the only role anyone can hold. */
export function roleForChannel(channel: { userId?: string } | null | undefined, userId: string): StudioRole | null {
  return channel?.userId && channel.userId === userId ? 'owner' : null;
}
