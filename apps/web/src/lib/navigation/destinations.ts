/**
 * Where each destination lives. A destination belongs to exactly one place:
 * the sidebar is for browsing, the account menu for account and channel scope,
 * and the header for its own actions.
 */
export const SIDEBAR_PATHS = {
  home: '/',
  explore: '/explore',
  subscriptions: '/subscriptions',
  library: '/library',
  history: '/history',
  watchLater: '/library/watch-later',
  liked: '/library/liked',
  privacy: '/settings/privacy',
  guidelines: '/community-guidelines',
  contact: '/contact',
} as const;

export const ACCOUNT_MENU_PATHS = {
  /** The creator home: videos, scheduling, analytics, channel settings (/studio opens the active channel) */
  studio: '/studio',
  settings: '/settings',
} as const;

export const HEADER_PATHS = {
  search: '/search',
  upload: '/upload',
  notifications: '/notifications',
} as const;

/**
 * The public status page (apps/status) for the env this site runs in: status[.qa|.stage].alummahnow.net,
 * production otherwise (local dev included). Arabic opens /ar.
 */
export function statusPageUrl(hostname: string, lang: string): string {
  const env = /(?:^|\.)(qa|stage)\.alummahnow\.net$/.exec(hostname)?.[1];
  return `https://status${env ? `.${env}` : ''}.alummahnow.net${lang === 'ar' ? '/ar' : '/'}`;
}

/** Unread badge text: past 9 the exact number is noise. */
export function unreadBadge(count: number, lang: string): string {
  return count > 9 ? `${(9).toLocaleString(lang)}+` : count.toLocaleString(lang);
}
