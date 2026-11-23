import { type NextRequest, NextResponse } from "next/server"
import { SIGN_IN_COOKIES, singleSignOutNext } from "@/lib/auth/single-sign-out"
import { presentSessionCookieNames, readSessionValue } from "@/lib/auth/session-cookie"
import { revokeTokensOnSignOut, type RevocableTokens } from "@/lib/auth/revoke-on-sign-out"
import { forgetRotations } from "@/lib/auth/token-refresh"

function storedAccounts(request: NextRequest): RevocableTokens[] {
  const out: RevocableTokens[] = [];
  try {
    const raw = readSessionValue(request.cookies)
    const accounts = raw ? (JSON.parse(raw) as { accounts?: Record<string, RevocableTokens> }).accounts : undefined
    if (accounts) out.push(...Object.values(accounts))
  } catch {
    // ignore malformed session cookie
  }
  const legacyAccess = request.cookies.get("access_token")?.value
  const legacyRefresh = request.cookies.get("refresh_token")?.value
  if (legacyAccess || legacyRefresh) {
    out.push({ userId: "", accessToken: legacyAccess, refreshToken: legacyRefresh ?? "" })
  }
  return out
}

/**
 * Front-channel logout: the auth server sends the browser here while it signs
 * the user out of every app. Clears this app's sign-in and goes on with the
 * chain (or starts it, when opened directly).
 */
export async function GET(request: NextRequest) {
  const accounts = storedAccounts(request)
  await revokeTokensOnSignOut(accounts)
  for (const account of accounts) if (account.userId) forgetRotations(account.userId)
  const url = new URL(request.url)
  const response = NextResponse.redirect(
    singleSignOutNext(process.env.Issuer!, url.searchParams, url.origin),
    302,
  )
  // Every account's session chunk (al_ummah_session.N), not only the first
  for (const name of new Set([...SIGN_IN_COOKIES, ...presentSessionCookieNames(request.cookies)])) response.cookies.delete(name)
  response.headers.set("Cache-Control", "no-store")
  return response
}
