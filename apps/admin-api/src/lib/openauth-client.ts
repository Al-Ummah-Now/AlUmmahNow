import { createClient } from "@al-ummah-now/openauth/client"

type OpenAuthClient = ReturnType<typeof createClient>

/**
 * The OpenAuth client caches the issuer's discovery document and JWKS inside
 * the client object, so a client created per request fetched both from the
 * auth worker on every authenticated request (two auth-worker invocations
 * per API call). Keep one client per isolate instead, rebuilt every
 * CLIENT_TTL_MS so a rotated signing key is picked up.
 */
export const CLIENT_TTL_MS = 10 * 60 * 1000

let cached: { key: string; client: OpenAuthClient; createdAt: number } | null = null

export async function getClient(
  env: { ClientId?: string; Issuer?: string },
  now: () => number = Date.now,
): Promise<OpenAuthClient> {
  const key = `${env.Issuer}|${env.ClientId}`
  const t = now()
  if (!cached || cached.key !== key || t - cached.createdAt >= CLIENT_TTL_MS || t < cached.createdAt) {
    cached = {
      key,
      client: createClient({ clientID: env.ClientId as string, issuer: env.Issuer }),
      createdAt: t,
    }
  }
  return cached.client
}

/** Tests only. */
export function __resetClientForTests(): void {
  cached = null
}
