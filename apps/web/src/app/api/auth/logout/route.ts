import { type NextRequest, NextResponse } from "next/server"
import { SIGN_IN_COOKIES, singleSignOutNext } from "@/lib/auth/single-sign-out"

/**
 * Front-channel logout: the auth server sends the browser here while it signs
 * the user out of every app. Clears this app's sign-in and goes on with the
 * chain (or starts it, when opened directly).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const response = NextResponse.redirect(
    singleSignOutNext(process.env.Issuer!, url.searchParams.get("next"), url.origin),
    302,
  )
  for (const name of SIGN_IN_COOKIES) response.cookies.delete(name)
  response.headers.set("Cache-Control", "no-store")
  return response
}
