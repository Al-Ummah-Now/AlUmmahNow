/**
 * Staff passkeys in admin-web (wiki epics/AUTH-PASSKEYS, "Staff enforcement points").
 *
 * - The session's own access token: after `properties.passkey_deadline`, a staff
 *   sign-in without a passkey gets the "Passkey needed" page instead of the admin
 *   (requireAdminRole, lib/auth.ts); before it, the grace banner.
 * - admin-api's answers: `403 passkey_required` → the same page;
 *   `401 step_up_required` → sign in again with prompt=login&max_age=900 and come
 *   back to the page (toResult, lib/api/request.ts).
 *
 * Edge-safe and free of Next.js imports so it is unit tested directly.
 */
import {
  PASSKEY_REQUIRED_ERROR,
  STEP_UP_MAX_AGE_S,
  STEP_UP_REQUIRED_ERROR,
  decodeJwtPayload,
  passkeyClaimsFromPayload,
  passkeyGate,
  passkeySetupUrl,
  type PasskeyGate,
} from '@al-ummah/shared-types';
import { DEFAULT_RETURN_PATH, loginPath, safeReturnPath } from './login-flow';

export type { PasskeyGate };

/** The "Passkey needed" page. */
export const PASSKEY_NEEDED_PATH = '/passkey-needed';

/** The staff rule for an (already verified) access token. */
export function sessionPasskeyGate(accessToken: string, nowS: number = Math.floor(Date.now() / 1000)): PasskeyGate {
  return passkeyGate(passkeyClaimsFromPayload(decodeJwtPayload(accessToken)), nowS);
}

/** "/passkey-needed?return=…&reason=…": the page, coming back to `returnTo` after a passkey sign-in. */
export function passkeyNeededPath(returnTo?: string | null, reason?: 'step_up'): string {
  const params = new URLSearchParams();
  const safe = safeReturnPath(returnTo);
  if (safe && safe !== '/' && !safe.startsWith(PASSKEY_NEEDED_PATH)) params.set('return', safe);
  if (reason) params.set('reason', reason);
  const query = params.toString();
  return query ? `${PASSKEY_NEEDED_PATH}?${query}` : PASSKEY_NEEDED_PATH;
}

/** "Sign in with a passkey": this app's own sign-in, forcing the form (prompt=login). */
export function passkeySignInPath(returnPath?: string | null): string {
  return loginPath(safeReturnPath(returnPath) ?? DEFAULT_RETURN_PATH, 'login');
}

/**
 * Auth's add-a-passkey page. It comes back to this app's sign-in (prompt=login),
 * so the admin signs in with the new passkey and lands on `returnPath`: the
 * current token says "password" until then.
 */
export function adminSetupUrl(issuer: string, origin: string, returnPath?: string | null): string {
  return passkeySetupUrl(issuer, new URL(passkeySignInPath(returnPath), origin).toString());
}

/** Step-up: sign in again (prompt=login&max_age=900), then back to the page. */
export function stepUpLoginPath(returnPath?: string | null, maxAge: number = STEP_UP_MAX_AGE_S): string {
  return loginPath(safeReturnPath(returnPath) ?? DEFAULT_RETURN_PATH, 'login', maxAge);
}

/** The path (and query) of a same-origin page URL such as a server action's Referer, or null. */
export function pathOfPageUrl(url: string | null | undefined, origin?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (origin && parsed.origin !== origin) return null;
    return safeReturnPath(`${parsed.pathname}${parsed.search}`);
  } catch {
    return null;
  }
}

/**
 * Where an admin-api failure sends the browser, or null when it is an
 * ordinary error: `passkey_required` → the "Passkey needed" page,
 * `step_up_required` → a fresh sign-in.
 */
export function passkeyRedirectFor(error: { status?: number; code?: string } | null | undefined, returnPath: string | null): string | null {
  if (!error) return null;
  if (error.status === 403 && error.code === PASSKEY_REQUIRED_ERROR) return passkeyNeededPath(returnPath, 'step_up');
  if (error.status === 401 && error.code === STEP_UP_REQUIRED_ERROR) return stepUpLoginPath(returnPath);
  return null;
}

/** "Add a passkey by <date>" in the admin's language (Gregorian, the platform's dates). */
export function formatPasskeyDeadline(deadlineS: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(deadlineS * 1000));
}

/** sessionStorage key of a dismissed banner (per deadline: a new deadline shows it again). */
export const graceBannerKey = (deadlineS: number) => `admin_passkey_banner_dismissed:${deadlineS}`;
