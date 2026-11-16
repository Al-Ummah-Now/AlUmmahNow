/**
 * Platform settings → Credentials (Super Admin, `credentials:manage`): create, rotate, replace and
 * test platform credentials without opening Cloudflare. Values are never sent back: the page sees the
 * source, the last four characters of a value set here, who and when, and the last test.
 *
 * - **Create / Rotate** (mintable credentials): the token manager (Secrets Store
 *   `cloudflare-token-manager`, the one token a person creates by hand) mints an account-owned token
 *   with exactly the permission groups the credential needs, the new token must pass the Test, it is
 *   written into the credential's Secrets Store entry, and only then the previous token is revoked,
 *   and only if it was minted here (name MINTED_TOKEN_PREFIX). A hand-made token is never revoked.
 * - **Replace** (paste): with a token manager, the value goes into the Secrets Store entry; without
 *   one, it is sealed into global-settings (shared-types platform-credentials.ts), which every Worker
 *   reads before its binding.
 *
 * Today: the Cloudflare media token (Secrets Store `media-cdn-api-token`), read by api-videos
 * (MEDIA_CDN_API_TOKEN for cache purges, MEDIA_ANALYTICS_TOKEN for delivery costs) and admin-api
 * (CF_ANALYTICS_TOKEN for Web vitals and abuse counters); and the token manager itself. The Secrets
 * Store entries are shared by every environment (one store), so a rotation anywhere applies to all.
 */
import {
  ALUMMAHNOW_ZONE_ID,
  ALUMMAHNOW_ZONE_NAME,
  MINTED_TOKEN_PREFIX,
  PLATFORM_CREDENTIALS,
  PLATFORM_CREDENTIAL_IDS,
  credentialMaster,
  forgetPlatformCredential,
  platformCredentialKey,
  platformCredentialMintKey,
  platformCredentialTestKey,
  readPlatformCredential,
  resolvePlatformCredential,
  sealPlatformCredential,
  type CredentialCheckName,
  type CredentialEnv,
  type MintRecord,
  type PlatformCredentialId,
  type PlatformCredentialTest,
  type PlatformCredentialView,
  type StoredCredentialTest,
} from '@al-ummah/shared-types';
import { logger } from './logger';

export interface CredentialsEnv {
  global_settings: R2Bucket;
  INTERNAL_API_KEY?: unknown;
  REPORTS_DB: D1Database;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** The Secrets Store copy admin-api already reads (media-cdn-api-token) */
  CF_ANALYTICS_TOKEN?: unknown;
  /** Secrets Store cloudflare-token-manager (placeholder `unset` until the owner sets it) */
  CF_TOKEN_MANAGER?: unknown;
  ENVIRONMENT?: string;
}

export interface Actor {
  id: string;
  name: string | null;
}

export class CredentialError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 502 | 503,
    readonly code: string,
    message: string,
    readonly test?: PlatformCredentialTest,
  ) {
    super(message);
  }
}

const CF_API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_ID = '0e4b6e7f9faf280c3c9bf95995edc64f';
const SECRETS_STORE_ID = 'f8eddc9944d041919ed8dc7d08d32308';
/** Value of a Secrets Store entry created before its real value is known: counts as none. */
const UNSET = 'unset';
export const CREDENTIAL_AUDIT_PREFIX = 'platform-credential:';

/** The Secrets Store binding admin-api reads for each credential. */
const BINDING_OF: Record<PlatformCredentialId, (env: CredentialsEnv) => unknown> = {
  'cloudflare-media': (env) => env.CF_ANALYTICS_TOKEN,
  'cloudflare-token-manager': (env) => env.CF_TOKEN_MANAGER,
};

/** Permission groups a minted token gets, by Cloudflare's names and scopes (no others, ever). */
const MINT_POLICIES: Partial<Record<PlatformCredentialId, { scope: 'account' | 'zone'; groups: string[] }[]>> = {
  'cloudflare-media': [
    { scope: 'account', groups: ['Account Analytics Read'] },
    { scope: 'zone', groups: ['Analytics Read', 'Cache Purge'] },
  ],
};

const accountOf = (env: CredentialsEnv) => env.CLOUDFLARE_ACCOUNT_ID || ACCOUNT_ID;
const credentialEnv = (env: CredentialsEnv) => env as unknown as CredentialEnv;
const timeout = () => AbortSignal.timeout(10_000);

