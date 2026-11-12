/**
 * Server side of /api/realtime/token: where the realtime worker is and when the
 * handed-out token expires. Pure, so it is unit tested.
 */

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
