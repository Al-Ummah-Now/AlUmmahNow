import { clearClientCache, createClient } from "@al-ummah-now/openauth/client"

type OpenAuthClient = ReturnType<typeof createClient>

/**
 * Reuse the client per isolate. OpenAuth caches discovery and JWKS by issuer
 * and refreshes keys after a signature or key lookup failure, with a cooldown.
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
  clearClientCache()
}
