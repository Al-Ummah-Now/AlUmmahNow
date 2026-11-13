/**
 * Staff passkey rule (wiki epics/AUTH-PASSKEYS, "Token claims" and "Staff
 * enforcement points"): one reading of the Auth token for admin-api and
 * admin-web (and the native admin apps through admin-api's answers).
 *
 * Auth access tokens carry:
 *   - `amr` (top level): how the user signed in: "pwd", "otp", "passkey", "fed".
 *     Absent on tokens issued before passkeys: treated as no passkey.
 *   - `auth_time` (top level, epoch seconds): the last real sign-in.
 *   - `properties.passkey_deadline` (epoch seconds): only for staff while staff
 *     enforcement is on in Auth. From then on the user must sign in with a passkey;
 *     a time in the future is the grace end.
 *
 * Rule: staff && passkey_deadline set && amr lacks "passkey":
 *   now >= deadline → blocked ("Passkey needed" page, no staff access)
 *   now <  deadline → grace (staff access, banner "Add a passkey by <date>")
 * Step-up (high-risk actions): auth_time within the last 900 s, and a passkey
 * sign-in whenever the rule above applies.
 *
 * Pure functions, no platform imports: unit tested in apps/admin-api.
 */
import { normalizeRoles } from './roles';

/** Roles that are staff (Auth RBAC names, normalised: lower-case, spaces as `_`). */
export const STAFF_ROLE_IDS = ['super_admin', 'admin', 'moderator', 'writer', 'content_reviewer', 'senior_reviewer'] as const;

/** Freshness a high-risk action needs (seconds), sent as `max_age` when asking for a new sign-in. */
export const STEP_UP_MAX_AGE_S = 900;

/** admin-api's answers (contract for admin-web and the native admin apps). */
export const PASSKEY_REQUIRED_ERROR = 'passkey_required';
export const STEP_UP_REQUIRED_ERROR = 'step_up_required';

export interface PasskeyClaims {
  /** Role names from the token (any spelling). */
  roles?: unknown;
  /** Top-level `amr`. */
  amr?: unknown;
  /** Top-level `auth_time` (epoch seconds). */
  authTime?: number;
  /** `properties.passkey_deadline` (epoch seconds). */
  passkeyDeadline?: number;
}

export type PasskeyGate =
  /** Not staff, enforcement off for this user, or signed in with a passkey. */
  | { state: 'ok' }
  /** Staff access until `deadline` (epoch seconds); show the banner. */
  | { state: 'grace'; deadline: number }
  /** No staff access: the "Passkey needed" page. */
  | { state: 'blocked'; deadline: number };

export type StepUpVerdict =
  | { ok: true }
  /** Sign in again (prompt=login&max_age=900). */
  | { ok: false; reason: 'stale' }
  /** Fresh, but the rule needs a passkey sign-in: the "Passkey needed" page. */
  | { ok: false; reason: 'passkey' };

export function isStaffRole(roles: unknown): boolean {
  return normalizeRoles(roles).some((role) => (STAFF_ROLE_IDS as readonly string[]).includes(role));
}

/** True when `amr` says the sign-in used a passkey. A missing or malformed `amr` is no passkey. */
export function signedInWithPasskey(amr: unknown): boolean {
  return Array.isArray(amr) && amr.includes('passkey');
}

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** Whether the staff rule applies to this token at all (whatever the time). */
function ruleApplies(claims: PasskeyClaims): claims is PasskeyClaims & { passkeyDeadline: number } {
  return finite(claims.passkeyDeadline) !== undefined && isStaffRole(claims.roles) && !signedInWithPasskey(claims.amr);
}

/** The staff rule for this token at `nowS` (epoch seconds). */
export function passkeyGate(claims: PasskeyClaims, nowS: number = Math.floor(Date.now() / 1000)): PasskeyGate {
  if (!ruleApplies(claims)) return { state: 'ok' };
  return nowS >= claims.passkeyDeadline ? { state: 'blocked', deadline: claims.passkeyDeadline } : { state: 'grace', deadline: claims.passkeyDeadline };
}

/** Whether the token may run a high-risk action at `nowS`. */
export function stepUpVerdict(claims: PasskeyClaims, nowS: number = Math.floor(Date.now() / 1000), maxAgeS: number = STEP_UP_MAX_AGE_S): StepUpVerdict {
  const authTime = finite(claims.authTime);
  if (authTime === undefined || authTime <= nowS - maxAgeS) return { ok: false, reason: 'stale' };
  if (ruleApplies(claims)) return { ok: false, reason: 'passkey' };
  return { ok: true };
}

/** The claims above from a decoded token payload (roles from `properties.roles`, else top-level `roles`). */
export function passkeyClaimsFromPayload(payload: unknown): PasskeyClaims {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  const properties = p.properties && typeof p.properties === 'object' ? (p.properties as Record<string, unknown>) : {};
  return {
    roles: Array.isArray(properties.roles) ? properties.roles : p.roles,
    amr: Array.isArray(p.amr) ? p.amr.filter((v): v is string => typeof v === 'string') : undefined,
    authTime: finite(p.auth_time),
    passkeyDeadline: finite(properties.passkey_deadline),
  };
}

/**
 * The payload of a JWT, without any signature check: only for a token that was
 * already verified (the OpenAuth client's verify drops claims its subject
 * schema does not list, such as `amr` and `properties.passkey_deadline`).
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const payload = JSON.parse(json) as unknown;
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Auth's add-a-passkey page, coming back to `returnTo` (an absolute URL of the app). */
export function passkeySetupUrl(issuer: string, returnTo: string): string {
  const url = new URL('/passkeys/setup', issuer);
  url.searchParams.set('return_to', returnTo);
  return url.toString();
}
