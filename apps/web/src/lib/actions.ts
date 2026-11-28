"use server"
import { getOpenAuthClient } from "./auth/openauth-client"
import { withAuthorizeLocale } from "./auth/authorize-locale"
import { redirect } from "next/navigation"
import { headers as getHeaders, cookies as getCookies } from "next/headers"
import { subjects, setTokens } from "./auth"
import { AuthSubject } from "@/interfaces"
import { startSingleSignOut } from "./auth/single-sign-out"
import { sessionRoles } from "./auth/session-roles"
import { verificationFailed } from "./auth/verify-result"
import { newStateNonce, pkceCookieValue, stateCookieOptions, withState, PKCE_COOKIE, STATE_COOKIE } from "./auth/oauth-state"
import { RETURN_COOKIE, returnPathFromReferer } from "./auth/silent-sign-in"
import { safeSignInReturn } from "@/lib/auth/sign-in-return"
import { logger } from "@/lib/logger-server"
import { readSessionValue } from "./auth/session-cookie"
import {
  SessionInfrastructureError,
  isNextControlFlowError,
  isOutsideRequestScopeError,
  reportWebServerError,
  safeErrorMeta,
} from "@/lib/errors/server-report"
import { isWebTokenRevoked } from "./auth/token-revocation"
import { revokeTokensOnSignOut } from "./auth/revoke-on-sign-out"
import { isLocaleSupported } from "@/lib/i18n/utils"
import { DEFAULT_LOCALE } from "@/lib/i18n/locales"
import { isLocalHostHeader } from "@/lib/security/safe-input"

export async function getClient() {
  return getOpenAuthClient();
}

export async function authenticated(): Promise<AuthSubject | false> {
  // Try SessionManager first (multi-account system). Infrastructure errors are
  // logged, reported to the admin Errors page and propagated instead of
  // silently signing the user out (#302).
  let session;
  try {
    const { SessionManager } = await import('./auth/session-manager');
    session = await SessionManager.getActiveSession();
  } catch (sessionError) {
    if (isNextControlFlowError(sessionError)) throw sessionError;
    if (!(sessionError instanceof SessionInfrastructureError && sessionError.reported)) {
      logger.error('[authenticated] Failed to resolve active session', safeErrorMeta(sessionError));
      await reportWebServerError(sessionError, { route: 'auth:authenticated', extra: { stage: 'session_manager' } });
    }
    throw sessionError instanceof SessionInfrastructureError
      ? sessionError
      : new SessionInfrastructureError('Failed to resolve active session', sessionError);
  }

  if (session) {
    return {
      type: "user",
      properties: {
        id: session.userId,
        email: session.email,
        displayName: session.displayName,
        // Role names from the session's access token (verified when the session was made). UI
        // hints only (e.g. the Scholar's "Write article"); every app checks roles itself.
        roles: sessionRoles(session.accessToken),
      }
    } as AuthSubject;
  }

  // Only fall back to legacy cookies when there is no al_ummah_session cookie
  let cookies;
  try {
    cookies = await getCookies();
  } catch (cookieError) {
    if (isNextControlFlowError(cookieError)) throw cookieError;
    if (isOutsideRequestScopeError(cookieError)) return false;
    logger.error('[authenticated] Failed to read cookies for legacy fallback', safeErrorMeta(cookieError));
    await reportWebServerError(cookieError, { route: 'auth:authenticated', extra: { stage: 'legacy_cookies' } });
    throw new SessionInfrastructureError('Failed to read cookies', cookieError);
  }
  if (readSessionValue(cookies)) {
    return false;
  }

  const accessToken = cookies.get("access_token");
  const refreshToken = cookies.get("refresh_token");
  if (!accessToken?.value) {
    return false;
  }

  let verified;
  try {
    const client = await getClient();
    verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value });
  } catch (verifyError) {
    if (isNextControlFlowError(verifyError)) throw verifyError;
    // OpenAuth returns invalid credentials as { err }. JWKS and refresh
    // network failures can throw.
    if (verifyError instanceof SessionInfrastructureError) throw verifyError;
    logger.error('[authenticated] Legacy token verification failed', safeErrorMeta(verifyError));
    await reportWebServerError(verifyError, { route: 'auth:authenticated', extra: { stage: 'legacy_verify' } });
    throw new SessionInfrastructureError('Failed to verify legacy token', verifyError);
  }

  // Any error is a failed verification. (openauth's errors are Error subclasses with no
  // enumerable keys, so the old `Object.keys(err).length > 0` test never saw one.)
  if (verificationFailed(verified)) {
    return false;
  }

  if (!('subject' in verified) || !verified.subject) return false;
  const rotated = 'tokens' in verified ? verified.tokens : undefined;
  if (await isWebTokenRevoked(rotated?.access ?? accessToken.value, verified.subject.properties.id)) return false;

  if (rotated) {
    try {
      await setTokens(rotated.access, rotated.refresh);
    } catch (setTokenError) {
      // Server Component renders have read-only cookies; log a warning without failing a valid verification
      if (isNextControlFlowError(setTokenError)) throw setTokenError;
      logger.warn('[authenticated] Could not persist rotated legacy tokens', safeErrorMeta(setTokenError));
    }
  }

  // Only the verified subject: never the token's payload read without its signature
  return verified.subject;
}

