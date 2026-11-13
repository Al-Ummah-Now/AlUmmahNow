/**
 * Sign-in decisions shared by the middleware, /login and /api/callback.
 *
 * Edge-safe and free of Next.js imports so it is unit tested directly.
 *
 * "If you are signed in, you are signed in": a request without an admin
 * session goes straight (server redirect) to /login, which sends the browser
 * to the auth server's /authorize with NO prompt. The auth server decides:
 * a browser session's active account gets a code silently, otherwise the
 * sign-in form is shown. There is no "Please log in" interstitial.
 */

/** Where an admin lands when nothing else was asked for. */
export const DEFAULT_RETURN_PATH = '/dashboard';

/** Request header the middleware sets so server components know the path being rendered. */
export const PATH_HEADER = 'x-admin-path';

/** Prompts the app may send to /authorize. Never select_account on the normal path. */
export type LoginPrompt = 'none' | 'login';

export function parsePrompt(value: string | null | undefined): LoginPrompt | undefined {
  return value === 'none' || value === 'login' ? value : undefined;
}

/**
 * `max_age` for /authorize (seconds): a step-up (wiki AUTH-PASSKEYS) asks for
 * prompt=login&max_age=900 after admin-api answered step_up_required. Whole
 * seconds up to a day; anything else is ignored.
 */
export function parseMaxAge(value: string | number | null | undefined): number | undefined {
  const n = typeof value === 'number' ? value : value != null && /^\d{1,6}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 86_400 ? n : undefined;
}

const PARSE_BASE = 'https://admin.invalid';

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
 * A same-origin path to return to after sign-in, or null. The NORMALISED
 * output is what gets validated (a parser differential such as `/.//evil.com`
 * or `/%2e//evil.com` normalises to `//evil.com`), so the result is always a
 * path on this origin that cannot be read as another host. Rejects the
 * sign-in routes themselves (no loop).
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
  if (url.origin !== PARSE_BASE) return null;
  const out = `${url.pathname}${url.search}`;
  if (!out.startsWith('/') || out.startsWith('//') || out.startsWith('/\\') || hostile(out)) return null;
  if (url.pathname === '/login' || url.pathname.startsWith('/api/') || url.pathname === '/access-denied') return null;
  // Belt and braces: the output must resolve to this origin on its own
  if (new URL(out, PARSE_BASE).origin !== PARSE_BASE) return null;
  return out;
}

/**
 * The absolute URL to redirect to: `path` resolved against the request URL,
 * or the request origin's `/` when it would leave that origin.
 */
export function sameOriginRedirect(path: string, requestUrl: string): URL {
  const base = new URL(requestUrl);
  try {
    const target = new URL(path, base);
    if (target.origin === base.origin) return target;
  } catch {
    // fall through
  }
  return new URL('/', base.origin);
}

/** /login URL (path) carrying the return path, an optional prompt and max_age. */
export function loginPath(returnTo?: string | null, prompt?: LoginPrompt, maxAge?: number): string {
  const params = new URLSearchParams();
  const safe = safeReturnPath(returnTo);
  if (safe && safe !== '/') params.set('return', safe);
  if (prompt) params.set('prompt', prompt);
  if (parseMaxAge(maxAge) !== undefined) params.set('max_age', String(maxAge));
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}

/**
 * What /login does: an admin who already has a session and did not ask for a
 * prompt goes straight on; anything else goes to the auth server.
 */
export function loginDecision(input: { authenticated: boolean; prompt?: LoginPrompt; returnTo?: string | null; maxAge?: number }):
  | { kind: 'continue'; to: string }
  | { kind: 'authorize'; prompt?: LoginPrompt; returnTo: string; maxAge?: number } {
  const returnTo = safeReturnPath(input.returnTo) ?? DEFAULT_RETURN_PATH;
  const maxAge = parseMaxAge(input.maxAge);
  if (input.authenticated && !input.prompt && maxAge === undefined) return { kind: 'continue', to: returnTo === '/' ? DEFAULT_RETURN_PATH : returnTo };
  return { kind: 'authorize', prompt: input.prompt, returnTo, ...(maxAge !== undefined ? { maxAge } : {}) };
}

/*
 * OAuth `state` = `<nonce>.<base64url(return path)>`. The nonce binds the
 * callback to the browser that started the sign-in: /api/auth/start stores
 * it in a short-lived httpOnly cookie scoped to /api/callback, and the
 * callback refuses (no code exchange, no session change) unless the state's
 * nonce matches that cookie. The return path is only ever used through
 * safeReturnPath.
 */

