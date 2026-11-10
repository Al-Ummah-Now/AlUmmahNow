import { setTokens } from "@/lib/auth"
import { type NextRequest, NextResponse } from "next/server"
import { getClient } from "@/lib/actions";
import { getProfileCreationPath } from "@/lib/profile-helpers";
import { User } from "@/interfaces";
import { logger } from '@/lib/logger-server';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { cookies as getCookies } from "next/headers";
import {
  RETURN_COOKIE,
  SILENT_COOKIE,
  callbackErrorDestination,
  sameOriginUrl,
  successDestination,
} from '@/lib/auth/silent-sign-in';
import { CLEAR_STATE_COOKIE, STATE_COOKIE, stateMatches } from '@/lib/auth/oauth-state';

/** The login route's one-shot cookies are spent once the callback ran. */
async function clearSignInCookies(): Promise<void> {
  try {
    const store = await getCookies();
    store.delete(RETURN_COOKIE);
    store.delete(SILENT_COOKIE);
    store.delete(CLEAR_STATE_COOKIE);
  } catch {
    // Outside a request context (tests): nothing to clear
  }
}


// Discriminated union type for clearer type safety
type ValidationResult =
  | { success: true; user?: User }
  | { success: false; error: Error };

async function validate(code: string | null, url: URL): Promise<ValidationResult> {
  logger.debug("[code]", code)
  logger.debug("[url]", url)

  const client = await getClient();

  // Must be the exact redirect_uri sent to authorize (#209). login() now sends
  // the bare callback and keeps the locale in the auth_locale cookie, but an
  // authorize started by an older build carries ?locale= in redirect_uri; the
  // issuer rejects the code when they differ.
  const locale = url.searchParams.get("locale");
  const redirectUri = `${url.origin}/api/callback${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`;
  const exchanged = await client.exchange(code!, redirectUri);
  logger.debug("[exchanged]", exchanged)
  if (exchanged.err == false) {
    // Extract user info from the access token
    // NOTE: This is a simple JWT payload extraction without signature validation.
    // The token has already been validated by the OpenAuth client.exchange() call above.
    // For production use, consider using a JWT library (e.g., jose, jsonwebtoken) that
    // validates the token signature before extracting the payload for enhanced security.
    let user: User | undefined;
    try {
      const payload = JSON.parse(atob(exchanged.tokens.access.split('.')[1]));
      if (payload.type === "user" && payload.properties) {
        user = payload.properties as User;
      }
    } catch (error) {
      logger.error("Error extracting user from token", error);
    }

    // Try to save to SessionManager (new multi-account system)
    try {
      const { SessionManager } = await import("@/lib/auth/session-manager");

      if (user) {
        // OpenAuth JWT only includes id and email (see subjects.ts)
        // displayName, createdAt, updatedAt come from the API profile, not the JWT
        await SessionManager.addAccount(
          {
            accessToken: exchanged.tokens.access,
            refreshToken: exchanged.tokens.refresh,
            expiresIn: exchanged.tokens.expiresIn,
          },
          {
            id: user.id,
            email: user.email,
            displayName: user.email, // Use email as fallback, profile API will provide actual displayName
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        );
        logger.debug("[OAuth Callback] Saved to SessionManager:", user.id);
      }
    } catch (_sessionError) {
      logger.debug("[OAuth Callback] SessionManager not available, using legacy cookies");
      // Fall back to legacy cookie storage
      await setTokens(exchanged.tokens.access, exchanged.tokens.refresh);
    }

    return {
      success: true,
      user
    };
  }
  return { success: false, error: exchanged.err };
}

export async function GET(req: NextRequest) {

  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  // Get locale from query param, validate it, fallback to default
  const localeParam = url.searchParams.get("locale") ?? req.cookies.get("auth_locale")?.value ?? null;
  const locale = localeParam && isLocaleSupported(localeParam) ? localeParam : DEFAULT_LOCALE;

  // Set by /api/auth/login: where to go back to, and whether this was a
  // silent attempt (prompt=none from the client probe or an account switch)
  const returnPath = req.cookies.get(RETURN_COOKIE)?.value ?? null;
  const silent = req.cookies.get(SILENT_COOKIE)?.value === "1";

  // Only a sign-in this browser started (state = its state cookie) may
  // continue: otherwise no code exchange and no session change (login CSRF)
  if (!stateMatches(url.searchParams.get("state"), req.cookies.get(STATE_COOKIE)?.value)) {
    logger.warn("[OAuth Callback] Refused: state does not match this browser", {
      hasState: url.searchParams.has("state"),
      silent,
    });
    await clearSignInCookies();
    return NextResponse.redirect(sameOriginUrl(callbackErrorDestination({ error: "state_mismatch", silent, returnPath, locale }), url.origin));
  }

  // The auth server reports failures (cancelled sign-in, failed password
  // reset, ...) as ?error=...; with no code there is nothing to exchange.
  // A failed silent attempt (error=login_required) is not an error for the
  // visitor: back to the page, anonymous, no error page.
  const authError = url.searchParams.get("error");
  if (authError || !code) {
    logger.warn("[OAuth Callback] Sign-in returned without a code", {
      error: authError,
      silent,
      description: url.searchParams.get("error_description"),
    });
    await clearSignInCookies();
    return NextResponse.redirect(sameOriginUrl(callbackErrorDestination({ error: authError, silent, returnPath, locale }), url.origin));
  }

  const result = await validate(code, url);
  logger.debug("[result]", result)
  await clearSignInCookies();

  if (result.success) {
    // Check if user needs to create profile
    if (result.user) {
      const { checkProfileExists } = await import('@/lib/api/profiles-client');
      try {
        const profileExists = await checkProfileExists(result.user);
        if (!profileExists) {
          const profilePath = getProfileCreationPath(locale as 'en' | 'ar');
          logger.debug("Redirecting new user to profile creation", profilePath);
          return NextResponse.redirect(`${url.origin}${profilePath}?session_updated=true`);
        }
      } catch (error) {
        logger.error('Error checking profile status:', error);
      }
    }

    // Back to the page the sign-in started from (or the locale's home), with
    // session_updated so the header reloads the session
    return NextResponse.redirect(sameOriginUrl(successDestination(returnPath, locale), url.origin));
  }
  // Error objects serialize to {}, so never answer with the raw error
  logger.error("[OAuth Callback] Code exchange failed", {
    error: result.error instanceof Error ? result.error.message : String(result.error),
  });
  if (silent) {
    // A silent attempt never shows an error page: back to the page, anonymous
    return NextResponse.redirect(sameOriginUrl(callbackErrorDestination({ error: null, silent, returnPath, locale }), url.origin));
  }
  return NextResponse.redirect(`${url.origin}/${locale}/auth/error`);

}