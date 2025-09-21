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
    const accessToken = cookies.get("access_token")
    const refreshToken = cookies.get("refresh_token")

    console.log("Auth check - has access token:", !!accessToken?.value);

    if (!accessToken?.value) {
      console.log("No access token found");
      return false
    }
    
    const client = await getClient();
    
    console.log("Subjects schema:", JSON.stringify(subjects, null, 2));
    
    // Debug the token payload
    try {
      const payload = JSON.parse(atob(accessToken.value.split('.')[1]));
      console.log("Token payload:", JSON.stringify(payload, null, 2));
    } catch (e) {
      console.log("Could not decode token payload");
    }
    
    let verified;
    try {
      verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value });
      console.log("Verification response:", JSON.stringify(verified, null, 2));
      console.log("Verification response keys:", Object.keys(verified));
    } catch (verifyError) {
      console.log("Token verification failed:", verifyError.message);
      return false;
    }

    // Check if verification has an actual error (not just empty object)
    const hasError = verified.err && Object.keys(verified.err).length > 0;
    
    if (hasError) {
      console.log("Token verification failed:", verified.err);
      return false;
    }
    
    console.log("Token verification successful");
    
    if ('tokens' in verified) {
      await setTokens(verified.tokens.access, verified.tokens.refresh);
    }

    if ('subject' in verified) {
      console.log("Found subject in verified response:", JSON.stringify(verified.subject, null, 2));
      return verified.subject;
    }
    
    // If no subject but verification succeeded, try manual extraction
    console.log("No subject found, attempting manual extraction");
    try {
      const payload = JSON.parse(atob(accessToken.value.split('.')[1]));
      if (payload.type === "user" && payload.properties) {
        console.log("Manual extraction successful:", JSON.stringify(payload.properties, null, 2));
        return {
          type: "user",
          properties: payload.properties
        } as AuthSubject;
      }
    } catch (manualError) {
      console.log("Manual extraction failed:", manualError.message);
    }
    
    console.log("No subject found in verified response");
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
      console.log("Login verification failed:", loginVerifyError.message);
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