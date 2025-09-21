import { cookies as getCookies } from "next/headers"
export { subjects } from "@/interfaces/subjects"

export async function setTokens(access: string, refresh: string) {
  try {
    const cookies = await getCookies()
    console.log("Setting tokens - access token length:", access?.length)
    console.log("Setting tokens - refresh token length:", refresh?.length)

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
    
    console.log("Tokens set successfully")
  } catch (error) {
    console.error("Error setting tokens:", error)
  }
}