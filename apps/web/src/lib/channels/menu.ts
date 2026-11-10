/**
 * The account menu's channel groups: "Your channels" (owned) and "Channels
 * you manage" (a channel role), each channel once, managed ones with a role
 * badge. Pure, so the grouping is unit-tested.
 */

import { groupChannelsByRole, type ChannelRole } from '@al-ummah/shared-types';

export interface MenuChannel {
  id: string;
  userId: string;
  name: string;
  nameLocalized?: Record<string, string>;
  avatarUrl?: string;
  isMain: boolean;
  role?: ChannelRole;
}

export interface ChannelMenuSection<T extends MenuChannel> {
  key: 'owned' | 'managed';
  items: Array<T & { role: ChannelRole }>;
}

/**
 * Channels with no role (cookies written before roles existed) are the
 * account's own when `userId` matches or is missing, as the menu treated them
 * before, and are dropped otherwise.
 * Empty groups are left out.
 */
export function buildChannelMenu<T extends MenuChannel>(channels: ReadonlyArray<T>, accountUserId: string): ChannelMenuSection<T>[] {
  const mine = (c: T) => !c.userId || c.userId === accountUserId;
  const withRoles = channels
    .map((c) => ({ ...c, role: c.role ?? (mine(c) ? 'owner' : undefined) }))
    .filter((c): c is T & { role: ChannelRole } => !!c.role && (c.role !== 'owner' || mine(c)));
  const { owned, managed } = groupChannelsByRole(withRoles);
  const sections: ChannelMenuSection<T>[] = [];
  if (owned.length) sections.push({ key: 'owned', items: owned });
  if (managed.length) sections.push({ key: 'managed', items: managed });
  return sections;
}

/**
 * Whether two channel lists show the same menu (ids, names, avatars, roles,
 * main flag), so the cookie cache is only rewritten when something changed.
 */
export function sameChannelList(a: ReadonlyArray<MenuChannel>, b: ReadonlyArray<MenuChannel>): boolean {
  const key = (list: ReadonlyArray<MenuChannel>) =>
    list.map((c) => [c.id, c.name, c.avatarUrl ?? '', c.role ?? '', c.isMain ? 1 : 0].join('\u0001')).sort().join('\u0002');
  return key(a) === key(b);
}
