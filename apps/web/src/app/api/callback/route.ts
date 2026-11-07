import { setTokens } from "@/lib/auth"
import { type NextRequest, NextResponse } from "next/server"
import { getClient } from "@/lib/actions";
import { getProfileCreationPath } from "@/lib/profile-helpers";
import { User } from "@/interfaces";
import { logger } from '@/lib/logger-server';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';


// Discriminated union type for clearer type safety
type ValidationResult =
  | { success: true; user?: User }
  | { success: false; error: Error };

async function validate(code: string | null, url: URL): Promise<ValidationResult> {
  logger.debug("[code]", code)
  logger.debug("[url]", url)

  const client = await getClient();

  const exchanged = await client.exchange(code!, `${url.origin}/api/callback`);
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
          },
          {
            id: user.id,
            email: user.email,
            displayName: user.email, // Use email as fallback, profile API will provide actual displayName
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        );
        logger.info("[OAuth Callback] Saved to SessionManager:", user.id);
      }
    } catch (_sessionError) {
      logger.info("[OAuth Callback] SessionManager not available, using legacy cookies");
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

  // The auth server reports failures (cancelled sign-in, failed password
  // reset, ...) as ?error=...; with no code there is nothing to exchange.
  const authError = url.searchParams.get("error");
  if (authError || !code) {
    logger.warn("[OAuth Callback] Sign-in returned without a code", {
      error: authError,
      description: url.searchParams.get("error_description"),
    });
    return NextResponse.redirect(`${url.origin}/${locale}/auth/error`);
  }

  const result = await validate(code, url);
  logger.debug("[result]", result)

  if (result.success) {
    // Check if user needs to create profile
    if (result.user) {
      const { checkProfileExists } = await import('@/lib/api/profiles-client');
      try {
        const profileExists = await checkProfileExists(result.user);
        if (!profileExists) {
          const profilePath = getProfileCreationPath(locale as 'en' | 'ar');
          logger.info("Redirecting new user to profile creation", profilePath);
          return NextResponse.redirect(`${url.origin}${profilePath}?session_updated=true`);
        }
      } catch (error) {
        logger.error('Error checking profile status:', error);
      }
    }

    // Redirect to user's locale with session_updated param
    logger.debug("[redirect]", `${url.origin}/${locale}`)
    return NextResponse.redirect(`${url.origin}/${locale}?session_updated=true`);
  }
  // Error objects serialize to {}, so never answer with the raw error
  logger.error("[OAuth Callback] Code exchange failed", {
    error: result.error instanceof Error ? result.error.message : String(result.error),
  });
  return NextResponse.redirect(`${url.origin}/${locale}/auth/error`);

}