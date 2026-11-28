import { createClient } from "@al-ummah-now/openauth/client"
import { audienceMode, withAudienceCheck } from "@al-ummah/shared-types"
import { logger } from "@/lib/logger-server"

type OpenAuthClient = ReturnType<typeof createClient>

/**
 * Reuse the client per isolate. OpenAuth caches discovery and JWKS by issuer
 * and refreshes keys after a signature or key lookup failure, with a cooldown.
 */
export const CLIENT_TTL_MS = 10 * 60 * 1000

let cached: { key: string; client: OpenAuthClient; createdAt: number } | null = null

export function getOpenAuthClient(now: () => number = Date.now): OpenAuthClient {
  // Both come from wrangler "vars". A missing ClientId used to be sent as the
  // string "undefined", which the auth server rejects.
  const clientID = process.env.ClientId
  const issuer = process.env.Issuer
  if (!clientID || !issuer) {
    throw new Error("Auth is not configured: set ClientId and Issuer in the wrangler vars")
  }
  const key = `${issuer}|${clientID}`
  const t = now()
  if (!cached || cached.key !== key || t - cached.createdAt >= CLIENT_TTL_MS || t < cached.createdAt) {
    // verify() also checks aud: only this site's own client's tokens (AUD_MODE log|enforce|off)
    const client = withAudienceCheck(createClient({ clientID, issuer }), { service: "web", issuer, mode: () => audienceMode(process.env.AUD_MODE), route: "web session" }, (message, fields) => logger.warn(message, fields))
    cached = { key, client, createdAt: t }
  }
  return cached.client
}

/** Tests only. */
export function __resetOpenAuthClientForTests(): void {
  cached = null
}
