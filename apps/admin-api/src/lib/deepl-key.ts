/**
 * The DeepL API key on Caption settings (AUN-CAPTIONS DEEPL-KEY), set by a super admin.
 *
 * Built like the Costs page's Connections (lib/costs.ts): the key is sealed with
 * packages/shared-types service-credentials.ts and stored in SEARCH_DB service_credentials, where
 * api-videos (provider choice) and the processor (each translation job) open it in memory. admin-api
 * opens it only to test it against DeepL's free /v2/usage. Nothing here returns, logs or audits the
 * key: only its last four characters, the plan, who set it and when, and the last test.
 */
import {
  DEEPL_NEEDS_ACTION_KEY,
  deeplPlanOf,
  deeplUsage,
  openServiceCredential,
  readSecretBinding,
  sealServiceCredential,
  serviceCredentialRow,
  type DeeplKeySource,
  type DeeplKeyView,
  type DeeplPlan,
  type DeeplTestCode,
  type DeeplUsageResult,
  type ServiceCredentialRow,
} from '@al-ummah/shared-types';
import { resolveActionItems } from './errors-store';
import { logger } from './logger';
import type { D1Database } from './types';

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface DeeplKeyEnv {
  SEARCH_DB?: D1Database;
  REPORTS_DB: D1Database;
  INTERNAL_API_KEY?: SecretBinding;
  ENVIRONMENT?: string;
  /** Set by the router from api-videos' answer: a deployment AI_KEY_DEEPL secret is bound there */
  deeplBound?: boolean;
}

export interface Actor {
  id: string;
  name: string | null;
}

export class DeeplKeyUnavailable extends Error {}

function db(env: DeeplKeyEnv): D1Database {
  if (!env.SEARCH_DB) throw new DeeplKeyUnavailable('SEARCH_DB is not bound');
  return env.SEARCH_DB;
}

function testOf(row: ServiceCredentialRow): DeeplKeyView['test'] {
  if (!row.test_at || !row.test_code) return null;
  let detail: { characterCount?: unknown; characterLimit?: unknown } = {};
  try {
    detail = row.test_detail ? JSON.parse(row.test_detail) : {};
  } catch {
    detail = {};
  }
  return {
    ok: row.test_ok === 1,
    code: row.test_code as DeeplTestCode,
    characterCount: typeof detail.characterCount === 'number' ? detail.characterCount : null,
    characterLimit: typeof detail.characterLimit === 'number' ? detail.characterLimit : null,
    at: row.test_at,
  };
}

/**
 * What the page shows (never the key). `bound`: api-videos reports a deployment AI_KEY_DEEPL secret
 * (the older way, still the fallback); admin-api itself does not bind it.
 */
export async function deeplKeyView(env: DeeplKeyEnv, bound = env.deeplBound ?? false): Promise<DeeplKeyView> {
  const row = await serviceCredentialRow(env.SEARCH_DB, 'deepl');
  if (!row) return { set: false, last4: null, plan: null, updatedBy: null, updatedByName: null, updatedAt: null, test: null, source: bound ? 'binding' : null };
  const unreadable = (await openServiceCredential(row, await readSecretBinding(env.INTERNAL_API_KEY))) === null;
  const source: DeeplKeySource | null = unreadable ? (bound ? 'binding' : null) : 'admin';
  return {
    set: true,
    last4: row.last4 || null,
    plan: (row.plan as DeeplPlan | null) ?? null,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at,
    test: testOf(row),
    source,
    ...(unreadable ? { unreadable: true } : {}),
  };
}

async function storeTest(env: DeeplKeyEnv, result: Pick<DeeplUsageResult, 'ok' | 'code' | 'characterCount' | 'characterLimit'>, now: Date): Promise<void> {
  await db(env)
    .prepare("UPDATE service_credentials SET test_ok = ?, test_code = ?, test_detail = ?, test_at = ? WHERE provider = 'deepl'")
    .bind(result.ok ? 1 : 0, result.code, JSON.stringify({ characterCount: result.characterCount, characterLimit: result.characterLimit }), now.toISOString())
    .run();
}