/** The value in use ('' for none or the placeholder). */
async function current(env: CredentialsEnv, id: PlatformCredentialId) {
  const now = await readPlatformCredential(credentialEnv(env), id, BINDING_OF[id](env));
  if (now.value === UNSET) return { ...now, value: '', source: null as null };
  return now;
}

async function readJson<T>(env: CredentialsEnv, key: string): Promise<T | null> {
  try {
    const stored = await env.global_settings.get(key);
    return stored ? ((await stored.json()) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(env: CredentialsEnv, key: string, value: unknown): Promise<void> {
  await env.global_settings.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
}

const stripTest = ({ ok, code, checks, at, by }: StoredCredentialTest): PlatformCredentialTest => ({ ok, code, checks, at, by });

/** The token manager's value, '' when none. */
async function managerToken(env: CredentialsEnv): Promise<string> {
  return (await current(env, 'cloudflare-token-manager')).value;
}

export async function credentialView(env: CredentialsEnv, id: PlatformCredentialId): Promise<PlatformCredentialView> {
  const spec = PLATFORM_CREDENTIALS[id];
  const now = await current(env, id);
  const stored = await readJson<StoredCredentialTest>(env, platformCredentialTestKey(id));
  const mint = await readJson<MintRecord & { last4?: string }>(env, platformCredentialMintKey(id));
  const last4 = now.source === 'admin' ? now.sealed?.last4 || null : null;
  const valueLast4 = now.value ? now.value.slice(-4) : null;
  // A test or a mint record speaks only for the value in use (same last four of the value tested)
  const test = stored && stored.source === now.source && stored.valueLast4 === valueLast4 ? stripTest(stored) : null;
  const minted = mint && mint.last4 && mint.last4 === valueLast4 ? { tokenId: mint.tokenId, at: mint.at, by: mint.by, byName: mint.byName, previousTokenId: mint.previousTokenId, previousRevoked: mint.previousRevoked } : null;
  return {
    id,
    secretsStoreName: spec.secretsStoreName,
    usedBy: spec.usedBy,
    source: now.source,
    present: !!now.value,
    last4,
    updatedAt: now.source === 'admin' ? now.sealed?.updatedAt || null : null,
    updatedBy: now.source === 'admin' ? now.sealed?.updatedBy || null : null,
    updatedByName: now.source === 'admin' ? (now.sealed?.updatedByName ?? null) : null,
    unreadable: now.unreadable,
    test,
    mintable: spec.mintable,
    canMint: spec.mintable && !!(await managerToken(env)),
    minted,
  };
}

export async function listCredentialViews(env: CredentialsEnv): Promise<PlatformCredentialView[]> {
  return Promise.all(PLATFORM_CREDENTIAL_IDS.map((id) => credentialView(env, id)));
}

// ---------------------------------------------------------------------------
// Cloudflare calls
// ---------------------------------------------------------------------------

type CfResult<T> = { status: number; ok: boolean; result: T | null };

async function cf<T>(token: string, method: string, path: string, body: unknown, fetchImpl: typeof fetch): Promise<CfResult<T>> {
  const res = await fetchImpl(`${CF_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeout(),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T };
  return { status: res.status, ok: res.ok && json.success !== false, result: json.result ?? null };
}

/** Who owns a token: verify on the account first (account-owned tokens), then on the user. */
async function verifyToken(token: string, accountId: string, fetchImpl: typeof fetch): Promise<{ owner: 'account' | 'user'; id: string; status: string } | null> {
  const account = await cf<{ id?: string; status?: string }>(token, 'GET', `/accounts/${accountId}/tokens/verify`, undefined, fetchImpl);
  if (account.ok && account.result?.id) return { owner: 'account', id: account.result.id, status: account.result.status ?? 'active' };
  const user = await cf<{ id?: string; status?: string }>(token, 'GET', '/user/tokens/verify', undefined, fetchImpl);
  if (user.ok && user.result?.id) return { owner: 'user', id: user.result.id, status: user.result.status ?? 'active' };
  return null;
}

const tokensBase = (owner: 'account' | 'user', accountId: string) => (owner === 'account' ? `/accounts/${accountId}/tokens` : '/user/tokens');

async function graphqlOk(token: string, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch): Promise<boolean> {
  const res = await fetchImpl(`${CF_API}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: timeout(),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: unknown; errors?: unknown[] | null };
  return res.ok && !!body.data && !(body.errors && body.errors.length);
}

type TestBody = Omit<PlatformCredentialTest, 'at' | 'by'>;
const failAll = (code: string, names: readonly CredentialCheckName[]): TestBody => ({ ok: false, code, checks: names.map((name) => ({ name, ok: false })) });

/**
 * What the Workers need from the media token, each checked without changing anything: the token is
 * active; Account Analytics (R2 storage for delivery costs, Analytics Engine for Web vitals and
 * abuse counters); Zone Analytics on alummahnow.net (media host traffic and cache hits); Cache Purge
 * on alummahnow.net (purging a made-up URL nobody ever requested).
 */
export async function testCloudflareMedia(token: string, accountId: string, fetchImpl: typeof fetch = fetch): Promise<TestBody> {
  const names = PLATFORM_CREDENTIALS['cloudflare-media'].checks;
  const verified = await verifyToken(token, accountId, fetchImpl);
  if (!verified) return failAll('invalid', names);
  if (verified.status !== 'active') return failAll('inactive', names);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const results: Partial<Record<CredentialCheckName, boolean>> = {
    token: true,
    account_analytics: await graphqlOk(
      token,
      'query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){r2StorageAdaptiveGroups(limit:1,filter:{date_geq:$d}){max{payloadSize}}}}}',
      { a: accountId, d: yesterday },
      fetchImpl,
    ).catch(() => false),
    zone_analytics: await graphqlOk(
      token,
      'query($z:String!,$d:Date!,$n:Date!){viewer{zones(filter:{zoneTag:$z}){httpRequestsAdaptiveGroups(limit:1,filter:{date_geq:$d,date_lt:$n}){count}}}}',
      { z: ALUMMAHNOW_ZONE_ID, d: yesterday, n: today },
      fetchImpl,
    ).catch(() => false),
    cache_purge: await cf(token, 'POST', `/zones/${ALUMMAHNOW_ZONE_ID}/purge_cache`, { files: [`https://${ALUMMAHNOW_ZONE_NAME}/__credential-check/${crypto.randomUUID()}`] }, fetchImpl)
      .then((r) => r.ok)
      .catch(() => false),
  };
  const checks = names.map((name) => ({ name, ok: !!results[name] }));
  const ok = checks.every((c) => c.ok);
  return { ok, code: ok ? 'ok' : 'missing_permissions', checks };
}

type Policy = { effect?: string; permission_groups?: { id?: string; name?: string }[]; resources?: Record<string, unknown> };

/**
 * The token manager, read only: active; holds API Tokens Edit (it can mint tokens) and Secrets Store
 * Edit (it can write them where the Workers read them), read from its own policies.
 */
export async function testTokenManager(token: string, accountId: string, fetchImpl: typeof fetch = fetch): Promise<TestBody> {
  const names = PLATFORM_CREDENTIALS['cloudflare-token-manager'].checks;
  const verified = await verifyToken(token, accountId, fetchImpl);
  if (!verified) return failAll('invalid', names);
  if (verified.status !== 'active') return failAll('inactive', names);
  const self = await cf<{ policies?: Policy[] }>(token, 'GET', `${tokensBase(verified.owner, accountId)}/${verified.id}`, undefined, fetchImpl).catch(() => null);
  const groups = (self?.result?.policies ?? []).filter((p) => p.effect !== 'deny').flatMap((p) => (p.permission_groups ?? []).map((g) => g.name ?? ''));
  const has = (re: RegExp) => groups.some((g) => re.test(g));
  const checks = names.map((name) => ({
    name,
    ok: name === 'token' ? true : name === 'mint_tokens' ? has(/API Tokens (Write|Edit)/i) : has(/Secrets Store (Write|Edit)/i),
  }));
  const ok = checks.every((c) => c.ok);
  return { ok, code: ok ? 'ok' : 'missing_permissions', checks };
}

async function runTest(env: CredentialsEnv, id: PlatformCredentialId, value: string, actor: Actor, fetchImpl: typeof fetch): Promise<PlatformCredentialTest> {
  const at = new Date().toISOString();
  if (!value) return { ok: false, code: 'none', checks: [], at, by: actor.id };
  try {
    const body = id === 'cloudflare-token-manager' ? await testTokenManager(value, accountOf(env), fetchImpl) : await testCloudflareMedia(value, accountOf(env), fetchImpl);
    return { ...body, at, by: actor.id };
  } catch (error) {
    logger.warn('[Credentials] Test could not reach Cloudflare', { id, error: error instanceof Error ? error.name : 'error' });
    return { ok: false, code: 'unreachable', checks: [], at, by: actor.id };
  }
}

async function recordTest(env: CredentialsEnv, id: PlatformCredentialId, test: PlatformCredentialTest, source: 'admin' | 'binding' | null, value: string, last4: string | null) {
  await writeJson(env, platformCredentialTestKey(id), { ...test, source, last4, valueLast4: value ? value.slice(-4) : null } satisfies StoredCredentialTest);
}

// ---------------------------------------------------------------------------
// Writing a value where the Workers read it
// ---------------------------------------------------------------------------

/** Writes `value` into the credential's Secrets Store entry with the token manager (creates it if missing). */
async function writeSecretsStore(manager: string, accountId: string, name: string, value: string, fetchImpl: typeof fetch): Promise<void> {
  const base = `/accounts/${accountId}/secrets_store/stores/${SECRETS_STORE_ID}/secrets`;
  const list = await cf<{ id: string; name: string }[]>(manager, 'GET', `${base}?per_page=100&search=${encodeURIComponent(name)}`, undefined, fetchImpl);
  if (!list.ok) throw new CredentialError(502, 'store_refused', `The Secrets Store refused the token manager (HTTP ${list.status})`);
  const found = (list.result ?? []).find((s) => s.name === name);
  const write = found
    ? await cf(manager, 'PATCH', `${base}/${found.id}`, { value, scopes: ['workers'] }, fetchImpl)
    : await cf(manager, 'POST', base, [{ name, value, scopes: ['workers'], comment: 'Set from the videos admin (Platform settings → Credentials)' }], fetchImpl);
  if (!write.ok) throw new CredentialError(502, 'store_refused', `The Secrets Store refused the write (HTTP ${write.status})`);
}

/**
 * Puts a value where the Workers read it: the Secrets Store entry when a token manager is set (and
 * the sealed copy, if any, is removed so the entry wins), else sealed into global-settings.
 */
async function storeValue(env: CredentialsEnv, id: PlatformCredentialId, value: string, actor: Actor, fetchImpl: typeof fetch): Promise<'admin' | 'binding'> {
  const manager = await managerToken(env);
  if (manager) {
    await writeSecretsStore(manager, accountOf(env), PLATFORM_CREDENTIALS[id].secretsStoreName, value, fetchImpl);
    await env.global_settings.delete(platformCredentialKey(id));
    forgetPlatformCredential(id);
    return 'binding';
  }
  const master = await credentialMaster(credentialEnv(env));
  if (!master) throw new CredentialError(503, 'unavailable', 'No key to seal the credential with (INTERNAL_API_KEY is not bound)');
  const sealed = await sealPlatformCredential(id, master, value, actor, new Date().toISOString());
  await writeJson(env, platformCredentialKey(id), sealed);
  forgetPlatformCredential(id);
  return 'admin';
}

// ---------------------------------------------------------------------------
// Changes (each audited in site_settings_log before it is made, the row dropped if it fails)
// ---------------------------------------------------------------------------

async function audit(env: CredentialsEnv, id: PlatformCredentialId, before: unknown, after: unknown, actor: Actor): Promise<string> {
  const auditId = crypto.randomUUID();
  await env.REPORTS_DB.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(auditId, `${CREDENTIAL_AUDIT_PREFIX}${id}`, JSON.stringify(before), JSON.stringify(after), actor.id, new Date().toISOString())
    .run();
  return auditId;
}

async function audited<T>(env: CredentialsEnv, id: PlatformCredentialId, before: unknown, after: unknown, actor: Actor, change: () => Promise<T>): Promise<T> {
  const auditId = await audit(env, id, before, after, actor);
  try {
    return await change();
  } catch (error) {
    await env.REPORTS_DB.prepare('DELETE FROM site_settings_log WHERE id = ?')
      .bind(auditId)
      .run()
      .catch((dropError) => logger.error('[Credentials] Could not drop the audit row of a failed change', { id, error: String(dropError) }));
    throw error;
  }
}

/** What the audit records about a credential: never the value, only its source and last four characters. */
export const auditState = (view: Pick<PlatformCredentialView, 'source' | 'last4' | 'present'>) => ({ source: view.source, present: view.present, last4: view.last4 });

/** Stores a pasted value (Secrets Store with a token manager, else sealed), then tests it. */
export async function replaceCredential(
  env: CredentialsEnv,
  id: PlatformCredentialId,
  value: string,
  actor: Actor,
  fetchImpl: typeof fetch = fetch,
): Promise<{ view: PlatformCredentialView; test: PlatformCredentialTest }> {
  const before = await credentialView(env, id);
  const clean = value.trim();
  const source = await audited(env, id, auditState(before), { action: 'replaced', last4: clean.slice(-4) }, actor, () => storeValue(env, id, clean, actor, fetchImpl));
  const test = await runTest(env, id, clean, actor, fetchImpl);
  await recordTest(env, id, test, source, clean, source === 'admin' ? clean.slice(-4) : null);
  logger.info('[Credentials] Replaced', { id, actorId: actor.id, source, test: test.code });
  return { view: await credentialView(env, id), test };
}

/** Tests the value in use (admin-set or the Secrets Store's) and records the result. */
export async function testCredential(env: CredentialsEnv, id: PlatformCredentialId, actor: Actor, fetchImpl: typeof fetch = fetch): Promise<{ view: PlatformCredentialView; test: PlatformCredentialTest }> {
  const now = await current(env, id);
  const last4 = now.source === 'admin' ? now.sealed?.last4 || null : null;
  const test = await runTest(env, id, now.value, actor, fetchImpl);
  await audited(env, id, null, { action: 'tested', source: now.source, last4, ok: test.ok, code: test.code, missing: test.checks.filter((c) => !c.ok).map((c) => c.name) }, actor, () =>
    recordTest(env, id, test, now.source, now.value, last4),
  );
  logger.info('[Credentials] Tested', { id, actorId: actor.id, source: now.source, test: test.code });
  return { view: await credentialView(env, id), test };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Create / Rotate: mint a token with exactly the credential's permission groups, check it, store it
 * where the Workers read it, then revoke the previous token if (and only if) it was minted here.
 */
export async function mintCredential(
  env: CredentialsEnv,
  id: PlatformCredentialId,
  actor: Actor,
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<{ view: PlatformCredentialView; test: PlatformCredentialTest; previousRevoked: boolean; previousKept: 'none' | 'not_minted_here' | 'revoke_failed' | null }> {
  const policiesWanted = MINT_POLICIES[id];
  if (!PLATFORM_CREDENTIALS[id].mintable || !policiesWanted) throw new CredentialError(400, 'not_mintable', 'This credential cannot be created here');
  const manager = await managerToken(env);
  if (!manager) throw new CredentialError(409, 'no_manager', 'Set the token manager first');
  const accountId = accountOf(env);
  const managerIs = await verifyToken(manager, accountId, fetchImpl);
  if (!managerIs || managerIs.status !== 'active') throw new CredentialError(409, 'manager_invalid', 'Cloudflare does not accept the token manager');
  const base = tokensBase(managerIs.owner, accountId);

  // Exactly the groups this credential needs, found by name and scope
  const groups = await cf<{ id: string; name: string; scopes?: string[] }[]>(manager, 'GET', `${base}/permission_groups`, undefined, fetchImpl);
  if (!groups.ok || !groups.result) throw new CredentialError(409, 'manager_cannot_mint', 'The token manager cannot list permission groups (it needs API Tokens: Edit)');
  const scopeOf = { account: 'com.cloudflare.api.account', zone: 'com.cloudflare.api.account.zone' } as const;
  const pick = (name: string, scope: 'account' | 'zone') =>
    groups.result!.find((g) => g.name === name && (!g.scopes || g.scopes.includes(scopeOf[scope])))?.id ?? null;
  const policies = policiesWanted.map((p) => {
    const ids = p.groups.map((name) => pick(name, p.scope));
    if (ids.some((x) => !x)) throw new CredentialError(502, 'groups_missing', `Cloudflare has no permission group named ${p.groups.join(' / ')}`);
    return {
      effect: 'allow',
      resources: p.scope === 'account' ? { [`com.cloudflare.api.account.${accountId}`]: '*' } : { [`com.cloudflare.api.account.zone.${ALUMMAHNOW_ZONE_ID}`]: '*' },
      permission_groups: ids.map((gid) => ({ id: gid })),
    };
  });

  // The previous token, if Cloudflare still knows it: revoked later only when minted here
  const before = await current(env, id);
  const previous = before.value ? await verifyToken(before.value, accountId, fetchImpl).catch(() => null) : null;
  let previousName: string | null = null;
  if (previous) {
    const info = await cf<{ name?: string }>(manager, 'GET', `${tokensBase(previous.owner, accountId)}/${previous.id}`, undefined, fetchImpl).catch(() => null);
    previousName = info?.result?.name ?? null;
  }

  const env_ = env.ENVIRONMENT || 'production';
  const created = await cf<{ id: string; value: string }>(manager, 'POST', base, { name: `${MINTED_TOKEN_PREFIX} ${id} ${new Date().toISOString().slice(0, 16)}Z (${env_})`, policies }, fetchImpl);
  if (!created.ok || !created.result?.value) throw new CredentialError(409, 'manager_cannot_mint', `Cloudflare refused to create the token (HTTP ${created.status}); the token manager needs API Tokens: Edit`);
  const fresh = created.result;

  // A new token can take a few seconds to verify everywhere
  let test: PlatformCredentialTest | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    test = await runTest(env, id, fresh.value, actor, fetchImpl);
    if (test.ok) break;
    await wait(2000);
  }
  if (!test?.ok) {
    await cf(manager, 'DELETE', `${base}/${fresh.id}`, undefined, fetchImpl).catch(() => null);
    throw new CredentialError(502, 'minted_token_failed', 'The new token did not pass the test; it was deleted and nothing changed', test ?? undefined);
  }

  const auditId = await audit(env, id, auditState(await credentialView(env, id)), { action: previous ? 'rotated' : 'created', tokenId: fresh.id, last4: fresh.value.slice(-4), previousTokenId: previous?.id ?? null }, actor);
  let source: 'admin' | 'binding';
  try {
    source = await storeValue(env, id, fresh.value, actor, fetchImpl);
  } catch (error) {
    // Nothing reads the new token: delete it and the audit row
    await cf(manager, 'DELETE', `${base}/${fresh.id}`, undefined, fetchImpl).catch(() => null);
    await env.REPORTS_DB.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(auditId).run().catch(() => null);
    throw error;
  }
  await recordTest(env, id, test, source, fresh.value, source === 'admin' ? fresh.value.slice(-4) : null);

  let previousRevoked = false;
  let previousKept: 'none' | 'not_minted_here' | 'revoke_failed' | null = null;
  if (!previous) previousKept = 'none';
  else if (previous.id === fresh.id) previousKept = null;
  else if (!previousName?.startsWith(MINTED_TOKEN_PREFIX)) previousKept = 'not_minted_here';
  else {
    const revoked = await cf(manager, 'DELETE', `${tokensBase(previous.owner, accountId)}/${previous.id}`, undefined, fetchImpl).catch(() => null);
    previousRevoked = !!revoked?.ok;
    if (!previousRevoked) previousKept = 'revoke_failed';
  }
  const record: MintRecord & { last4: string } = { tokenId: fresh.id, at: new Date().toISOString(), by: actor.id, byName: actor.name, previousTokenId: previous?.id ?? null, previousRevoked, last4: fresh.value.slice(-4) };
  await writeJson(env, platformCredentialMintKey(id), record);
  await audit(env, id, null, { action: 'previous_token', previousTokenId: previous?.id ?? null, revoked: previousRevoked, kept: previousKept }, actor);
  logger.info('[Credentials] Minted', { id, actorId: actor.id, tokenId: fresh.id, previousRevoked, previousKept });
  return { view: await credentialView(env, id), test, previousRevoked, previousKept };
}

/** The value a Worker uses (admin-api's own reads go through the shared resolver too). */
export const resolveCredential = (env: CredentialsEnv, id: PlatformCredentialId) => resolvePlatformCredential(credentialEnv(env), id, BINDING_OF[id](env));
