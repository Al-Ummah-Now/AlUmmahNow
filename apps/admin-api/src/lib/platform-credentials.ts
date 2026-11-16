/**
 * Platform settings → Credentials (Super Admin, `credentials:manage`): replace a platform credential
 * without opening Cloudflare, and test what it can do. The value is sealed into global-settings
 * (shared-types platform-credentials.ts), read first by every Worker that uses it, and never sent
 * back: the page sees the source, the last four characters, who replaced it and when, and the last test.
 *
 * Today: the Cloudflare media token (Secrets Store `media-cdn-api-token`), read by api-videos
 * (MEDIA_CDN_API_TOKEN for cache purges, MEDIA_ANALYTICS_TOKEN for delivery costs) and admin-api
 * (CF_ANALYTICS_TOKEN for Web vitals and abuse counters).
 */
import {
  ALUMMAHNOW_ZONE_ID,
  ALUMMAHNOW_ZONE_NAME,
  CLOUDFLARE_MEDIA_CHECKS,
  PLATFORM_CREDENTIALS,
  PLATFORM_CREDENTIAL_IDS,
  credentialMaster,
  forgetPlatformCredential,
  platformCredentialKey,
  platformCredentialTestKey,
  readPlatformCredential,
  sealPlatformCredential,
  type CloudflareMediaCheck,
  type CredentialEnv,
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
}

export interface Actor {
  id: string;
  name: string | null;
}

export class CredentialError extends Error {
  constructor(readonly status: 400 | 404 | 503, readonly code: string, message: string) {
    super(message);
  }
}

const CF_API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_ID = '0e4b6e7f9faf280c3c9bf95995edc64f';
export const CREDENTIAL_AUDIT_PREFIX = 'platform-credential:';

/** The Secrets Store binding admin-api reads for each credential. */
const BINDING_OF: Record<PlatformCredentialId, (env: CredentialsEnv) => unknown> = {
  'cloudflare-media': (env) => env.CF_ANALYTICS_TOKEN,
};

const credentialEnv = (env: CredentialsEnv) => env as unknown as CredentialEnv;

async function readTest(env: CredentialsEnv, id: PlatformCredentialId): Promise<StoredCredentialTest | null> {
  try {
    const stored = await env.global_settings.get(platformCredentialTestKey(id));
    return stored ? ((await stored.json()) as StoredCredentialTest) : null;
  } catch {
    return null;
  }
}

async function writeTest(env: CredentialsEnv, id: PlatformCredentialId, test: StoredCredentialTest): Promise<void> {
  await env.global_settings.put(platformCredentialTestKey(id), JSON.stringify(test), { httpMetadata: { contentType: 'application/json' } });
}

export async function credentialView(env: CredentialsEnv, id: PlatformCredentialId): Promise<PlatformCredentialView> {
  const spec = PLATFORM_CREDENTIALS[id];
  const now = await readPlatformCredential(credentialEnv(env), id, BINDING_OF[id](env));
  const stored = await readTest(env, id);
  const last4 = now.source === 'admin' ? now.sealed?.last4 || null : null;
  // A test speaks for the value in use only: same source, and for an admin value the same one
  const test = stored && stored.source === now.source && (now.source !== 'admin' || stored.last4 === last4) ? stripTest(stored) : null;
  return {
    id,
    secretsStoreName: spec.secretsStoreName,
    usedBy: spec.usedBy,
    source: now.source,
    present: !!now.value,
    last4,
    updatedAt: now.sealed?.updatedAt || null,
    updatedBy: now.sealed?.updatedBy || null,
    updatedByName: now.sealed?.updatedByName ?? null,
    unreadable: now.unreadable,
    test,
  };
}

const stripTest = ({ ok, code, checks, at, by }: StoredCredentialTest): PlatformCredentialTest => ({ ok, code, checks, at, by });

export async function listCredentialViews(env: CredentialsEnv): Promise<PlatformCredentialView[]> {
  return Promise.all(PLATFORM_CREDENTIAL_IDS.map((id) => credentialView(env, id)));
}

// ---------------------------------------------------------------------------
// The Cloudflare media token's test
// ---------------------------------------------------------------------------

const timeout = () => AbortSignal.timeout(10_000);

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

/**
 * What the Workers need from the token, each checked without changing anything: the token is
 * active; Account Analytics (R2 storage for delivery costs, Analytics Engine for Web vitals and
 * abuse counters); Zone Analytics on alummahnow.net (media host traffic and cache hits); Cache Purge
 * on alummahnow.net (purging a made-up URL nobody ever requested).
 */
