"use server"
import { createClient, Client } from "@openauthjs/openauth/client"
import { redirect } from "next/navigation"
import { headers as getHeaders, cookies as getCookies } from "next/headers"
import { subjects, setTokens } from "./auth"
import { AuthSubject } from "@/interfaces"

export async function getClient() {
  const client = createClient({
    clientID: process.env.ClientId,
    issuer: process.env.Issuer, 
  });
  return client;
}

export async function authenticated(): Promise<AuthSubject | false> {
  try {
    const cookies = await getCookies()
    console.log("All cookies:", cookies.getAll())
    
    const accessToken = cookies.get("access_token")
    const refreshToken = cookies.get("refresh_token")
    console.log("accessToken", accessToken)
    console.log("refreshToken", refreshToken)

    if (!accessToken?.value) {
      console.log("No access token found")
      return false
    }
    
    console.log("process.env.ClientId", process.env.ClientId)
    console.log("process.env.Issuer", process.env.Issuer)
    const client = await getClient();
    const verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value, });
    console.log("verified", verified)

    if (verified.err) {
      console.log("verified.err", verified.err)
      return false
    }
    else if (!verified.err && 'tokens' in verified) {
      console.log("tokens", verified.tokens)
      await setTokens(verified.tokens.access, verified.tokens.refresh)
    }

    if (!verified.err && 'subject' in verified) {
      console.log("verified.subject", verified.subject)
      return verified.subject;
    }
    console.log("false", false)
    return false;
  } catch (error) {
    console.error("Error in authenticated function:", error)
    return false;
  }
}

export async function login() {
  const cookies = await getCookies()
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")
  const client = await getClient();

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