export async function login(locale: string = 'en', returnTo?: unknown) {
  const safeLocale = isLocaleSupported(locale) ? locale : DEFAULT_LOCALE;
  // Back to the page the sign-in started from (the action posts to that page),
  // or the locale's home when there is none
  const requestHeaders = await getHeaders()
  const host = requestHeaders.get("host")
  const protocol = isLocalHostHeader(host) ? "http" : "https"
  // A Studio page, the locale's home or /upgrade, when the button names it (lib/auth/sign-in-return.ts); others use the referer
  const returnPath = safeSignInReturn(returnTo, safeLocale) ?? (host ? returnPathFromReferer(requestHeaders.get("referer"), `${protocol}://${host}`) : null)
  const home = returnPath ?? `/${safeLocale}`

  // Check if already logged in via SessionManager
  try {
    const { SessionManager } = await import('./auth/session-manager');
    const session = await SessionManager.getActiveSession();

    if (session) {
      redirect(home);
    }
  } catch (sessionError) {
    if (isNextControlFlowError(sessionError)) throw sessionError;
    if (!(sessionError instanceof SessionInfrastructureError && sessionError.reported)) {
      logger.warn('[login] Failed to inspect existing session before sign-in', safeErrorMeta(sessionError));
      await reportWebServerError(sessionError, { route: 'auth:login', extra: { stage: 'session_manager' } });
    }
  }

  // Check legacy cookies
  const cookies = await getCookies()
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")
  const client = await getClient();

  if (accessToken) {
    try {
      const verified = await client.verify(subjects, accessToken.value, {
        refresh: refreshToken?.value,
      });

      const hasError = verificationFailed(verified);

      if (!hasError && 'tokens' in verified) {
        await setTokens(verified.tokens!.access, verified.tokens!.refresh);
        redirect(home);
      } else if (!hasError) {
        redirect(home);
      }
    } catch (_loginVerifyError) {
      // Silent failure, proceed with new authorization
    }
  }

  // Redirect to OAuth login. The redirect_uri must be byte-identical at
  // /authorize and /token, so the locale travels in a short-lived cookie
  // instead of the callback query string.
  const cookieStore = await getCookies()
  cookieStore.set("auth_locale", safeLocale, { httpOnly: true, sameSite: "lax", secure: protocol === "https", path: "/", maxAge: 600 })
  // An interactive sign-in: not silent, back to the page it started from
  cookieStore.delete("auth_silent")
  if (returnPath) cookieStore.set(RETURN_COOKIE, returnPath, { httpOnly: true, sameSite: "lax", secure: protocol === "https", path: "/", maxAge: 600 })
  else cookieStore.delete(RETURN_COOKIE)
  const { url, challenge } = await client.authorize(
    `${protocol}://${host}/api/callback`,
    "code",
    { pkce: true },
  )
  // Bind the callback to this browser (login CSRF), with its PKCE verifier
  const nonce = newStateNonce()
  cookieStore.set(STATE_COOKIE, nonce, stateCookieOptions(protocol === "https"))
  if (challenge?.verifier) cookieStore.set(PKCE_COOKIE, pkceCookieValue(nonce, challenge.verifier), stateCookieOptions(protocol === "https"))
  redirect(withAuthorizeLocale(withState(url, nonce), safeLocale))
}

export async function logout(locale: string = 'en') {
  const safeLocale = isLocaleSupported(locale) ? locale : DEFAULT_LOCALE;
  // Clear SessionManager if available
  try {
    const { SessionManager } = await import('./auth/session-manager');
    await SessionManager.clearAllSessions();
  } catch (_sessionError) {
    // SessionManager not available, continue with legacy cleanup
  }

  // Revoke and clear legacy cookies
  const cookies = await getCookies()
  const legacyAccess = cookies.get("access_token")?.value
  const legacyRefresh = cookies.get("refresh_token")?.value
  if (legacyAccess || legacyRefresh) {
    await revokeTokensOnSignOut([{ userId: "", accessToken: legacyAccess, refreshToken: legacyRefresh ?? "" }])
  }
  cookies.delete("access_token")
  cookies.delete("refresh_token")

  // Single sign-out: end the shared sign-in on the auth server too (it also
  // signs out of profile and admin), then come back here
  const headers = await getHeaders()
  const host = headers.get("host")
  const protocol = isLocalHostHeader(host) ? "http" : "https"
  redirect(startSingleSignOut(process.env.Issuer!, `${protocol}://${host}/${safeLocale}`))
}