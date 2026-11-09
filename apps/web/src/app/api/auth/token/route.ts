import { NextResponse, type NextRequest } from "next/server";
import { SessionManager } from "@/lib/auth/session-manager";
import { accessTokenExpiresAt } from "@/lib/auth/token-refresh";

/**
 * Same-origin endpoint that hands the active account's access token to
 * client-side code that must call other origins directly (api-videos for TUS
 * uploads / interactive actions, realtime websocket auth). The session cookie
 * itself stays httpOnly.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Only allow same-origin fetches (blocks cross-site reads via CSRF-ish tricks)
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // The middleware does not run for /api routes: refresh here, so the
  // browser (TUS uploads, direct API calls) never gets a token about to expire
  const session = await SessionManager.ensureFreshActiveSession();
  // Signed out is an answer, not an error: a 401 here logs a console error on
  // every anonymous page that asks (watch progress, uploads)
  if (!session?.accessToken) {
    return NextResponse.json({ accessToken: null, channelId: null }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    {
      accessToken: session.accessToken,
      channelId: session.channelId ?? null,
      userId: session.userId,
      expiresAt: session.expiresAt ?? accessTokenExpiresAt(session.accessToken),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
