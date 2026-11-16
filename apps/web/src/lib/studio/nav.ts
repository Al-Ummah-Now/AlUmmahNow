/** The Studio left navigation, its tabs, and which role can open what (spec §4.1, §5.1). */

import { can, type StudioCapability, type StudioRole } from './permissions';

/** Empty means any role. Otherwise holding one of these is enough. */
type Requires = readonly StudioCapability[];

/**
 * Features the Studio layout passes in: `site` (the channel has a white-label site) and the keys
 * of GET /api/me/features for this channel. An item or tab with a feature that is not true is not
 * shown, and its path is unknown (404), never "no access" (wiki "Hidden when off").
 */
export interface StudioFeatures {
  site?: boolean;
  live?: boolean;
}
export type StudioFeature = keyof StudioFeatures;

export interface StudioTab {
  id: string;
  requires: Requires;
  /** Shown only while this feature is on for the channel */
  feature?: StudioFeature;
  /** Hidden until the work behind it ships */
  available?: boolean;
}

export interface StudioNavItem {
  id: 'dashboard' | 'content' | 'analytics' | 'comments' | 'playlists' | 'customisation' | 'site' | 'settings';
  /** Shown only while this feature is on for the channel (StudioFrame `features`) */
  feature?: StudioFeature;
  requires: Requires;
  /** Hidden until the work behind it ships */
  available?: boolean;
  tabs?: readonly StudioTab[];
}

/**
 * Studio sections whose page is still the channel settings page that came
 * before Studio. Studio links there (and its own URL redirects there), so no
 * Studio link is a dead end; each moves into Studio when it is rebuilt.
 */
const LEGACY_PAGES: Readonly<Record<string, string>> = {
  'content/posts': 'community',
  'content/posts/new': 'community/new',
  playlists: 'playlists',
  'customisation/profile': 'edit',
  'customisation/layout': 'sections',
  'settings/general': '',
  'settings/permissions': 'team',
};

/** The existing page a Studio path opens, or null when Studio has its own. */
export function legacyHref(locale: string, channelId: string, path: string): string | null {
  const page = LEGACY_PAGES[path.replace(/^\/+|\/+$/g, '')];
  if (page === undefined) return null;
  return `/${locale}/settings/channel/${encodeURIComponent(channelId)}${page ? `/${page}` : ''}`;
}

export const STUDIO_NAV: readonly StudioNavItem[] = [
  { id: 'dashboard', requires: [] },
  {
    id: 'content',
    requires: [],
    tabs: [
      { id: 'videos', requires: ['video.view_private'] },
      // Live streams (either provider, D3); a stream's Go live page needs live.manage
      { id: 'live', requires: ['live.manage', 'live.moderate'], feature: 'live' },
      { id: 'posts', requires: ['post.manage'] },
    ],
  },
  { id: 'analytics', requires: ['analytics.view'] },
  { id: 'comments', requires: ['comment.moderate'], available: false },
  { id: 'playlists', requires: ['playlist.manage'] },
  {
    id: 'customisation',
    requires: ['channel.edit'],
    tabs: [
      { id: 'profile', requires: ['channel.edit'] },
      { id: 'layout', requires: ['channel.edit'] },
    ],
  },
  // White-label scholar site (wiki AUN-SCHOLAR-SITES §7.1): owner and channel admins, only when the channel has a site
  { id: 'site', requires: ['channel.edit'], feature: 'site' },
  {
    id: 'settings',
    requires: ['channel.view_private'],
    tabs: [
      { id: 'general', requires: ['channel.view_private'] },
      { id: 'permissions', requires: ['members.view'] },
    ],
  },
];

function meets(role: StudioRole, requires: Requires): boolean {
  return requires.length === 0 || requires.some((capability) => can(role, capability));
}

const featureOn = (features: StudioFeatures, feature: StudioFeature | undefined) => !feature || features[feature] === true;

export function visibleTabs(role: StudioRole, item: StudioNavItem, features: StudioFeatures = {}): StudioTab[] {
  return (item.tabs ?? []).filter((tab) => tab.available !== false && featureOn(features, tab.feature) && meets(role, tab.requires));
}

/** The items this role sees. An item with tabs needs at least one tab it can open. */
export function visibleNav(role: StudioRole, features: StudioFeatures = {}): StudioNavItem[] {
  return STUDIO_NAV.filter(
    (item) => item.available !== false && featureOn(features, item.feature) && meets(role, item.requires) && (!item.tabs || visibleTabs(role, item, features).length > 0),
  );
}

/** Path below the channel that opens this item: its first tab the role can use. */
export function itemPath(role: StudioRole, item: StudioNavItem, features: StudioFeatures = {}): string {
  const [tab] = visibleTabs(role, item, features);
  return tab ? `${item.id}/${tab.id}` : item.id;
}

export type PathAccess =
  | { status: 'ok' }
  | { status: 'redirect'; path: string }
  | { status: 'forbidden' }
  | { status: 'unknown' };

/**
 * Whether this role can open a Studio path, given as segments below the channel. A path behind a
 * feature that is off is unknown (404), so a hidden feature leaves no trace.
 */
export function checkPath(role: StudioRole, segments: readonly string[], features: StudioFeatures = {}): PathAccess {
  const [itemId, tabId, , action] = segments;
  const item = STUDIO_NAV.find((candidate) => candidate.id === itemId);
  if (!item || item.available === false) return { status: 'unknown' };

  // A role without access still gets "no access"; for a role with access, a feature that is off is unknown
  if (!item.tabs) {
    if (segments.length > 1) return { status: 'unknown' };
    if (!meets(role, item.requires)) return { status: 'forbidden' };
    return featureOn(features, item.feature) ? { status: 'ok' } : { status: 'unknown' };
  }
  if (!featureOn(features, item.feature)) return { status: 'unknown' };

  if (!tabId) {
    return visibleTabs(role, item, features).length > 0 ? { status: 'redirect', path: itemPath(role, item, features) } : { status: 'forbidden' };
  }
  const tab = item.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.available === false) return { status: 'unknown' };
  if (!meets(role, tab.requires)) return { status: 'forbidden' };
  if (!featureOn(features, tab.feature)) return { status: 'unknown' };

  // A stream's Go live page (content/live/{streamId}) shows encoder settings
  if (item.id === 'content' && tab.id === 'live' && segments.length > 2) {
    if (segments.length !== 3) return { status: 'unknown' };
    if (!can(role, 'live.manage')) return { status: 'forbidden' };
  }

  // Per-video pages under the Videos tab have their own capability
  if (item.id === 'content' && tab.id === 'videos' && action) {
    const needed: StudioCapability | undefined = action === 'edit' ? 'video.edit' : action === 'analytics' ? 'analytics.view' : undefined;
    if (!needed || segments.length !== 4) return { status: 'unknown' };
    if (!can(role, needed)) return { status: 'forbidden' };
  }
  return { status: 'ok' };
}

/** The same page on another channel, without any nested id. Falls back to Dashboard. */
export function switchedPath(segments: readonly string[], role: StudioRole, features: StudioFeatures = {}): string {
  const top = segments.slice(0, 2);
  const access = checkPath(role, top, features);
  if (access.status === 'ok') return top.join('/');
  if (access.status === 'redirect') return access.path;
  return 'dashboard';
}