export const STATE_COOKIE = 'admin_oauth_state';
export const STATE_COOKIE_PATH = '/api/callback';
export const STATE_MAX_AGE = 600; // 10 minutes

export function stateCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: STATE_COOKIE_PATH, maxAge: STATE_MAX_AGE };
}

/** A fresh unguessable nonce (base64url, 128+ bits). */
export function newStateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

export function nonceFromState(state: string | null | undefined): string | null {
  if (!state) return null;
  const nonce = state.split('.')[0];
  return /^[A-Za-z0-9_-]{16,128}$/.test(nonce) ? nonce : null;
}

/**
 * PKCE (RFC 7636): /api/auth/start also sends an S256 code_challenge; the
 * verifier is kept next to the state cookie (same path and lifetime), bound
 * to the state nonce, and sent with the code exchange. A leaked code can't
 * be redeemed without it, and the auth server can then require PKCE.
 */
export const PKCE_COOKIE = 'admin_oauth_pkce';

/** Cookie value binding a verifier to the state nonce. */
export function pkceCookieValue(nonce: string, verifier: string): string {
  return `${nonce}.${verifier}`;
}

/** The verifier stored for this callback's state, if any. */
export function pkceVerifierFor(state: string | null | undefined, cookie: string | null | undefined): string | undefined {
  const nonce = nonceFromState(state);
  if (!nonce || !cookie) return undefined;
  const dot = cookie.indexOf('.');
  if (dot <= 0 || !stateMatches(state, cookie.slice(0, dot))) return undefined;
  return cookie.slice(dot + 1) || undefined;
}

/** The callback belongs to this browser's sign-in: the state's nonce equals the cookie. */
export function stateMatches(state: string | null | undefined, cookie: string | null | undefined): boolean {
  const nonce = nonceFromState(state);
  if (!nonce || !cookie || nonce.length !== cookie.length) return false;
  let diff = 0;
  for (let i = 0; i < nonce.length; i++) diff |= nonce.charCodeAt(i) ^ cookie.charCodeAt(i);
  return diff === 0;
}

/** /api/auth/start URL (path): starts the authorize round trip with a fresh state. */
export function startPath(prompt: LoginPrompt | undefined, returnTo: string, maxAge?: number): string {
  const params = new URLSearchParams();
  const safe = safeReturnPath(returnTo);
  if (safe) params.set('return', safe);
  if (prompt) params.set('prompt', prompt);
  if (parseMaxAge(maxAge) !== undefined) params.set('max_age', String(maxAge));
  const query = params.toString();
  return query ? `/api/auth/start?${query}` : '/api/auth/start';
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function encodeState(nonce: string, returnTo: string): string {
  return `${nonce}.${toBase64Url(safeReturnPath(returnTo) ?? DEFAULT_RETURN_PATH)}`;
}

export function returnPathFromState(state: string | null | undefined): string {
  if (!state) return DEFAULT_RETURN_PATH;
  const dot = state.indexOf('.');
  if (dot < 0) return DEFAULT_RETURN_PATH;
  const path = safeReturnPath(fromBase64Url(state.slice(dot + 1)));
  return !path || path === '/' ? DEFAULT_RETURN_PATH : path;
}

/**
 * The authorize URL from client.authorize() with the prompt and the state
 * (nonce + return path) set. Without a prompt the auth server signs the browser's
 * active account in silently, or shows its form.
 */
export function withLoginParams(authorizeUrl: string, prompt: LoginPrompt | undefined, returnTo: string, nonce: string, maxAge?: number): string {
  const url = new URL(authorizeUrl);
  url.searchParams.set('state', encodeState(nonce, returnTo));
  if (prompt) url.searchParams.set('prompt', prompt);
  else url.searchParams.delete('prompt');
  if (parseMaxAge(maxAge) !== undefined) url.searchParams.set('max_age', String(maxAge));
  else url.searchParams.delete('max_age');
  return url.toString();
}

/** Errors that only mean "no browser session to sign in silently". */
const NO_SESSION_ERRORS = new Set(['login_required', 'interaction_required', 'consent_required', 'account_selection_required']);

/**
 * Where the callback goes when the auth server answered with an error instead
 * of a code. A failed silent sign-in (prompt=none) is not an error for the
 * user: they get the sign-in form (a plain /login, no prompt). Anything else
 * is shown on /login's error view.
 */
export function callbackErrorRedirect(error: string | null, state: string | null): string {
  if (error && NO_SESSION_ERRORS.has(error)) return loginPath(returnPathFromState(state));
  return '/login?error=auth_failed';
}
