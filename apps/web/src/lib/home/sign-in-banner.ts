/**
 * Dismissal of the home page's sign-in banner (components/home/SignInBanner.tsx).
 *
 * The close button remembers the choice in this browser for 30 days. Storage may be
 * blocked (private windows, strict settings): every access is guarded, and a blocked
 * store only means the banner comes back on the next visit.
 *
 * A dismissed banner must never flash in and out (CLS 0): SIGN_IN_BANNER_SCRIPT runs
 * in the server HTML before the banner is parsed and marks <html>, and theme CSS hides
 * the banner under that mark before the first paint.
 */

/** localStorage key: the dismissal time in epoch milliseconds */
export const SIGN_IN_BANNER_STORAGE_KEY = 'aun:home-signin-banner:dismissed-at';

/** How long a dismissal lasts */
export const SIGN_IN_BANNER_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

/** Set on <html> while the banner is dismissed: `data-signin-banner="hidden"` */
export const SIGN_IN_BANNER_ATTR = 'data-signin-banner';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/** The browser's localStorage, or null where reading the property itself throws */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * True while a dismissal from the last 30 days is stored. A missing, unreadable or
 * malformed value, or one from the future (a changed clock), counts as not dismissed.
 */
export function isSignInBannerDismissed(storage: ReadableStorage | null, now: number = Date.now()): boolean {
  if (!storage) return false;
  let raw: string | null;
  try {
    raw = storage.getItem(SIGN_IN_BANNER_STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw || !/^\d+$/.test(raw)) return false;
  const at = Number(raw);
  return at <= now && now - at < SIGN_IN_BANNER_DISMISS_MS;
}

/** Stores the dismissal. Returns false when storage is blocked (the banner then hides for this page view only). */
export function rememberSignInBannerDismissed(storage: WritableStorage | null, now: number = Date.now()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SIGN_IN_BANNER_STORAGE_KEY, String(Math.floor(now)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Inline, pre-paint: marks <html> when the banner is dismissed. The same rule as
 * isSignInBannerDismissed, kept in step by the unit tests (they run this string).
 */
export const SIGN_IN_BANNER_SCRIPT =
  `(function(){try{var v=localStorage.getItem(${JSON.stringify(SIGN_IN_BANNER_STORAGE_KEY)});` +
  `if(!v||!/^\\d+$/.test(v))return;var a=+v,n=Date.now();` +
  `if(a<=n&&n-a<${SIGN_IN_BANNER_DISMISS_MS})document.documentElement.setAttribute(${JSON.stringify(SIGN_IN_BANNER_ATTR)},"hidden")}catch(e){}})()`;
