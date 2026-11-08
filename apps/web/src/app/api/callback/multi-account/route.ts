import { InvalidAccessTokenError } from "@al-ummah-now/openauth/error";
import { type NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/actions";
import { User } from "@/interfaces";
import { SessionManager } from "@/lib/auth/session-manager";
import { logger } from '@/lib/logger-server';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { exchangeRedirectUri } from '@/lib/auth/redirect-uri';


// Discriminated union type for clearer type safety
type ValidationResult =
  | { success: true; user?: User }
  | { success: false; error: InvalidAccessTokenError };

async function validate(code: string | null, url: URL): Promise<ValidationResult> {
  logger.info("[Multi-Account Callback] code:", code);
  logger.info("[Multi-Account Callback] url:", url.toString());

  const client = await getClient();

  // Must be the exact redirect_uri sent to authorize (addUserAccount adds ?locale=)
  const exchanged = await client.exchange(code!, exchangeRedirectUri(url));
  logger.info("[Multi-Account Callback] exchanged:", exchanged);

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
        logger.info("[Multi-Account Callback] Adding account to session:", {
          
          email: user.email,
        });

        // OpenAuth JWT only includes id and email (see subjects.ts)
        await SessionManager.addAccount(
          {
            accessToken: exchanged.tokens.access,
            refreshToken: exchanged.tokens.refresh,
          },
          {
            id: user.id,
            email: user.email,
            displayName: user.email, // Use email as fallback, profile API will provide actual displayName
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        );
        logger.info("[Multi-Account Callback] Successfully added account to session:", user.id);

        // Verify the session was actually saved
        const verifySession = await SessionManager.getActiveSession();
        if (verifySession) {
          logger.info("[Multi-Account Callback] Session verified:", {
            
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
  const localeParam = url.searchParams.get("locale");
  const locale = localeParam && isLocaleSupported(localeParam) ? localeParam : DEFAULT_LOCALE;

  // Cancelled or failed at the auth server: nothing to exchange
  const authError = url.searchParams.get("error");
  if (authError || !code) {
    logger.warn("[Multi-Account Callback] Returned without a code", {
      error: authError,
      description: url.searchParams.get("error_description"),
    });
    return NextResponse.redirect(`${url.origin}/${locale}/auth/error`);
  }

  const result = await validate(code, url);

  logger.info("[Multi-Account Callback] result:", { success: result.success });

  if (result.success) {
    // For multi-account callback, redirect to profile page where user can see all their accounts
    // Note: Could use state parameter to track where "Add Account" was clicked for better UX
    logger.info("[Multi-Account Callback] Redirecting to profile page");
    // Add query param to trigger session reload
    return NextResponse.redirect(`${url.origin}/${locale}/profile?session_updated=true`);
  }

  // Error objects serialize to {}, so never answer with the raw error
  logger.error("[Multi-Account Callback] Authentication failed", {
    error: result.error instanceof Error ? result.error.message : String(result.error),
  });
  return NextResponse.redirect(`${url.origin}/${locale}/auth/error`);
}
