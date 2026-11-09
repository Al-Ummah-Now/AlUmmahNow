/** The Studio left navigation, its tabs, and which role can open what (spec §4.1, §5.1). */

import { can, type StudioCapability, type StudioRole } from './permissions';

/** Empty means any role. Otherwise holding one of these is enough. */
type Requires = readonly StudioCapability[];

export interface StudioTab {
  id: string;
  requires: Requires;
  /** Hidden until the work behind it ships */
  available?: boolean;
}

export interface StudioNavItem {
  id: 'dashboard' | 'content' | 'analytics' | 'comments' | 'playlists' | 'customisation' | 'settings';
  requires: Requires;
  tabs?: readonly StudioTab[];
}

/** The Permissions tab arrives with channel roles (PR #462). */
const PERMISSIONS_AVAILABLE = false;

export const STUDIO_NAV: readonly StudioNavItem[] = [
  { id: 'dashboard', requires: [] },
  {
    id: 'content',
    requires: [],
    tabs: [
      { id: 'videos', requires: ['video.view_private'] },
      { id: 'live', requires: ['live.manage', 'live.moderate'] },
      { id: 'posts', requires: ['post.manage'] },
    ],
  },
  { id: 'analytics', requires: ['analytics.view'] },
  { id: 'comments', requires: ['comment.moderate'] },
  { id: 'playlists', requires: ['post.manage'] },
  {
    id: 'customisation',
    requires: ['channel.edit'],
    tabs: [
      { id: 'profile', requires: ['channel.edit'] },
      { id: 'layout', requires: ['channel.edit'] },
    ],
  },
  {
    id: 'settings',
    requires: ['channel.view_private'],
    tabs: [
      { id: 'general', requires: ['channel.view_private'] },
      { id: 'permissions', requires: ['members.view'], available: PERMISSIONS_AVAILABLE },
    ],
  },
];

function meets(role: StudioRole, requires: Requires): boolean {
  return requires.length === 0 || requires.some((capability) => can(role, capability));
}

export function visibleTabs(role: StudioRole, item: StudioNavItem): StudioTab[] {
  return (item.tabs ?? []).filter((tab) => tab.available !== false && meets(role, tab.requires));
}

/** The items this role sees. An item with tabs needs at least one tab it can open. */
export function visibleNav(role: StudioRole): StudioNavItem[] {
  return STUDIO_NAV.filter((item) => meets(role, item.requires) && (!item.tabs || visibleTabs(role, item).length > 0));
}

/** Path below the channel that opens this item: its first tab the role can use. */
export function itemPath(role: StudioRole, item: StudioNavItem): string {
  const [tab] = visibleTabs(role, item);
  return tab ? `${item.id}/${tab.id}` : item.id;
}

export type PathAccess =
  | { status: 'ok' }
  | { status: 'redirect'; path: string }
  | { status: 'forbidden' }
  | { status: 'unknown' };

/** Whether this role can open a Studio path, given as segments below the channel. */
export function checkPath(role: StudioRole, segments: readonly string[]): PathAccess {
  const [itemId, tabId, , action] = segments;
  const item = STUDIO_NAV.find((candidate) => candidate.id === itemId);
  if (!item) return { status: 'unknown' };

  if (!item.tabs) {
    if (segments.length > 1) return { status: 'unknown' };
    return meets(role, item.requires) ? { status: 'ok' } : { status: 'forbidden' };
  }

  if (!tabId) {
    return visibleTabs(role, item).length > 0 ? { status: 'redirect', path: itemPath(role, item) } : { status: 'forbidden' };
  }
  const tab = item.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.available === false) return { status: 'unknown' };
  if (!meets(role, tab.requires)) return { status: 'forbidden' };

  // Per-video pages under the Videos tab have their own capability
  if (item.id === 'content' && tab.id === 'videos' && action) {
    const needed: StudioCapability | undefined = action === 'edit' ? 'video.edit' : action === 'analytics' ? 'analytics.view' : undefined;
    if (!needed || segments.length !== 4) return { status: 'unknown' };
    if (!can(role, needed)) return { status: 'forbidden' };
  }
  return { status: 'ok' };
}

/** The same page on another channel, without any nested id. Falls back to Dashboard. */
export function switchedPath(segments: readonly string[], role: StudioRole): string {
  const top = segments.slice(0, 2);
  const access = checkPath(role, top);
  if (access.status === 'ok') return top.join('/');
  if (access.status === 'redirect') return access.path;
  return 'dashboard';
}
