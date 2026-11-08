"use server"
import { createClient } from "@al-ummah-now/openauth/client"
import { redirect } from "next/navigation"
import { headers as getHeaders, cookies as getCookies } from "next/headers"
import { subjects, setTokens } from "./auth"
import { AuthSubject } from "@/interfaces"
import { authorizeRedirectUri, originFromHost, CALLBACK_PATH } from "./auth/redirect-uri"

export async function getClient() {
  const client = createClient({
    clientID: process.env.ClientId!,
    issuer: process.env.Issuer!,
  });

  return client;
}

export async function authenticated(): Promise<AuthSubject | false> {
  try {
    // Try SessionManager first (new multi-account system)
    try {
      const { SessionManager } = await import('./auth/session-manager');
      const session = await SessionManager.getActiveSession();

      if (session) {
        // Return AuthSubject from SessionManager
        return {
          type: "user",
          properties: {
            id: session.userId,
            email: session.email,
            displayName: session.displayName,
          }
        } as AuthSubject;
      }
    } catch (_sessionError) {
      // SessionManager not available, fall through to legacy
    }

    // Fall back to legacy cookies
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
    } catch (_verifyError) {
      return false;
    }

    // Check if verification has an actual error (not just empty object)
    const hasError = verified.err && Object.keys(verified.err).length > 0;

    if (hasError) {
      return false;
    }

    if ('tokens' in verified) {
      await setTokens(verified.tokens!.access, verified.tokens!.refresh);
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
    } catch (_manualError) {
      // Silent fallback failure
    }

    return false;
  } catch (_error) {
    return false;
  }
}

export async function login(locale: string = 'en') {
  // Check if already logged in via SessionManager
  try {
    const { SessionManager } = await import('./auth/session-manager');
    const session = await SessionManager.getActiveSession();

    if (session) {
      redirect(`/${locale}`);
    }
  } catch (_sessionError) {
    // SessionManager not available, continue with legacy check
  }

  // Check legacy cookies
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
        await setTokens(verified.tokens!.access, verified.tokens!.refresh);
        redirect(`/${locale}`);
      } else if (!hasError) {
        redirect(`/${locale}`);
      }
    } catch (_loginVerifyError) {
      // Silent failure, proceed with new authorization
    }
  }

  // Redirect to OAuth login with locale in callback URL
  const headers = await getHeaders()
  const { url } = await client.authorize(
    authorizeRedirectUri(originFromHost(headers.get("host")), CALLBACK_PATH, locale),
    "code",
  )
  redirect(url)
}

export async function logout(locale: string = 'en') {
  // Clear SessionManager if available
  try {
    const { SessionManager } = await import('./auth/session-manager');
    await SessionManager.clearAllSessions();
  } catch (_sessionError) {
    // SessionManager not available, continue with legacy cleanup
  }

  // Clear legacy cookies
  const cookies = await getCookies()
  cookies.delete("access_token")
  cookies.delete("refresh_token")

  redirect(`/${locale}`)
}