"use server"
import { createClient } from "@openauthjs/openauth/client"
import { redirect } from "next/navigation"
import { headers as getHeaders, cookies as getCookies } from "next/headers"
import { subjects, setTokens } from "./auth"
import { AuthSubject } from "@/interfaces"

export async function auth(): Promise<AuthSubject | false> {
  const cookies = await getCookies()
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")
  console.log("accessToken", accessToken)
  console.log("refreshToken", refreshToken)

  if (!accessToken) {
    return false
  }
  console.log("process.env.ClientId", process.env.ClientId)
  console.log("process.env.Issuer", process.env.Issuer)
  const client = createClient({
    clientID: process.env.ClientId,
    issuer: process.env.Issuer, // url to the OpenAuth server
  });
  const verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value, });
  console.log("verified", verified)

  if (verified.err) {
    return false
  }
  else if (!verified.err && 'tokens' in verified) {
    await setTokens(verified.tokens.access, verified.tokens.refresh)
  }

  if (!verified.err && 'subject' in verified) {
    return verified.subject;
  }
  return false;
}

export async function login() {
  const cookies = await getCookies()
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")
  const client = createClient({
    clientID: process.env.ClientId,
    issuer: process.env.Issuer, // url to the OpenAuth server
  });

  if (accessToken) {
    const verified = await client.verify(subjects, accessToken.value, {
      refresh: refreshToken?.value,
    })
    if (!verified.err && 'tokens' in verified) {
      await setTokens(verified.tokens.access, verified.tokens.refresh)
      redirect("/")
    }
  }

  const headers = await getHeaders()
  const host = headers.get("host")
  const protocol = host?.includes("localhost") ? "http" : "https"
  const { url } = await client.authorize(
    `${protocol}://${host}/api/callback`,
    "code",
  )
  redirect(url)
}

export async function logout() {
  const cookies = await getCookies()
  cookies.delete("access_token")
  cookies.delete("refresh_token")

  redirect("/")
}