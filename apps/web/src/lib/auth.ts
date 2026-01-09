import { cookies as getCookies } from "next/headers"
import { logger } from '@/lib/logger-server';

export { subjects } from "@/interfaces/subjects"

export async function setTokens(access: string, refresh: string) {
  try {
    const cookies = await getCookies()
    logger.info("Setting tokens - access token length:", access?.length)
    logger.info("Setting tokens - refresh token length:", refresh?.length)

    cookies.set({
      name: "access_token",
      value: access,
      httpOnly: true,
      sameSite: "lax", // Changed from "strict" to "lax" for better compatibility
      path: "/",
      maxAge: 34560000,
      secure: process.env.NODE_ENV === "production", // Only secure in production
    })
    cookies.set({
      name: "refresh_token",
      value: refresh,
      httpOnly: true,
      sameSite: "lax", // Changed from "strict" to "lax" for better compatibility
      path: "/",
      maxAge: 34560000,
      secure: process.env.NODE_ENV === "production", // Only secure in production
    })
    
    logger.info("Tokens set successfully")
  } catch (error) {
    logger.error("Error setting tokens:", error)
  }
}