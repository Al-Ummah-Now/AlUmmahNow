import { cookies as getCookies } from "next/headers"
export { subjects } from "@/interfaces/subjects"

export async function setTokens(access: string, refresh: string) {
  const cookies = await getCookies()

  cookies.set({
    name: "access_token",
    value: access,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 34560000,
  })
  cookies.set({
    name: "refresh_token",
    value: refresh,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 34560000,
  })
}