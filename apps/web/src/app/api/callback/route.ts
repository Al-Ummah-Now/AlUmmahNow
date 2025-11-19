import { InvalidAccessTokenError } from "@openauthjs/openauth/error";
import { setTokens } from "@/lib/auth"
import { type NextRequest, NextResponse } from "next/server"
import { getClient } from "@/lib/actions";
import { shouldRedirectToProfileCreation } from "@/lib/profile-helpers";
import { User } from "@/interfaces";
import { logger } from "@/lib/logger";

// Discriminated union type for clearer type safety
type ValidationResult =
  | { success: true; user?: User }
  | { success: false; error: InvalidAccessTokenError };

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
  const result = await validate(code, url);
  logger.debug("[result]", result)

  if (result.success) {
    // Check if user needs to create profile
    if (result.user) {
      const profileCheck = await shouldRedirectToProfileCreation(result.user);
      if (profileCheck.shouldRedirect && profileCheck.redirectPath) {
        logger.info("Redirecting new user to profile creation", profileCheck.redirectPath);
        // Add query param to trigger session reload
        return NextResponse.redirect(`${url.origin}${profileCheck.redirectPath}?session_updated=true`);
      }
    }

    // Redirect to English locale (default) with session_updated param
    // The app requires a locale (/en or /ar) to properly function
    logger.debug("[redirect]", `${url.origin}/en`)
    return NextResponse.redirect(`${url.origin}/en?session_updated=true`);
  }
  return NextResponse.json(result.error, { status: 400 });

}