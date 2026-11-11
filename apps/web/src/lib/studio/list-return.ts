'use client';

/**
 * Back from the editor to the exact list it was opened from (same status,
 * filters, sort and scroll): the list records its URL when a row is opened,
 * and the editor's Back goes back in history when that is where it came from,
 * instead of a fresh navigation that starts the list over.
 */
const KEY = 'studio:list-return';

/** Called when a row opens `target` (an editor or analytics path) from the list. */
export function rememberListUrl(channelId: string, target: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ channelId, target: target.split('?')[0], url: `${window.location.pathname}${window.location.search}` }));
  } catch {
    // Storage unavailable: Back falls back to a link to the list
  }
}

export interface ListReturn {
  /** The list URL, with its status, filters and sort */
  url: string;
  /** True when the page now open is the one the list opened: history.back() returns to it */
  cameFromList: boolean;
}

/** Where this channel's editor goes back to, if it was opened from the list. */
export function listReturn(channelId: string, pathname: string): ListReturn | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const entry = raw ? (JSON.parse(raw) as { channelId?: string; url?: string; target?: string }) : null;
    if (entry?.channelId !== channelId || typeof entry.url !== 'string' || !entry.url.startsWith('/')) return null;
    return { url: entry.url, cameFromList: entry.target === pathname };
  } catch {
    return null;
  }
}

export function forgetListUrl(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to forget
  }
}
