import { InvalidAccessTokenError } from "@al-ummah-now/openauth/error";
import { type NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/actions";
import { User } from "@/interfaces";
import { SessionManager } from "@/lib/auth/session-manager";
import { logger } from '@/lib/logger-server';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { cookies as getCookies } from "next/headers";
import { CLEAR_PKCE_COOKIE, CLEAR_STATE_COOKIE, PKCE_COOKIE, STATE_COOKIE, pkceVerifierFor, stateMatches } from '@/lib/auth/oauth-state';

/** The state cookie is one-shot: spent once the callback ran. */
async function clearStateCookie(): Promise<void> {
  try {
    const store = await getCookies();
    store.delete(CLEAR_STATE_COOKIE);
    store.delete(CLEAR_PKCE_COOKIE);
  } catch {
    // Outside a request context (tests): nothing to clear
  }
}


// Discriminated union type for clearer type safety
type ValidationResult =
  | { success: true; user?: User }
  | { success: false; error: Error };

async function validate(code: string, url: URL, verifier?: string): Promise<ValidationResult> {
  logger.debug("[Multi-Account Callback] code:", code);
  logger.debug("[Multi-Account Callback] url:", url.toString());

  const client = await getClient();

  // Use the multi-account callback URL
  const exchanged = await client.exchange(code, `${url.origin}/api/callback/multi-account`, verifier);
  logger.debug("[Multi-Account Callback] exchanged:", exchanged);

  if (exchanged.err == false) {
    // Extract user info from the access token
    let user: User | undefined;
    try {
      const payload = JSON.parse(atob(exchanged.tokens.access.split('.')[1]));
      if (payload.type === "user" && payload.properties) {
        user = payload.properties as User;
      }
    } catch (error) {
      logger.error("[Multi-Account Callback] Error extracting user from token:", error);
    }

    // Save to SessionManager (multi-account system)
    try {
      if (user) {
        logger.debug("[Multi-Account Callback] Adding account to session:", {
          
          email: user.email,
        });

        // OpenAuth JWT only includes id and email (see subjects.ts)
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
        logger.debug("[Multi-Account Callback] Successfully added account to session:", user.id);

        // Verify the session was actually saved
        const verifySession = await SessionManager.getActiveSession();
        if (verifySession) {
          logger.debug("[Multi-Account Callback] Session verified:", {
            
            email: verifySession.email,
            accountsCount: verifySession.availableAccounts.length,
          });
        } else {
          logger.error("[Multi-Account Callback] Session verification failed - no active session found!");
        }
      }
    } catch (sessionError) {
      logger.error("[Multi-Account Callback] Failed to add account:", sessionError);
      return {
        success: false,
        error: new InvalidAccessTokenError()
      };
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

  // Only an add-account this browser started (state = its state cookie) may
  // continue: otherwise no code exchange and no session change (login CSRF)
  const stateOk = stateMatches(url.searchParams.get("state"), req.cookies.get(STATE_COOKIE)?.value);
  await clearStateCookie();
  if (!stateOk) {
    logger.warn("[Multi-Account Callback] Refused: state does not match this browser", { hasState: url.searchParams.has("state") });
    return NextResponse.redirect(`${url.origin}/${locale}/auth/error`);
  }

  // The auth server reports failures (cancelled sign-in, access denied, ...)
  // as ?error=...; with no code there is nothing to exchange.
  const authError = url.searchParams.get("error");
  if (authError || !code) {
    logger.warn("[Multi-Account Callback] Returned without a code", {
      error: authError,
      description: url.searchParams.get("error_description"),
    });
    return NextResponse.redirect(`${url.origin}/${locale}/auth/error`);
  }

  const result = await validate(code, url, pkceVerifierFor(url.searchParams.get("state"), req.cookies.get(PKCE_COOKIE)?.value));

  logger.debug("[Multi-Account Callback] result:", result);

  if (result.success) {
    // For multi-account callback, redirect to profile page where user can see all their accounts
    // Note: Could use state parameter to track where "Add Account" was clicked for better UX
    logger.debug("[Multi-Account Callback] Redirecting to profile page");
    // Add query param to trigger session reload
    return NextResponse.redirect(`${url.origin}/${locale}/profile?session_updated=true`);
  }

  // Error objects serialize to {}, so never answer with the raw error
  logger.error("[Multi-Account Callback] Authentication failed", {
    error: result.error instanceof Error ? result.error.message : String(result.error),
  });
  return NextResponse.redirect(`${url.origin}/${locale}/auth/error`);
}
