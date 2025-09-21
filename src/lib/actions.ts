"use server"
import { createClient, Client } from "@openauthjs/openauth/client"
import { redirect } from "next/navigation"
import { headers as getHeaders, cookies as getCookies } from "next/headers"
import { subjects, setTokens } from "./auth"
import { AuthSubject } from "@/interfaces"

export async function getClient() {
  console.log("Creating client with:", {
    clientID: process.env.ClientId,
    issuer: process.env.Issuer
  });
  
  const client = createClient({
    clientID: process.env.ClientId,
    issuer: process.env.Issuer, 
  });
  
  console.log("Client created successfully");
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
      // Try to decode the JWT payload to see what's inside (for debugging)
      try {
        const payload = JSON.parse(atob(accessToken.value.split('.')[1]));
        console.log("Token payload:", {
          exp: payload.exp,
          iat: payload.iat,
          iss: payload.iss,
          aud: payload.aud,
          sub: payload.sub,
          currentTime: Math.floor(Date.now() / 1000),
          isExpired: payload.exp < Math.floor(Date.now() / 1000)
        });
        
        // Compare token claims with environment variables
        console.log("🔍 CLAIM COMPARISON:");
        console.log("Token issuer (iss):", payload.iss);
        console.log("Config issuer:", process.env.Issuer);
        console.log("Issuer match:", payload.iss === process.env.Issuer);
        
        console.log("Token audience (aud):", payload.aud);
        console.log("Config clientID:", process.env.ClientId);
        console.log("Audience match:", payload.aud === process.env.ClientId);
        
        // Check what's in the subjects configuration
        console.log("🔧 SUBJECTS ANALYSIS:");
        console.log("Subjects object:", subjects);
        console.log("Subjects keys:", Object.keys(subjects || {}));
        
        // Try to understand the subject format issue
        console.log("🎯 SUBJECT FORMAT ANALYSIS:");
        console.log("Token sub claim:", payload.sub);
        console.log("Sub claim type:", typeof payload.sub);
        console.log("Has 'user:' prefix:", payload.sub?.startsWith?.('user:'));
        
        // Check if there are other claims that might contain user data
        console.log("All token claims:", Object.keys(payload));
        console.log("Full payload (limited):", {
          ...payload,
          // Don't log sensitive data, just structure
          iss: payload.iss,
          aud: payload.aud,
          sub: payload.sub,
          exp: payload.exp,
          iat: payload.iat
        });
        
      } catch (decodeError) {
        console.log("Could not decode token payload:", decodeError);
      }
      
      console.log("🚀 ATTEMPTING VERIFICATION...");
      verified = await client.verify(subjects, accessToken.value, { refresh: refreshToken?.value, });
      console.log("✅ VERIFICATION COMPLETED");
      console.log("verified", verified)
    } catch (verifyError) {
      console.error("Error during token verification:", verifyError);
      console.error("Error message:", verifyError.message);
      console.error("Error stack:", verifyError.stack);
      console.error("Token that failed:", accessToken.value.substring(0, 20) + "...");
      
      // Clear potentially corrupted tokens
      console.log("Clearing potentially corrupted tokens");
      const cookies = await getCookies();
      cookies.delete("access_token");
      cookies.delete("refresh_token");
      
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
    console.log("Login: Found existing access token, verifying...");
    try {
      const verified = await client.verify(subjects, accessToken.value, {
        refresh: refreshToken?.value,
      })
      console.log("Login: Verification result:", verified);
      
      if (!verified.err && 'tokens' in verified) {
        console.log("Login: Setting refreshed tokens");
        await setTokens(verified.tokens.access, verified.tokens.refresh)
        redirect("/")
      } else if (!verified.err) {
        console.log("Login: Token valid, redirecting");
        redirect("/")
      } else {
        console.log("Login: Token verification failed, proceeding with new auth");
      }
    } catch (loginVerifyError) {
      console.error("Login: Error during verification:", loginVerifyError);
      console.log("Login: Proceeding with new authorization");
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