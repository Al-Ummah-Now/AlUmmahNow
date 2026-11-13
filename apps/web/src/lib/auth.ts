import { cookies as getCookies, headers as getHeaders } from "next/headers"
import { isLocalHost } from "@/lib/auth/session-cookie"
import { logger } from '@/lib/logger-server';

export { subjects } from "@/interfaces/subjects"

export async function setTokens(access: string, refresh: string) {
  try {
    const cookies = await getCookies()
    // Secure in production except on a local host: WebKit drops Secure cookies over http://localhost (#1020)
    const host = await getHeaders().then((h) => h.get("host"), () => null)
    const secure = process.env.NODE_ENV === "production" && !isLocalHost(host)
    logger.debug("Setting tokens - access token length:", access?.length)
    logger.debug("Setting tokens - refresh token length:", refresh?.length)

    cookies.set({
      name: "access_token",
      value: access,
      httpOnly: true,
      sameSite: "lax", // Changed from "strict" to "lax" for better compatibility
      path: "/",
      maxAge: 34560000,
      secure,
    })
    cookies.set({
      name: "refresh_token",
      value: refresh,
      httpOnly: true,
      sameSite: "lax", // Changed from "strict" to "lax" for better compatibility
      path: "/",
      maxAge: 34560000,
      secure,
    })
    
    logger.debug("Tokens set successfully")
  } catch (error) {
    logger.error("Error setting tokens:", error)
  }
}