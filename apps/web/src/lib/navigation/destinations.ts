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
} as const;

export const ACCOUNT_MENU_PATHS = {
  myVideos: '/dashboard/videos',
  scheduled: '/scheduled-videos',
  analytics: '/analytics',
  settings: '/settings',
} as const;

export const HEADER_PATHS = {
  search: '/search',
  upload: '/upload',
  notifications: '/notifications',
} as const;

/** Unread badge text: past 9 the exact number is noise. */
export function unreadBadge(count: number, lang: string): string {
  return count > 9 ? `${(9).toLocaleString(lang)}+` : count.toLocaleString(lang);
}
