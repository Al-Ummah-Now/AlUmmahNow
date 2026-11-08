/**
 * Test helpers for token refresh: unsigned JWTs with the claims the issuer
 * puts in access tokens, and a fake issuer /token endpoint.
 */

function base64url(value: string): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An access token issued at `iatMs` that expires `ttlMs` later. */
export function jwt(userId: string, iatMs: number, ttlMs: number, jti = `${userId}-${iatMs}`): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    mode: 'access',
    type: 'user',
    sub: `user:${userId}`,
    jti,
    iat: Math.floor(iatMs / 1000),
    exp: Math.floor((iatMs + ttlMs) / 1000),
    auth_time: Math.floor(iatMs / 1000),
    properties: { id: userId, email: `${userId}@example.com` },
  }));
  return `${header}.${payload}.sig`;
}

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;

export interface IssuerCall {
  refreshToken: string;
}

/**
 * A fake issuer: `responses` maps a refresh token to what /token answers for
 * it (new tokens, or an error status). Records every call.
 */
export function fakeIssuer(responses: Record<string, { access: string; refresh: string; expiresIn?: number } | { status: number; error?: string }>) {
  const calls: IssuerCall[] = [];
  const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''));
    const refreshToken = body.get('refresh_token') ?? '';
    calls.push({ refreshToken });
    const answer = responses[refreshToken] ?? { status: 400, error: 'invalid_grant' };
    if ('status' in answer) {
      return new Response(JSON.stringify({ error: answer.error ?? 'invalid_grant' }), { status: answer.status });
    }
    return new Response(
      JSON.stringify({ access_token: answer.access, refresh_token: answer.refresh, expires_in: answer.expiresIn ?? 900 }),
      { status: 200 },
    );
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch, mock: fetchImpl };
}
