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
 * A same-origin path to return to after sign-in, or null. Rejects absolute and
 * protocol-relative URLs (no open redirect) and the sign-in routes themselves
 * (no loop).
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, 'https://admin.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://admin.invalid') return null;
  if (url.pathname === '/login' || url.pathname.startsWith('/api/') || url.pathname === '/access-denied') return null;
  return `${url.pathname}${url.search}`;
}

/** /login URL (path) carrying the return path and an optional prompt. */
export function loginPath(returnTo?: string | null, prompt?: LoginPrompt): string {
  const params = new URLSearchParams();
  const safe = safeReturnPath(returnTo);
  if (safe && safe !== '/') params.set('return', safe);
  if (prompt) params.set('prompt', prompt);
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}

/**
 * What /login does: an admin who already has a session and did not ask for a
 * prompt goes straight on; anything else goes to the auth server.
 */
export function loginDecision(input: { authenticated: boolean; prompt?: LoginPrompt; returnTo?: string | null }):
  | { kind: 'continue'; to: string }
  | { kind: 'authorize'; prompt?: LoginPrompt; returnTo: string } {
  const returnTo = safeReturnPath(input.returnTo) ?? DEFAULT_RETURN_PATH;
  if (input.authenticated && !input.prompt) return { kind: 'continue', to: returnTo === '/' ? DEFAULT_RETURN_PATH : returnTo };
  return { kind: 'authorize', prompt: input.prompt, returnTo };
}

/*
 * The return path travels in the OAuth `state` (the auth server hands it back
 * on the callback, with a code or an error): `<random>.<base64url(path)>`.
 * It is only ever used through safeReturnPath, so a forged state can at most
 * pick another page of this app.
 */

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
 * The authorize URL from client.authorize() with the prompt and the return
 * path (in state) added. Without a prompt the auth server signs the browser's
 * active account in silently, or shows its form.
 */
export function withLoginParams(authorizeUrl: string, prompt: LoginPrompt | undefined, returnTo: string): string {
  const url = new URL(authorizeUrl);
  const nonce = url.searchParams.get('state') ?? crypto.randomUUID();
  url.searchParams.set('state', encodeState(nonce, returnTo));
  if (prompt) url.searchParams.set('prompt', prompt);
  else url.searchParams.delete('prompt');
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
