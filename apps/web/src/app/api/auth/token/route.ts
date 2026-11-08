import { NextResponse, type NextRequest } from "next/server";
import { SessionManager } from "@/lib/auth/session-manager";

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

  const session = await SessionManager.getActiveSession();
  if (!session?.accessToken) {
    return NextResponse.json({ accessToken: null, channelId: null }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    { accessToken: session.accessToken, channelId: session.channelId ?? null, userId: session.userId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
