/**
 * Staff passkeys (wiki epics/AUTH-PASSKEYS, "Staff enforcement points").
 *
 * passkeyMiddleware (every /api/* request, after auth + admin): a staff token
 * whose `properties.passkey_deadline` has passed and that was not signed in with
 * a passkey gets `403 { error: "passkey_required", setup_url }`. admin-web and
 * the native admin apps show their "Passkey needed" page for it. During the
 * grace period the request goes through (admin-web shows the banner from its
 * own token).
 *
 * stepUp (high-risk actions, registered in src/index.ts STEP_UP_ROUTES): the
 * sign-in must be under 900 s old, else `401 { error: "step_up_required",
 * max_age: 900 }` and the app reopens sign-in with prompt=login&max_age=900. A
 * fresh sign-in that still lacks a passkey while the staff rule applies (grace
 * period) answers `403 passkey_required` with `reason: "step_up"`: signing in
 * again with a password would not help, the user needs a passkey.
 *
 * Nothing is blocked until Auth puts passkey_deadline in tokens (enforcement on).
 */
import type { Context, Next } from 'hono';
import {
  PASSKEY_REQUIRED_ERROR,
  STEP_UP_MAX_AGE_S,
  STEP_UP_REQUIRED_ERROR,
  passkeyGate,
  passkeySetupUrl,
  stepUpVerdict,
  type PasskeyClaims,
} from '@al-ummah/shared-types';
import { logger } from '../lib/logger';

interface PasskeyEnv {
  Issuer?: string;
  ADMIN_WEB_URL?: string;
  ENVIRONMENT?: string;
  /**
   * Local stack only (scripts/local-stack/stack.ts): a longer step-up window, because the admin
   * E2E run signs in once and runs (and cleans up) for longer than 15 minutes. Ignored on
   * production and stage; never set in a deployed wrangler config.
   */
  STEP_UP_MAX_AGE_S?: string;
}

/** The step-up window in seconds: 900, unless the local stack set a longer one. */
export function stepUpMaxAge(env: PasskeyEnv | undefined): number {
  const environment = (env?.ENVIRONMENT ?? 'production').toLowerCase();
  if (environment === 'production' || environment === 'stage' || environment === 'staging') return STEP_UP_MAX_AGE_S;
  const value = Number(env?.STEP_UP_MAX_AGE_S);
  return Number.isInteger(value) && value > STEP_UP_MAX_AGE_S ? value : STEP_UP_MAX_AGE_S;
}

interface AuthLike {
  userId?: string;
  roles?: string[];
  payload?: { amr?: unknown; auth_time?: number; passkey_deadline?: number };
}

/** The claims the rule reads, from the auth context set by authMiddleware. */
export function claimsOf(auth: AuthLike | undefined): PasskeyClaims {
  return {
    roles: auth?.roles,
    amr: auth?.payload?.amr,
    authTime: auth?.payload?.auth_time,
    passkeyDeadline: auth?.payload?.passkey_deadline,
  };
}

/** Auth's add-a-passkey page, coming back to admin-web; undefined without an issuer. */
export function setupUrlFor(env: PasskeyEnv | undefined): string | undefined {
  if (!env?.Issuer) return undefined;
  try {
    return passkeySetupUrl(env.Issuer, env.ADMIN_WEB_URL || env.Issuer);
  } catch {
    return undefined;
  }
}

/** The 403 body admin-web and the native admin apps turn into the "Passkey needed" page. */
export function passkeyRequiredBody(env: PasskeyEnv | undefined, extra: { reason?: 'deadline' | 'step_up'; deadline?: number } = {}) {
  const setup_url = setupUrlFor(env);
  return {
    success: false,
    error: PASSKEY_REQUIRED_ERROR,
    code: PASSKEY_REQUIRED_ERROR,
    ...(setup_url ? { setup_url } : {}),
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.deadline !== undefined ? { deadline: extra.deadline } : {}),
  };
}

export const stepUpRequiredBody = () => ({
  success: false,
  error: STEP_UP_REQUIRED_ERROR,
  code: STEP_UP_REQUIRED_ERROR,
  max_age: STEP_UP_MAX_AGE_S,
});

/** The staff rule on every staff request. */
export async function passkeyMiddleware(c: Context, next: Next) {
  const auth = c.get('auth') as AuthLike | undefined;
  const gate = passkeyGate(claimsOf(auth));
  if (gate.state === 'blocked') {
    logger.debug('[Passkeys] Staff request without a passkey sign-in after the deadline', { userId: auth?.userId, deadline: gate.deadline });
    return c.json(passkeyRequiredBody(c.env as PasskeyEnv, { reason: 'deadline', deadline: gate.deadline }), 403);
  }
  return next();
}

/** The answer for a high-risk action, or null when the sign-in is fresh (and strong) enough. */
export function stepUpAnswer(c: Context): Response | null {
  const auth = c.get('auth') as AuthLike | undefined;
  const verdict = stepUpVerdict(claimsOf(auth), undefined, stepUpMaxAge(c.env as PasskeyEnv));
  if (verdict.ok) return null;
  const { reason } = verdict as Extract<typeof verdict, { ok: false }>;
  logger.debug('[Passkeys] Step-up required', { userId: auth?.userId, reason, path: c.req.path });
  return reason === 'stale'
    ? c.json(stepUpRequiredBody(), 401)
    : c.json(passkeyRequiredBody(c.env as PasskeyEnv, { reason: 'step_up' }), 403);
}

/**
 * Step-up middleware for one route. `when` narrows it to some requests of the
 * route (e.g. a report action that bans the owner); it may read the JSON body
 * (Hono caches it for the handler).
 */
export function stepUp(when?: (c: Context) => boolean | Promise<boolean>) {
  return async (c: Context, next: Next) => {
    if (when && !(await when(c))) return next();
    return stepUpAnswer(c) ?? next();
  };
}
