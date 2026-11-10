/**
 * Headless OAuth helpers (no browser): obtain an access token for an account
 * through the same authorize -> password -> code -> token flow the admin app
 * uses. Used for API-side fixtures (creating and cleaning up reports).
 */
import { createHash, randomBytes } from 'node:crypto';
import { ADMIN_CLIENT_ID, CALLBACK_URL, OPENAUTH_URL, type Account } from './env';

/** PKCE S256: the auth server only redeems this client's codes with the verifier (AlUmmahNowAuth#302). */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

class CookieJar {
  private cookies = new Map<string, string>();

  store(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function step(jar: CookieJar, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers as Record<string, string>), cookie: jar.header() },
  });
  jar.store(response);
  return response;
}

export async function getAccessToken(account: Account): Promise<string> {
  const jar = new CookieJar();
  const pkce = pkcePair();
  const state = randomBytes(16).toString('hex');
  const authorize = new URL(`${OPENAUTH_URL}/authorize`);
  authorize.searchParams.set('client_id', ADMIN_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', CALLBACK_URL);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', pkce.challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  // Follow the authorize redirects on the auth host until the password form.
  let response = await step(jar, authorize.toString());
  for (let hops = 0; response.status >= 300 && response.status < 400 && hops < 10; hops++) {
    response = await step(jar, new URL(response.headers.get('location')!, OPENAUTH_URL).toString());
  }

  response = await step(jar, `${OPENAUTH_URL}/password/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: account.email, password: account.password }).toString(),
  });

  let location = response.headers.get('location');
  for (let hops = 0; location && !location.startsWith(CALLBACK_URL) && hops < 10; hops++) {
    response = await step(jar, new URL(location, OPENAUTH_URL).toString());
    location = response.headers.get('location');
  }
  if (!location?.startsWith(CALLBACK_URL)) {
    throw new Error(`Login for ${account.email} did not reach the callback (status ${response.status})`);
  }

  const callback = new URL(location);
  if (callback.searchParams.get('state') !== state) throw new Error(`State mismatch on the callback for ${account.email}`);
  const code = callback.searchParams.get('code');
  if (!code) throw new Error(`No authorization code for ${account.email}`);

  const tokenResponse = await fetch(`${OPENAUTH_URL}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CALLBACK_URL,
      client_id: ADMIN_CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  });
  if (!tokenResponse.ok) {
    const reason = ((await tokenResponse.json().catch(() => ({}))) as { error?: string }).error ?? '';
    throw new Error(`Token exchange failed for ${account.email}: ${tokenResponse.status} ${reason}`);
  }
  const body = (await tokenResponse.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`No access token for ${account.email}`);
  return body.access_token;
}
