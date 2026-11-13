/**
 * Quran Foundation Content API client for the Content Sync job (AUN-CAPTIONS mode A).
 *
 * OAuth2 client credentials (scope `content.sync.read`), token cached for the invocation and
 * refreshed once on a 401. 429 and 5xx are retryable (the queue backs off); other 4xx are not.
 * Never called from a test, CI or E2E run with the real network: tests pass a fake `fetchImpl`.
 */

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface QfEnv {
  QF_CLIENT_ID?: SecretBinding;
  QF_CLIENT_SECRET?: SecretBinding;
  /** https://oauth2.quran.foundation */
  QF_OAUTH_HOST?: string;
  /** https://apis.quran.foundation */
  QF_API_HOST?: string;
  NODE_ENV?: string;
  CI?: string;
  E2E_ENV?: string;
}

export class QfError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'QfError';
  }
}

async function secret(b: SecretBinding): Promise<string> {
  if (!b) return '';
  return typeof b === 'string' ? b : ((await b.get()) ?? '');
}

type GuardEnv = Pick<QfEnv, 'NODE_ENV' | 'CI' | 'E2E_ENV'>;

/** Throws when the real QF API could be called from a test, CI or E2E run (owner rule: fixtures only). */
export function assertRealQfAllowed(env: GuardEnv, processEnv: GuardEnv = (globalThis as { process?: { env?: GuardEnv } }).process?.env ?? {}): void {
  const under = (e: GuardEnv) => e.NODE_ENV === 'test' || e.CI === 'true' || !!e.E2E_ENV;
  if (under(env) || under(processEnv)) throw new Error('[Quran] Refusing to call Quran Foundation from a test, CI or E2E run: pass a fixture fetch');
}

export class QfClient {
  private token: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly env: QfEnv,
    fetchImpl?: typeof fetch,
  ) {
    if (!fetchImpl) assertRealQfAllowed(env);
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get apiBase(): string {
    return `${(this.env.QF_API_HOST || 'https://apis.quran.foundation').replace(/\/$/, '')}/content`;
  }

  private async clientId(): Promise<string> {
    const id = await secret(this.env.QF_CLIENT_ID);
    if (!id) throw new QfError('QF_CLIENT_ID is not bound', 0, false, 'not_configured');
    return id;
  }

  private async getToken(force = false): Promise<string> {
    if (this.token && !force) return this.token;
    const id = await this.clientId();
    const key = await secret(this.env.QF_CLIENT_SECRET);
    if (!key) throw new QfError('QF_CLIENT_SECRET is not bound', 0, false, 'not_configured');
    const host = (this.env.QF_OAUTH_HOST || 'https://oauth2.quran.foundation').replace(/\/$/, '');
    const res = await this.fetchImpl(`${host}/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${id}:${key}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=content.sync.read',
    });
    if (!res.ok) throw await toError(res, 'token');
    const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
    if (!body?.access_token) throw new QfError('QF token response had no access_token', res.status, true, 'bad_token');
    this.token = body.access_token;
    return this.token;
  }

  /**
   * GET a Content API path (`/api/v4/...`, relative to https://apis.quran.foundation/content).
   * Returns the Response (the snapshot body is streamed by the caller).
   */
  async get(path: string): Promise<Response> {
    if (!path.startsWith('/api/v4/')) throw new QfError(`Unexpected QF path ${path.slice(0, 80)}`, 0, false, 'bad_path');
    const send = async (force: boolean) =>
      this.fetchImpl(`${this.apiBase}${path}`, { headers: { 'x-auth-token': await this.getToken(force), 'x-client-id': await this.clientId(), accept: 'application/json' } });
    let res = await send(false);
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      res = await send(true);
    }
    if (!res.ok) throw await toError(res, path.split('?')[0]!);
    return res;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await this.get(path);
    return (await res.json()) as T;
  }
}

async function toError(res: Response, what: string): Promise<QfError> {
  const body = (await res.json().catch(() => null)) as { error?: string | { code?: string; message?: string }; code?: string; message?: string } | null;
  const code = (typeof body?.error === 'object' ? body.error.code : typeof body?.error === 'string' ? body.error : body?.code) ?? undefined;
  const retryAfter = Number(res.headers.get('retry-after')) || undefined;
  const retryable = res.status === 429 || res.status >= 500;
  return new QfError(`QF ${what}: ${res.status}${code ? ` ${code}` : ''}`, res.status, retryable, code, retryAfter);
}