export async function testCloudflareMedia(token: string, accountId: string, fetchImpl: typeof fetch = fetch): Promise<Omit<PlatformCredentialTest, 'at' | 'by'>> {
  const auth = { Authorization: `Bearer ${token}` };
  let verify = await fetchImpl(`${CF_API}/user/tokens/verify`, { headers: auth, signal: timeout() });
  // Account-owned tokens verify on the account instead
  if (!verify.ok) verify = await fetchImpl(`${CF_API}/accounts/${accountId}/tokens/verify`, { headers: auth, signal: timeout() });
  const verified = (await verify.json().catch(() => ({}))) as { success?: boolean; result?: { status?: string } };
  const fail = (code: string) => ({ ok: false, code, checks: CLOUDFLARE_MEDIA_CHECKS.map((name) => ({ name, ok: false })) });
  if (!verify.ok || verified.success === false) return fail('invalid');
  if (verified.result?.status && verified.result.status !== 'active') return fail('inactive');

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const results: Record<CloudflareMediaCheck, boolean> = {
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
    cache_purge: await fetchImpl(`${CF_API}/zones/${ALUMMAHNOW_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [`https://${ALUMMAHNOW_ZONE_NAME}/__credential-check/${crypto.randomUUID()}`] }),
      signal: timeout(),
    })
      .then((r) => r.ok)
      .catch(() => false),
  };
  const checks = CLOUDFLARE_MEDIA_CHECKS.map((name) => ({ name, ok: results[name] }));
  const ok = checks.every((c) => c.ok);
  return { ok, code: ok ? 'ok' : 'missing_permissions', checks };
}

async function runTest(env: CredentialsEnv, id: PlatformCredentialId, value: string, actor: Actor, fetchImpl: typeof fetch): Promise<PlatformCredentialTest> {
  const at = new Date().toISOString();
  if (!value) return { ok: false, code: 'none', checks: [], at, by: actor.id };
  try {
    return { ...(await testCloudflareMedia(value, env.CLOUDFLARE_ACCOUNT_ID || ACCOUNT_ID, fetchImpl)), at, by: actor.id };
  } catch (error) {
    logger.warn('[Credentials] Test could not reach Cloudflare', { id, error: error instanceof Error ? error.name : 'error' });
    return { ok: false, code: 'unreachable', checks: [], at, by: actor.id };
  }
}

// ---------------------------------------------------------------------------
// Changes (each audited in site_settings_log before it is made, the row dropped if it fails)
// ---------------------------------------------------------------------------

async function audited<T>(env: CredentialsEnv, id: PlatformCredentialId, before: unknown, after: unknown, actor: Actor, change: () => Promise<T>): Promise<T> {
  const auditId = crypto.randomUUID();
  await env.REPORTS_DB.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(auditId, `${CREDENTIAL_AUDIT_PREFIX}${id}`, JSON.stringify(before), JSON.stringify(after), actor.id, new Date().toISOString())
    .run();
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

/** Seals and stores a new value (it replaces any earlier admin-set one), then tests it. */
export async function replaceCredential(
  env: CredentialsEnv,
  id: PlatformCredentialId,
  value: string,
  actor: Actor,
  fetchImpl: typeof fetch = fetch,
): Promise<{ view: PlatformCredentialView; test: PlatformCredentialTest }> {
  const master = await credentialMaster(credentialEnv(env));
  if (!master) throw new CredentialError(503, 'unavailable', 'No key to seal the credential with (INTERNAL_API_KEY is not bound)');
  const before = await credentialView(env, id);
  const clean = value.trim();
  const sealed = await sealPlatformCredential(id, master, clean, actor, new Date().toISOString());
  await audited(env, id, auditState(before), { source: 'admin', present: true, last4: sealed.last4, action: 'replaced' }, actor, () =>
    env.global_settings.put(platformCredentialKey(id), JSON.stringify(sealed), { httpMetadata: { contentType: 'application/json' } }),
  );
  forgetPlatformCredential(id);
  const test = await runTest(env, id, clean, actor, fetchImpl);
  await writeTest(env, id, { ...test, source: 'admin', last4: sealed.last4 });
  logger.info('[Credentials] Replaced', { id, actorId: actor.id, test: test.code });
  return { view: await credentialView(env, id), test };
}

/** Tests the value in use (admin-set or the Secrets Store's) and records the result. */
export async function testCredential(env: CredentialsEnv, id: PlatformCredentialId, actor: Actor, fetchImpl: typeof fetch = fetch): Promise<{ view: PlatformCredentialView; test: PlatformCredentialTest }> {
  const now = await readPlatformCredential(credentialEnv(env), id, BINDING_OF[id](env));
  const last4 = now.source === 'admin' ? now.sealed?.last4 || null : null;
  const test = await runTest(env, id, now.value, actor, fetchImpl);
  await audited(env, id, null, { action: 'tested', source: now.source, last4, ok: test.ok, code: test.code, missing: test.checks.filter((c) => !c.ok).map((c) => c.name) }, actor, () =>
    writeTest(env, id, { ...test, source: now.source, last4 }),
  );
  logger.info('[Credentials] Tested', { id, actorId: actor.id, source: now.source, test: test.code });
  return { view: await credentialView(env, id), test };
}
