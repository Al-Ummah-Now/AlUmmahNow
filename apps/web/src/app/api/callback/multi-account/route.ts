import { InvalidAccessTokenError } from "@openauthjs/openauth/error";
import { type NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/actions";
import { User } from "@/interfaces";
import { SessionManager } from "@/lib/auth/session-manager";

// Discriminated union type for clearer type safety
type ValidationResult =
  | { success: true; user?: User }
  | { success: false; error: InvalidAccessTokenError };

async function validate(code: string | null, url: URL): Promise<ValidationResult> {
  console.log("[Multi-Account Callback] code:", code);
  console.log("[Multi-Account Callback] url:", url.toString());

  const client = await getClient();

  // Use the multi-account callback URL
  const exchanged = await client.exchange(code!, `${url.origin}/api/callback/multi-account`);
  console.log("[Multi-Account Callback] exchanged:", exchanged);

  if (exchanged.err == false) {
    // Extract user info from the access token
    let user: User | undefined;
    try {
      const payload = JSON.parse(atob(exchanged.tokens.access.split('.')[1]));
      if (payload.type === "user" && payload.properties) {
        user = payload.properties as User;
      }
    } catch (error) {
      console.error("[Multi-Account Callback] Error extracting user from token:", error);
    }

    // Save to SessionManager (multi-account system)
    try {
      if (user) {
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
        console.log("[Multi-Account Callback] Added account to session:", user.id);
      }
    } catch (sessionError) {
      console.error("[Multi-Account Callback] Failed to add account:", sessionError);
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
  const result = await validate(code, url);

  console.log("[Multi-Account Callback] result:", result);

  if (result.success) {
    // For multi-account callback, redirect to profile page where user can see all their accounts
    // Note: Could use state parameter to track where "Add Account" was clicked for better UX
    console.log("[Multi-Account Callback] Redirecting to profile page");
    return NextResponse.redirect(`${url.origin}/en/profile`);
  }

  console.error("[Multi-Account Callback] Authentication failed:", result.error);
  return NextResponse.json(result.error, { status: 400 });
}
