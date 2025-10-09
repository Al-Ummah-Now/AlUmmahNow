"use server"
import { createClient } from "@openauthjs/openauth/client"
import { redirect } from "next/navigation"
import { headers as getHeaders, cookies as getCookies } from "next/headers"
import { subjects, setTokens } from "./auth"
import { AuthSubject } from "@/interfaces"

export async function getClient() {
  const client = createClient({
    clientID: process.env.ClientId!,
    issuer: process.env.Issuer!,
  });

  return client;
}

export async function authenticated(): Promise<AuthSubject | false> {
  try {
    const cookies = await getCookies()
    const accessToken = cookies.get("access_token")
    const refreshToken = cookies.get("refresh_token")

    if (!accessToken?.value) {
      return false
    }
    
    const client = await getClient();
    
    let verified;
    try {
      verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value });
    } catch (verifyError) {
      return false;
    }

    // Check if verification has an actual error (not just empty object)
    const hasError = verified.err && Object.keys(verified.err).length > 0;
    
    if (hasError) {
      return false;
    }
    
    if ('tokens' in verified) {
      await setTokens(verified.tokens.access, verified.tokens.refresh);
    }

    if ('subject' in verified) {
      return verified.subject;
    }
    
    // If no subject but verification succeeded, try manual extraction
    try {
      const payload = JSON.parse(atob(accessToken.value.split('.')[1]));
      if (payload.type === "user" && payload.properties) {
        return {
          type: "user",
          properties: payload.properties
        } as AuthSubject;
      }
    } catch (manualError) {
      // Silent fallback failure
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

export async function login() {
  const cookies = await getCookies()
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")
  const client = await getClient();

  if (accessToken) {
    try {
      const verified = await client.verify(subjects, accessToken.value, {
        refresh: refreshToken?.value,
      });
      
      const hasError = verified.err && Object.keys(verified.err).length > 0;
      
      if (!hasError && 'tokens' in verified) {
        await setTokens(verified.tokens.access, verified.tokens.refresh);
        redirect("/");
      } else if (!hasError) {
        redirect("/");
      }
    } catch (loginVerifyError) {
      // Silent failure, proceed with new authorization
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