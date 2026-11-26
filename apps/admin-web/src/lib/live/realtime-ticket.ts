/**
 * Server side of /api/realtime/token: resolves the realtime worker URL and
 * exchanges an admin's OpenAuth access token for a short-lived (~60 s),
 * single-use, user-bound WebSocket ticket (#230) so browser JS never receives
 * the OpenAuth access token.
 */

const TICKET_TIMEOUT_MS = 5_000;

/**
 * The realtime worker of this environment: REALTIME_URL when set (local
 * stack), else derived from ADMIN_API_URL (admin.api[.env].alummahnow.net →
 * realtime[.env].alummahnow.net), else the local dev server.
 */
export function realtimeUrlFor(env: { REALTIME_URL?: string; ADMIN_API_URL?: string }): string {
  if (env.REALTIME_URL) return env.REALTIME_URL.replace(/\/+$/, '');
  try {
    const api = new URL(env.ADMIN_API_URL ?? '');
    if (/^admin\.api\./.test(api.hostname)) return `https://${api.hostname.replace(/^admin\.api\./, 'realtime.')}`;
  } catch {
    // no or bad ADMIN_API_URL: local
  }
  return 'http://localhost:3087';
}

/** `exp` of a JWT (unix seconds), without verifying it: only for scheduling a refresh. */
export function tokenExpiry(token: string): number | undefined {
  try {
    const part = token.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : undefined;
  } catch {
    return undefined;
  }
}

export interface MintedAdminTicket {
  url: string;
  token: string;
  /** Unix seconds when the authenticated socket session must re-authenticate. */
  expiresAt: number | null;
  /** Unix seconds when the single-use ticket itself stops being redeemable. */
  ticketExpiresAt: number;
}

/**
 * Mints a short-lived single-use WebSocket ticket from the realtime worker.
 * Never returns the raw OpenAuth access token.
 */
export async function mintAdminRealtimeTicket(
  accessToken: string,
  deps: { realtimeUrl: string; internalApiKey: string; fetchImpl?: typeof fetch },
): Promise<MintedAdminTicket | null> {
  if (!accessToken || !deps.realtimeUrl || !deps.internalApiKey) return null;
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const base = deps.realtimeUrl.replace(/\/+$/, '');
    const res = await doFetch(`${base}/internal/ws-ticket`, {
      method: 'POST',
      headers: {
        'X-API-Key': deps.internalApiKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      // Workers supports manual redirects. A 3xx fails the res.ok check below.
      redirect: 'manual',
      signal: AbortSignal.timeout(TICKET_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ticket?: unknown; expiresAt?: unknown; authExpiresAt?: unknown };
    if (typeof body.ticket !== 'string' || !body.ticket.startsWith('wst_')) return null;
    const ticketExpiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : Math.floor(Date.now() / 1000) + 60;
    const authExpiresAt = typeof body.authExpiresAt === 'number' ? body.authExpiresAt : (tokenExpiry(accessToken) ?? null);
    return { url: base, token: body.ticket, expiresAt: authExpiresAt, ticketExpiresAt };
  } catch {
    return null;
  }
}
