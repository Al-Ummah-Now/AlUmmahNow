/**
 * Silent sign-in for the public videos site (the "client probe").
 *
 * The site must not bounce anonymous visitors or crawlers through the auth
 * server. Instead, once per tab, a visitor without a session here asks the
 * auth server (credentialed fetch of /session/accounts) whether the browser
 * is signed in there, e.g. on the CMS or the profile app. If it is, the page
 * goes through /api/auth/login?prompt=none, the auth server answers with a
 * code for its active account (no UI), and the callback signs the site in and
 * returns to the page. If the silent attempt fails (error=login_required or
 * any error) the callback returns to the page anonymous, without an error
 * page; the per-tab flag stops it from trying again.
 *
 * Pure helpers shared by the browser (the probe), the login route and the
 * callback. No Next.js imports.
 */
import type { AuthAccount } from './auth-accounts';

/** sessionStorage key: the probe already ran in this tab. */
export const PROBE_FLAG = 'aun_auth_probe';

/** Cookies the login route leaves for the callback (short-lived, httpOnly). */
export const RETURN_COOKIE = 'auth_return';
export const SILENT_COOKIE = 'auth_silent';

/** Prompts the site may send to /authorize. Never select_account on the normal path. */
export type LoginPrompt = 'none' | 'login';

export function parsePrompt(value: string | null | undefined): LoginPrompt | undefined {
  return value === 'none' || value === 'login' ? value : undefined;
}

const PARSE_BASE = 'https://videos.invalid';

/** Backslashes and control characters anywhere: never in a return path. */
const HOSTILE_CHARS = /[\\\u0000-\u001f\u007f]/;
/**
 * Percent-encoded backslash, slash, dot or control character in the PATH
 * part: a parser could normalise them into a protocol-relative `//host`.
 * (The query may carry encoded values: it never changes the target host.)
 */
const HOSTILE_ENCODED_PATH = /%(?:5c|2f|2e|0[0-9a-f]|1[0-9a-f]|7f)/i;

function hostile(value: string): boolean {
  return HOSTILE_CHARS.test(value) || HOSTILE_ENCODED_PATH.test(value.split(/[?#]/)[0]);
}

/**
 * A same-origin path to return to, or null. The NORMALISED output is what
 * gets validated (a parser differential such as `/.//evil.com` or
 * `/%2e//evil.com` normalises to `//evil.com`), so the result is always a
 * path on this origin that cannot be read as another host. Nothing under
 * /api/ (no sign-in loop).
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || hostile(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PARSE_BASE);
  } catch {
    return null;
  }
  if (url.origin !== PARSE_BASE || url.pathname.startsWith('/api/')) return null;
  url.searchParams.delete('session_updated');
  const out = `${url.pathname}${url.search}`;
  if (!out.startsWith('/') || out.startsWith('//') || out.startsWith('/\\') || hostile(out)) return null;
  if (new URL(out, PARSE_BASE).origin !== PARSE_BASE) return null;
  return out;
}

/**
 * The page a sign-in started from, read from the request's Referer (a server
 * action posts to the page it was called on, so the Referer is that page).
 * Only a page on `origin` counts; anything else is null (sign-in goes home).
 */
export function returnPathFromReferer(referer: string | null | undefined, origin: string): string | null {
  if (!referer) return null;
  try {
    const page = new URL(referer);
    if (page.origin !== new URL(origin).origin) return null;
    return safeReturnPath(`${page.pathname}${page.search}`);
  } catch {
    return null;
  }
}

/**
 * The absolute URL to redirect to: `path` on `origin`, or `origin/` when it
 * would leave that origin.
 */
export function sameOriginUrl(path: string, origin: string): string {
  try {
    const target = new URL(path, origin);
    if (target.origin === new URL(origin).origin) return target.toString();
  } catch {
    // fall through
  }
  return new URL('/', origin).toString();
}

/** Pages where the probe never runs: the auth error page, embeds, API routes. */
export function isProbeExcludedPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname.startsWith('/embed') || /^\/[a-z]{2}\/(auth\/error|embed)(\/|$)/.test(pathname);
}

/** Whether to ask the auth server at all on this page load. */
export function shouldProbe(input: { hasAppSession: boolean; flagSet: boolean; pathname: string; authOrigin: string }): boolean {
  if (input.hasAppSession || input.flagSet || !input.authOrigin) return false;
  return !isProbeExcludedPath(input.pathname);
}

/**
 * What the probe's answer means: sign in silently only when the auth server
 * has an active account for this browser. No accounts ([]), no active account, or no
 * answer (null: network, CORS) all mean "stay anonymous".
 */
export function probeOutcome(accounts: AuthAccount[] | null): 'sign-in' | 'stay-anonymous' {
  return accounts?.some((a) => a.isActive) ? 'sign-in' : 'stay-anonymous';
}

/**
 * The login route for a silent (prompt=none) or explicit (prompt=login) sign-in.
 * Without a prompt it is a plain sign-in: the auth server shows its sign-in page,
 * or returns straight away when the browser is already signed in there.
 */
export function loginRoutePath(returnPath: string, locale: string, prompt?: LoginPrompt): string {
  const params = new URLSearchParams(prompt ? { prompt, locale } : { locale });
  const safe = safeReturnPath(returnPath);
  if (safe) params.set('return', safe);
  return `/api/auth/login?${params.toString()}`;
}

/**
 * Browser only: a signed-out visitor on a page that needs an account goes to
 * sign-in and comes back to this page (never to the home page).
 */
export function signInAndReturnHere(locale: string): void {
  const { pathname, search } = window.location;
  window.location.assign(loginRoutePath(`${pathname}${search}`, locale));
}

/**
 * Where the callback sends the browser when the auth server answered with an
 * error. After a silent attempt (or for errors that only mean "no browser
 * session") the visitor goes back to the page, anonymous, with no error page.
 * Anything else after an interactive sign-in is the auth error page.
 */
const NO_SESSION_ERRORS = new Set(['login_required', 'interaction_required', 'consent_required', 'account_selection_required']);

export function callbackErrorDestination(input: {
  error: string | null;
  silent: boolean;
  returnPath: string | null;
  locale: string;
}): string {
  const back = safeReturnPath(input.returnPath) ?? `/${input.locale}`;
  if (input.silent || (input.error && NO_SESSION_ERRORS.has(input.error))) return back;
  return `/${input.locale}/auth/error`;
}

/**
 * The page to land on after a successful sign-in: the page it started from, or the locale's home.
 * No ?session_updated=true marker any more: the landing is a full page load, so the header reads
 * the new session on mount anyway, and removing the marker afterwards raced the router (Next's
 * action queue committed the old URL back when the removal landed while a server action of the
 * session load was in flight, and the page never settled; local release suite, 2026-11-14).
 */
export function successDestination(returnPath: string | null, locale: string): string {
  return safeReturnPath(returnPath) ?? `/${locale}`;
}
