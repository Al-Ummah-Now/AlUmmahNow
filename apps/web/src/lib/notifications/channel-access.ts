/**
 * Notifications that mean the account gained or lost a channel (a move, a role removed). The
 * notification center fires CHANNEL_ACCESS_CHANGED_EVENT for them, and the account provider
 * reloads the live channel list, so the menu and the active channel follow at once instead of at
 * the next focus or sign-in (wiki AUN-CHANNEL-CLAIM §3.6).
 */
export const CHANNEL_ACCESS_CHANGED_EVENT = 'aun:channel-access-changed';

const KEYS = new Set<string>(['channelMovedIn', 'channelMovedOutByTeam', 'channelMovedOutByTeamWithReason', 'channelMoveAccepted', 'channelMemberRemoved', 'channelRoleChanged']);

export function changesChannelAccess(key: unknown): boolean {
  return typeof key === 'string' && KEYS.has(key);
}
