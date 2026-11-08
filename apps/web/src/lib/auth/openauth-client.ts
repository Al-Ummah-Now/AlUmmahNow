import { createClient } from "@al-ummah-now/openauth/client"

type OpenAuthClient = ReturnType<typeof createClient>

/**
 * One OpenAuth client per isolate. The client caches the issuer's discovery
 * document and JWKS inside itself, so creating one per call (as getClient,
 * SessionManager and the multi-account actions did) fetched both from the
 * auth worker on every session check. Rebuilt every CLIENT_TTL_MS so a
 * rotated signing key is picked up.
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
    cached = { key, client: createClient({ clientID, issuer }), createdAt: t }
  }
  return cached.client
}

/** Tests only. */
export function __resetOpenAuthClientForTests(): void {
  cached = null
}
