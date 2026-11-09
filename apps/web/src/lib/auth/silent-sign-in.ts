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

/**
 * A same-origin path to return to, or null: no absolute or protocol-relative
 * URLs (no open redirect) and nothing under /api/ (no sign-in loop).
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, 'https://videos.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://videos.invalid' || url.pathname.startsWith('/api/')) return null;
  url.searchParams.delete('session_updated');
  return `${url.pathname}${url.search}`;
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
 * has an active account for this browser. 401 ([]), no active account, or no
 * answer (null: network, CORS) all mean "stay anonymous".
 */
export function probeOutcome(accounts: AuthAccount[] | null): 'sign-in' | 'stay-anonymous' {
  return accounts?.some((a) => a.isActive) ? 'sign-in' : 'stay-anonymous';
}

/** The login route for a silent (prompt=none) or explicit (prompt=login) sign-in. */
export function loginRoutePath(returnPath: string, locale: string, prompt: LoginPrompt): string {
  const params = new URLSearchParams({ prompt, locale });
  const safe = safeReturnPath(returnPath);
  if (safe) params.set('return', safe);
  return `/api/auth/login?${params.toString()}`;
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

/** The page to land on after a successful sign-in (session_updated reloads the header). */
export function successDestination(returnPath: string | null, locale: string): string {
  const path = safeReturnPath(returnPath) ?? `/${locale}`;
  const url = new URL(path, 'https://videos.invalid');
  url.searchParams.set('session_updated', 'true');
  return `${url.pathname}${url.search}`;
}