/** A DeepL failure item on the Errors page is resolved once the key works again. Best effort. */
async function resolveFailures(env: DeeplKeyEnv, actor: Actor, now: Date): Promise<void> {
  try {
    await resolveActionItems(env.REPORTS_DB, env.ENVIRONMENT || 'development', [DEEPL_NEEDS_ACTION_KEY], now, actor.id);
  } catch (error) {
    logger.warn('[Captions] Could not resolve the DeepL needs-action item', { error: error instanceof Error ? error.name : 'error' });
  }
}

/** Seals and stores the key (replacing any), then tests it. The caller audits (last4 and plan only). */
export async function saveDeeplKey(env: DeeplKeyEnv, value: string, actor: Actor, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<{ view: DeeplKeyView; test: DeeplUsageResult; replaced: boolean; last4: string; plan: DeeplPlan }> {
  const before = await serviceCredentialRow(db(env), 'deepl');
  const sealed = await sealServiceCredential('deepl', value, await readSecretBinding(env.INTERNAL_API_KEY));
  const plan = deeplPlanOf(value);
  await db(env)
    .prepare(
      `INSERT INTO service_credentials (provider, ciphertext, iv, key_id, last4, plan, updated_by, updated_by_name, updated_at, test_ok, test_code, test_detail, test_at)
       VALUES ('deepl', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
       ON CONFLICT (provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, key_id = excluded.key_id, last4 = excluded.last4, plan = excluded.plan,
         updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at,
         test_ok = NULL, test_code = NULL, test_detail = NULL, test_at = NULL`,
    )
    .bind(sealed.ciphertext, sealed.iv, sealed.key_id, sealed.last4, plan, actor.id, actor.name, now.toISOString())
    .run();
  const test = await deeplUsage(value.trim(), fetchImpl);
  await storeTest(env, test, now);
  if (test.ok) await resolveFailures(env, actor, now);
  logger.info('[Captions] DeepL key set', { actorId: actor.id, plan, test: test.code, replaced: !!before });
  return { view: await deeplKeyView(env), test, replaced: !!before, last4: sealed.last4, plan };
}

/** Tests the stored key again (DeepL /v2/usage). null when none is set. */
export async function testDeeplKey(env: DeeplKeyEnv, actor: Actor, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<{ view: DeeplKeyView; test: DeeplUsageResult; last4: string } | null> {
  const row = await serviceCredentialRow(db(env), 'deepl');
  if (!row) return null;
  const value = await openServiceCredential(row, await readSecretBinding(env.INTERNAL_API_KEY));
  const test: DeeplUsageResult =
    value === null
      ? { ok: false, code: 'unreadable', plan: (row.plan as DeeplPlan) ?? 'pro', characterCount: null, characterLimit: null, status: 0 }
      : await deeplUsage(value, fetchImpl);
  await storeTest(env, test, now);
  if (test.ok) await resolveFailures(env, actor, now);
  logger.info('[Captions] DeepL key tested', { actorId: actor.id, test: test.code });
  return { view: await deeplKeyView(env), test, last4: row.last4 };
}

/** Removes the key; translation falls back to a bound AI_KEY_DEEPL secret, else Workers AI. */
export async function removeDeeplKey(env: DeeplKeyEnv, actor: Actor): Promise<{ removed: boolean; last4: string | null }> {
  const row = await serviceCredentialRow(db(env), 'deepl');
  if (!row) return { removed: false, last4: null };
  await db(env).prepare("DELETE FROM service_credentials WHERE provider = 'deepl'").run();
  logger.info('[Captions] DeepL key removed', { actorId: actor.id });
  return { removed: true, last4: row.last4 };
}

/** Plan and last test for the Costs page's DeepL line (no secret opened). */
export async function deeplKeySummary(env: { SEARCH_DB?: D1Database }): Promise<{ set: boolean; plan: DeeplPlan | null; test: DeeplKeyView['test'] }> {
  const row = await serviceCredentialRow(env.SEARCH_DB, 'deepl').catch(() => null);
  return row ? { set: true, plan: (row.plan as DeeplPlan | null) ?? null, test: testOf(row) } : { set: false, plan: null, test: null };
}
