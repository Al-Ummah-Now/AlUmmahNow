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
    console.log("accessToken exists:", !!accessToken)
    console.log("refreshToken exists:", !!refreshToken)

    if (!accessToken?.value) {
      console.log("No access token found")
      return false
    }
    
    // Check if token looks like a JWT
    const tokenParts = accessToken.value.split('.');
    console.log("Token format analysis:", {
      isJWT: tokenParts.length === 3,
      parts: tokenParts.length,
      firstPartLength: tokenParts[0]?.length,
      tokenStart: accessToken.value.substring(0, 30) + "..."
    });
    
    console.log("Environment check:", {
      hasClientId: !!process.env.ClientId,
      hasIssuer: !!process.env.Issuer,
      clientIdStart: process.env.ClientId?.substring(0, 10) + "...",
      issuer: process.env.Issuer
    });
    
    const client = await getClient();
    
    console.log("About to verify token with:", {
      hasSubjects: !!subjects,
      tokenLength: accessToken.value.length,
      hasRefreshToken: !!refreshToken?.value,
      refreshTokenLength: refreshToken?.value?.length
    });
    
    let verified;
    try {
      verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value, });
      console.log("verified", verified)
    } catch (verifyError) {
      console.error("Error during token verification:", verifyError);
      console.error("Token that failed:", accessToken.value.substring(0, 20) + "...");
      return false;
    }

    if (verified.err) {
      console.log("Token verification failed:", verified.err)
      
      // If we have a refresh token, the verification might have automatically refreshed
      // In that case, we should have new tokens in the verified response
      if (refreshToken?.value && 'tokens' in verified) {
        console.log("Tokens were refreshed during verification")
        await setTokens(verified.tokens.access, verified.tokens.refresh)
        // Continue with the verification result
      } else {
        console.log("No refresh possible, authentication failed")
        return false
      }
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