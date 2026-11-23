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

  const client = await getClient();

  let verified;
  try {
    verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value });
  } catch (verifyError) {
    if (isNextControlFlowError(verifyError)) throw verifyError;
    // A forged/tampered legacy JWT can throw during signature verification: log
    // and report, then refuse the token rather than returning any identity.
    logger.warn('[authenticated] Legacy token verification threw', safeErrorMeta(verifyError));
    await reportWebServerError(verifyError, { route: 'auth:authenticated', extra: { stage: 'legacy_verify' } });
    return false;
  }

  // Any error is a failed verification. (openauth's errors are Error subclasses with no
  // enumerable keys, so the old `Object.keys(err).length > 0` test never saw one.)
  if (verificationFailed(verified)) {
    return false;
  }

  if ('tokens' in verified) {
    try {
      await setTokens(verified.tokens!.access, verified.tokens!.refresh);
    } catch (setTokenError) {
      // Server Component renders have read-only cookies; log a warning without failing a valid verification
      if (isNextControlFlowError(setTokenError)) throw setTokenError;
      logger.warn('[authenticated] Could not persist rotated legacy tokens', safeErrorMeta(setTokenError));
    }
  }

  // Only the verified subject: never the token's payload read without its signature
  if ('subject' in verified && verified.subject) {
    return verified.subject;
  }

  return false;
}

export async function login(locale: string = 'en', returnTo?: unknown) {
  // Back to the page the sign-in started from (the action posts to that page),
  // or the locale's home when there is none
  const requestHeaders = await getHeaders()
  const host = requestHeaders.get("host")
  const protocol = host?.includes("localhost") ? "http" : "https"
  // A Studio page, the locale's home or /upgrade, when the button names it (lib/auth/sign-in-return.ts); others use the referer
  const returnPath = safeSignInReturn(returnTo, locale) ?? (host ? returnPathFromReferer(requestHeaders.get("referer"), `${protocol}://${host}`) : null)
  const home = returnPath ?? `/${locale}`

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
  cookieStore.set("auth_locale", locale, { httpOnly: true, sameSite: "lax", secure: protocol === "https", path: "/", maxAge: 600 })
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
  redirect(withAuthorizeLocale(withState(url, nonce), locale))
}

export async function logout(locale: string = 'en') {
  // Clear SessionManager if available
  try {
    const { SessionManager } = await import('./auth/session-manager');
    await SessionManager.clearAllSessions();
  } catch (_sessionError) {
    // SessionManager not available, continue with legacy cleanup
  }

  // Clear legacy cookies
  const cookies = await getCookies()
  cookies.delete("access_token")
  cookies.delete("refresh_token")

  // Single sign-out: end the shared sign-in on the auth server too (it also
  // signs out of profile and admin), then come back here
  const headers = await getHeaders()
  const host = headers.get("host")
  const protocol = host?.includes("localhost") ? "http" : "https"
  redirect(startSingleSignOut(process.env.Issuer!, `${protocol}://${host}/${locale}`))
}