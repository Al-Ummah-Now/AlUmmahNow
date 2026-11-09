"use server"
import { getOpenAuthClient } from "./auth/openauth-client"
import { withAuthorizeLocale } from "./auth/authorize-locale"
import { redirect } from "next/navigation"
import { headers as getHeaders, cookies as getCookies } from "next/headers"
import { subjects, setTokens } from "./auth"
import { AuthSubject } from "@/interfaces"
import { startSingleSignOut } from "./auth/single-sign-out"
import { sessionRoles } from "./auth/session-roles"
import { newStateNonce, pkceCookieValue, stateCookieOptions, withState, PKCE_COOKIE, STATE_COOKIE } from "./auth/oauth-state"
import { RETURN_COOKIE, returnPathFromReferer } from "./auth/silent-sign-in"
import { safeStudioReturn } from "@/lib/studio/resolve"

export async function getClient() {
  return getOpenAuthClient();
}

export async function authenticated(): Promise<AuthSubject | false> {
  try {
    // Try SessionManager first (new multi-account system)
    try {
      const { SessionManager } = await import('./auth/session-manager');
      const session = await SessionManager.getActiveSession();

      if (session) {
        // Return AuthSubject from SessionManager
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
    } catch (_sessionError) {
      // SessionManager not available, fall through to legacy
    }

    // Fall back to legacy cookies
    const cookies = await getCookies()
    const accessToken = cookies.get("access_token")
    const refreshToken = cookies.get("refresh_token")

    if (!accessToken?.value) {
      return false
    }

    const client = await getClient();

    let verified;
    try {
      verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value });
    } catch (_verifyError) {
      return false;
    }

    // Check if verification has an actual error (not just empty object)
    const hasError = verified.err && Object.keys(verified.err).length > 0;

    if (hasError) {
      return false;
    }

    if ('tokens' in verified) {
      await setTokens(verified.tokens!.access, verified.tokens!.refresh);
    }

    if ('subject' in verified) {
      return verified.subject;
    }

    // If no subject but verification succeeded, try manual extraction
    try {
      const payload = JSON.parse(atob(accessToken.value.split('.')[1]));
      if (payload.type === "user" && payload.properties) {
        return {
          type: "user",
          properties: payload.properties
        } as AuthSubject;
      }
    } catch (_manualError) {
      // Silent fallback failure
    }

    return false;
  } catch (_error) {
    return false;
  }
}

export async function login(locale: string = 'en', returnTo?: unknown) {
  // Back to the page the sign-in started from (the action posts to that page),
  // or the locale's home when there is none
  const requestHeaders = await getHeaders()
  const host = requestHeaders.get("host")
  const protocol = host?.includes("localhost") ? "http" : "https"
  // A Studio sign-in names its page (only ever a Studio path); others use the referer
  const returnPath = safeStudioReturn(returnTo) ?? (host ? returnPathFromReferer(requestHeaders.get("referer"), `${protocol}://${host}`) : null)
  const home = returnPath ?? `/${locale}`

  // Check if already logged in via SessionManager
  try {
    const { SessionManager } = await import('./auth/session-manager');
    const session = await SessionManager.getActiveSession();

    if (session) {
      redirect(home);
    }
  } catch (_sessionError) {
    // SessionManager not available, continue with legacy check
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

      const hasError = verified.err && Object.keys(verified.err).length > 0;

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