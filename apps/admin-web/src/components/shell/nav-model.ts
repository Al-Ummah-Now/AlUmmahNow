/**
 * The admin's navigation: every section, its group, its icon and who sees it.
 * Kept apart from React so visibility, the active item and breadcrumbs can be
 * tested without a browser (test/nav-model.test.ts).
 */
import type { MessageKey } from '@/i18n/translate';
import type { IconName } from './icons';

/** Sidebar width preference: the full sidebar or the icon rail (tablet and wider). */
export const NAV_COOKIE = 'admin_nav';

export type NavGroupId = 'overview' | 'moderation' | 'content' | 'people' | 'operations' | 'site';

/** What the signed-in admin may open; computed on the server from the role (src/lib/roles.ts). */
export interface NavAccess {
  /** contact:read, which also gates Video formats (videos:format): admins and super admins */
  contact: boolean;
  /** videos:processing */
  processing: boolean;
  /** errors:read */
  errors: boolean;
  /** users:manage (Legacy profiles) */
  manageUsers: boolean;
  /** videos:uploads */
  staleUploads: boolean;
  /** media:manage (Delivery: Bunny vs R2 comparison) */
  media: boolean;
  /** ops:read (Operations: platform analytics per environment) */
  ops: boolean;
}

/** Live counts shown on nav items; null hides the badge. */
export interface NavBadges {
  contact?: number | null;
  errors?: number | null;
}

export interface NavItem {
  href: string;
  label: MessageKey;
  icon: IconName;
  group: NavGroupId;
  /** Absent: everyone with an admin role */
  requires?: (access: NavAccess) => boolean;
  badge?: keyof NavBadges;
  /** Testid of the badge, kept from the old top nav for the E2E suite */
  badgeTestId?: string;
  badgeLabel?: MessageKey;
}

export const NAV_GROUPS: { id: NavGroupId; label: MessageKey }[] = [
  { id: 'overview', label: 'nav.groupOverview' },
  { id: 'moderation', label: 'nav.groupModeration' },
  { id: 'content', label: 'nav.groupContent' },
  { id: 'people', label: 'nav.groupPeople' },
  { id: 'operations', label: 'nav.groupOperations' },
  { id: 'site', label: 'nav.groupSite' },
];

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'nav.dashboard', icon: 'home', group: 'overview' },
  // Site visits (D-SEO-9): cookieless daily totals of the videos site; every admin reads them
  { href: '/site-visits', label: 'nav.siteVisits', icon: 'activity', group: 'overview' },

  { href: '/moderation', label: 'nav.moderation', icon: 'flag', group: 'moderation' },
  { href: '/moderation/ai', label: 'nav.aiModeration', icon: 'spark', group: 'moderation' },
  { href: '/comments', label: 'nav.comments', icon: 'chat', group: 'moderation' },
  { href: '/community', label: 'nav.community', icon: 'people', group: 'moderation' },
  {
    href: '/contact', label: 'nav.contact', icon: 'inbox', group: 'moderation',
    requires: (a) => a.contact, badge: 'contact', badgeTestId: 'contact-nav-badge', badgeLabel: 'contact.navBadge',
  },

  { href: '/videos', label: 'nav.videos', icon: 'film', group: 'content' },
  { href: '/channels', label: 'nav.channels', icon: 'tv', group: 'content' },
  { href: '/playlists', label: 'nav.playlists', icon: 'list', group: 'content' },
  { href: '/category-suggestions', label: 'nav.categorySuggestions', icon: 'tag', group: 'content' },
  { href: '/translations', label: 'nav.translations', icon: 'globe', group: 'content' },

  { href: '/users', label: 'nav.users', icon: 'user', group: 'people' },
  { href: '/creators', label: 'nav.creators', icon: 'crown', group: 'people' },
  { href: '/auth-requests', label: 'nav.authRequests', icon: 'key', group: 'people' },
  { href: '/legacy-profiles', label: 'nav.legacyProfiles', icon: 'archive', group: 'people', requires: (a) => a.manageUsers },

  { href: '/operations', label: 'nav.operations', icon: 'activity', group: 'operations', requires: (a) => a.ops },
  { href: '/processing', label: 'nav.processing', icon: 'cpu', group: 'operations', requires: (a) => a.processing },
  { href: '/stale-uploads', label: 'nav.staleUploads', icon: 'clock', group: 'operations', requires: (a) => a.staleUploads },
  { href: '/jobs', label: 'nav.jobs', icon: 'layers', group: 'operations' },
  {
    href: '/errors', label: 'nav.errors', icon: 'alert', group: 'operations',
    requires: (a) => a.errors || a.processing, badge: 'errors', badgeTestId: 'errors-nav-badge', badgeLabel: 'errorsPage.navBadge',
  },
  { href: '/indices', label: 'nav.indices', icon: 'database', group: 'operations' },
  { href: '/video-formats', label: 'nav.videoFormats', icon: 'file', group: 'operations', requires: (a) => a.contact },
  { href: '/delivery', label: 'nav.delivery', icon: 'film', group: 'operations', requires: (a) => a.media },
  // Live providers (D3): routing, providers, overrides, sessions, comparison; every admin reads, live:manage changes
  { href: '/live-streaming', label: 'nav.liveStreaming', icon: 'activity', group: 'operations' },
  // Public status page: incidents and maintenance (docs/status-page/README.md); admins (status:manage)
  { href: '/status', label: 'nav.status', icon: 'alert', group: 'operations', requires: (a) => a.ops },
  // Bot protection: Turnstile outcomes and rate-limit hits per endpoint (docs/features/bot-protection.md); ops:read
  { href: '/abuse', label: 'nav.abuse', icon: 'alert', group: 'operations', requires: (a) => a.ops },

  { href: '/site-theme', label: 'nav.siteTheme', icon: 'palette', group: 'site' },
  { href: '/platform-settings', label: 'nav.platformSettings', icon: 'sliders', group: 'site' },
  // White-label scholar sites (wiki AUN-SCHOLAR-SITES §8): every admin reads, creators:manage changes
  { href: '/sites', label: 'nav.scholarSites', icon: 'globe', group: 'site' },
  { href: '/deleted', label: 'nav.deleted', icon: 'trash', group: 'site' },
];

export function visibleItems(access: NavAccess): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.requires || item.requires(access));
}

/** The groups that have at least one visible item, each with its items, in order. */
export function groupedItems(access: NavAccess): { id: NavGroupId; label: MessageKey; items: NavItem[] }[] {
  const items = visibleItems(access);
  return NAV_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter((g) => g.items.length > 0);
}

/** The item for a path: the most specific match wins, so /moderation/ai does not also mark /moderation. */
export function activeItem(pathname: string, items: NavItem[]): NavItem | undefined {
  return items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export interface Crumb {
  label: MessageKey;
  /** Absent for the current page */
  href?: string;
}

/**
 * Group, then section. On a page below a section (a detail page, a sub-page),
 * the section links back to its list.
 */
export function breadcrumbs(pathname: string, items: NavItem[]): Crumb[] {
  const item = activeItem(pathname, items);
  if (!item) return [];
  const group = NAV_GROUPS.find((g) => g.id === item.group)!;
  const crumbs: Crumb[] = [];
  if (group.id !== 'overview') crumbs.push({ label: group.label });
  crumbs.push(pathname === item.href ? { label: item.label } : { label: item.label, href: item.href });
  return crumbs;
}

/** Badge text: 99+ above 99, nothing for zero or unknown. */
export function badgeText(count: number | null | undefined): string | null {
  if (!count || count < 1) return null;
  return count > 99 ? '99+' : String(count);
}
