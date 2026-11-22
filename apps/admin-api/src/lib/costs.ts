/**
 * The videos admin Costs page (COST-1): connections (the super admin's read-only Cloudflare token
 * and optional Bunny and Resend keys), alert settings, opt-in alert emails, and the dashboard
 * (month to date against the budget, forecast, per product and per environment, top movers).
 *
 * Keys are sealed with packages/shared-types cost-credentials.ts and stored in COSTS_DB
 * cost_credentials, where the cost-monitor collector opens them. admin-api opens one only to test
 * it. Nothing here ever returns, logs or audits a key: only its last four characters.
 */
import {
  COST_ALERT_KINDS,
  COST_PROVIDERS,
  mergeCostAlertSettings,
  openCostCredential,
  sealCostCredential,
  type CostAlertKind,
  type CostAlertSettings,
  type CostCredentialRow,
  type CostCredentialView,
  type CostProduct,
  type CostProvider,
} from '@al-ummah/shared-types';
import { logger } from './logger';
import {
  BASELINE_DAYS,
  PLAN_BASE_USD,
  planMtd,
  billIdle,
  costDrivers,
  costWindowStart,
  findSpikes,
  fullDays,
  idleProjection,
  loadBudget,
  loadCostSettings,
  loadProductDays,
  loadResourceDays,
  projectMonth,
  spikeRuleOf,
  sumByDay,
  trendBySource,
  type DayCost,
  type ResourceDay,
} from './opsCost';
import { apportionCents } from './opsCost';
export { apportionCents };
import { idleBilledCloudflare, STORAGE_METERS, type MeterUsage } from './cfBilling';
import { billLine, centsByDay, CF_METERS, fixedCostsDay, type CfMeterKey } from '@al-ummah/shared-types';
import type { D1Database } from './types';
import { loadD1Limits, parseD1LimitsInput } from './d1Capacity';
import type { D1Limits } from '@al-ummah/shared-types';
import { localTime, queueCostEmails, type CostDigest } from './cost-alert-mail';
import { auditOriginJson } from './request-origin';

export const CF_ACCOUNT_ID = '0e4b6e7f9faf280c3c9bf95995edc64f';
export const CF_API = 'https://api.cloudflare.com/client/v4';
export const CREDENTIAL_AUDIT_PREFIX = 'costs:credential:';
export const SETTINGS_AUDIT_KEY = 'costs:settings';
export const D1_LIMITS_AUDIT_KEY = 'costs:d1-limits';
export const SUBSCRIPTION_AUDIT_PREFIX = 'costs:subscription:';

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface CostsEnv {
  COSTS_DB?: D1Database;
  SEARCH_DB?: D1Database;
  REPORTS_DB: D1Database;
  INTERNAL_API_KEY?: SecretBinding;
  COST_CREDENTIALS_KEY?: SecretBinding;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** cost-monitor's job queue: "Check again" queues an hourly collection */
  COST_JOBS_QUEUE?: { send(body: unknown, opts?: { contentType?: string }): Promise<void> };
}

async function secret(binding: SecretBinding): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) ?? '';
  } catch {
    return '';
  }
}

const keySource = async (env: CostsEnv) => ({ INTERNAL_API_KEY: await secret(env.INTERNAL_API_KEY), COST_CREDENTIALS_KEY: await secret(env.COST_CREDENTIALS_KEY) });

export interface Actor {
  id: string;
  name: string | null;
}

async function audit(env: CostsEnv, key: string, before: unknown, after: unknown, actor: Actor, now: Date): Promise<void> {
  await env.REPORTS_DB.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), key, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), actor.id, now.toISOString(), auditOriginJson())
    .run();
}

// ---------------------------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------------------------

/** The stored code and checks of the last test; rows written before test_detail fall back to the message's code. */
function testDetailOf(row: CostCredentialRow): { code: string | null; checks: { name: string; ok: boolean }[] } {
  try {
    const d = row.test_detail ? (JSON.parse(row.test_detail) as { code?: unknown; checks?: unknown }) : {};
    const checks = Array.isArray(d.checks)
      ? d.checks.filter((c): c is { name: string; ok: boolean } => !!c && typeof c.name === 'string' && typeof c.ok === 'boolean').map((c) => ({ name: c.name, ok: c.ok }))
      : [];
    const code = typeof d.code === 'string' ? d.code : (row.test_message ?? '').split(':')[0]?.trim() || null;
    return { code, checks };
  } catch {
    return { code: null, checks: [] };
  }
}

function viewOf(provider: CostProvider, row: CostCredentialRow | undefined, unreadable = false): CostCredentialView {
  if (!row) return { provider, set: false, last4: null, updatedBy: null, updatedByName: null, updatedAt: null, test: null };
  return {
    provider,
    set: true,
    last4: row.last4 || null,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at,
    test: row.test_at ? { ok: row.test_ok === 1, ...testDetailOf(row), message: row.test_message ?? '', at: row.test_at } : null,
    ...(unreadable ? { unreadable: true } : {}),
  };
}

export async function listCredentials(env: CostsEnv): Promise<CostCredentialView[]> {
  const rows = ((await env.COSTS_DB!.prepare('SELECT * FROM cost_credentials').all<CostCredentialRow>()).results ?? []) as CostCredentialRow[];
  const keys = await keySource(env);
  return Promise.all(
    COST_PROVIDERS.map(async (p) => {
      const row = rows.find((r) => r.provider === p);
      const unreadable = row ? (await openCostCredential(row, keys)) === null : false;
      return viewOf(p, row, unreadable);
    }),
  );
}

async function credentialRow(env: CostsEnv, provider: CostProvider): Promise<CostCredentialRow | null> {
  return env.COSTS_DB!.prepare('SELECT * FROM cost_credentials WHERE provider = ?').bind(provider).first<CostCredentialRow>();
}

export interface TestResult {
  ok: boolean;
  /** Short English line for the audit and the stored row; the page shows `code` translated. */
  message: string;
  code: string;
  checks?: { name: string; ok: boolean }[];
}

const timeout = () => AbortSignal.timeout(10_000);

/** Read-only probes of what the collector needs from a Cloudflare token. */
export const CF_LISTINGS: { name: string; path: (a: string) => string }[] = [
  { name: 'workers', path: (a) => `/accounts/${a}/workers/scripts` },
  { name: 'd1', path: (a) => `/accounts/${a}/d1/database?per_page=1` },
  { name: 'kv', path: (a) => `/accounts/${a}/storage/kv/namespaces?per_page=1` },
  { name: 'r2', path: (a) => `/accounts/${a}/r2/buckets?per_page=1` },
  { name: 'queues', path: (a) => `/accounts/${a}/queues?per_page=1` },
  { name: 'containers', path: (a) => `/accounts/${a}/containers/applications` },
];

export async function testCloudflare(token: string, accountId: string, fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const auth = { Authorization: `Bearer ${token}` };
  let verify = await fetchImpl(`${CF_API}/user/tokens/verify`, { headers: auth, signal: timeout() });
  if (!verify.ok) verify = await fetchImpl(`${CF_API}/accounts/${accountId}/tokens/verify`, { headers: auth, signal: timeout() });
  const verified = (await verify.json().catch(() => ({}))) as { success?: boolean; result?: { status?: string } };
  if (!verify.ok || verified.success === false) return { ok: false, code: 'cf_invalid', message: `Cloudflare did not accept the token (HTTP ${verify.status})` };
  if (verified.result?.status && verified.result.status !== 'active') return { ok: false, code: 'cf_inactive', message: `The token is ${verified.result.status}` };
  const now = Date.now();
  const gql = await fetchImpl(`${CF_API}/graphql`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    signal: timeout(),
    body: JSON.stringify({
      query: 'query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){w:workersInvocationsAdaptive(limit:1,filter:{datetime_geq:$s,datetime_lt:$e}){sum{requests}}}}}',
      variables: { a: accountId, s: new Date(now - 3_600_000).toISOString(), e: new Date(now).toISOString() },
    }),
  });
  const g = (await gql.json().catch(() => ({}))) as { data?: unknown; errors?: unknown[] | null };
  const analytics = gql.ok && !!g.data && !(g.errors && g.errors.length);
  const checks: TestResult['checks'] = [{ name: 'analytics', ok: analytics }];
  for (const l of CF_LISTINGS) {
    const r = await fetchImpl(`${CF_API}${l.path(accountId)}`, { headers: auth, signal: timeout() }).catch(() => null);
    checks.push({ name: l.name, ok: !!r && r.ok });
  }
  if (!analytics) return { ok: false, code: 'cf_no_analytics', message: 'The token works but cannot read Account Analytics', checks };
  const missing = checks.filter((c) => !c.ok).map((c) => c.name);
  return missing.length
    ? { ok: true, code: 'cf_partial', message: `Analytics readable; cannot list ${missing.join(', ')}`, checks }
    : { ok: true, code: 'cf_ok', message: 'Analytics and every listing readable', checks };
}

export async function testBunny(key: string, fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const res = await fetchImpl('https://api.bunny.net/billing', { headers: { AccessKey: key, Accept: 'application/json' }, signal: timeout() });
  if (res.status === 401 || res.status === 403) return { ok: false, code: 'bunny_invalid', message: `Bunny did not accept the key (HTTP ${res.status})` };
  if (!res.ok) return { ok: false, code: 'bunny_unavailable', message: `Bunny answered HTTP ${res.status}` };
  const body = (await res.json().catch(() => ({}))) as { ThisMonthCharges?: unknown };
  if (typeof body.ThisMonthCharges !== 'number') return { ok: false, code: 'bunny_not_account', message: 'This key cannot read account billing (use the account API key)' };
  return { ok: true, code: 'bunny_ok', message: 'Account billing readable' };
}

export async function testResend(key: string, fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const res = await fetchImpl('https://api.resend.com/emails?limit=1', { headers: { Authorization: `Bearer ${key}` }, signal: timeout() });
  if (res.ok) return { ok: true, code: 'resend_ok', message: 'Sent emails readable' };
  const body = (await res.json().catch(() => ({}))) as { name?: string };
  if (res.status === 401 && body.name === 'restricted_api_key') return { ok: false, code: 'resend_sending_only', message: 'This is a sending-only key; counting sent emails needs a full-access key' };
  if (res.status === 401 || res.status === 403) return { ok: false, code: 'resend_invalid', message: `Resend did not accept the key (HTTP ${res.status})` };
  return { ok: false, code: 'resend_unavailable', message: `Resend answered HTTP ${res.status}` };
}

export async function testValue(env: CostsEnv, provider: CostProvider, value: string, fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  try {
    if (provider === 'cloudflare') return await testCloudflare(value, env.CLOUDFLARE_ACCOUNT_ID || CF_ACCOUNT_ID, fetchImpl);
    if (provider === 'bunny') return await testBunny(value, fetchImpl);
    return await testResend(value, fetchImpl);
  } catch (error) {
    logger.warn('[Costs] Connection test errored', { provider, error: error instanceof Error ? error.name : 'error' });
    return { ok: false, code: 'unreachable', message: 'Could not reach the provider' };
  }
}

async function storeTest(env: CostsEnv, provider: CostProvider, result: TestResult, now: Date): Promise<void> {
  await env.COSTS_DB!.prepare('UPDATE cost_credentials SET test_ok = ?, test_message = ?, test_at = ?, test_detail = ? WHERE provider = ?')
    .bind(result.ok ? 1 : 0, `${result.code}: ${result.message}`.slice(0, 300), now.toISOString(), JSON.stringify({ code: result.code, checks: result.checks ?? [] }), provider)
    .run();
}

/** Seals and stores a key (replacing any), tests it, audits who and when (last4 only). */
export async function saveCredential(env: CostsEnv, provider: CostProvider, value: string, actor: Actor, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<{ view: CostCredentialView; test: TestResult }> {
  const before = await credentialRow(env, provider);
  const sealed = await sealCostCredential(provider, value, await keySource(env));
  await audit(env, `${CREDENTIAL_AUDIT_PREFIX}${provider}`, before ? { set: true, last4: before.last4 } : { set: false }, { set: true, last4: sealed.last4, action: before ? 'replaced' : 'set' }, actor, now);
  await env.COSTS_DB!.prepare(
    `INSERT INTO cost_credentials (provider, ciphertext, iv, key_id, last4, updated_by, updated_by_name, updated_at, test_ok, test_message, test_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
     ON CONFLICT (provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, key_id = excluded.key_id, last4 = excluded.last4,
       updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at, test_ok = NULL, test_message = NULL, test_at = NULL, test_detail = NULL`,
  )
    .bind(provider, sealed.ciphertext, sealed.iv, sealed.key_id, sealed.last4, actor.id, actor.name, now.toISOString())
    .run();
  const test = await testValue(env, provider, value, fetchImpl);
  await storeTest(env, provider, test, now);
  logger.info('[Costs] Credential set', { provider, actorId: actor.id, test: test.code });
  return { view: viewOf(provider, (await credentialRow(env, provider))!), test };
}

/** Tests the stored key again. null when none is set. */
export async function retestCredential(env: CostsEnv, provider: CostProvider, actor: Actor, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<{ view: CostCredentialView; test: TestResult } | null> {
  const row = await credentialRow(env, provider);
  if (!row) return null;
  const value = await openCostCredential(row, await keySource(env));
  const test = value === null ? { ok: false, code: 'unreadable', message: 'The stored key can no longer be read; set it again' } : await testValue(env, provider, value, fetchImpl);
  await storeTest(env, provider, test, now);
  await audit(env, `${CREDENTIAL_AUDIT_PREFIX}${provider}`, null, { action: 'tested', ok: test.ok, code: test.code, last4: row.last4 }, actor, now);
  return { view: viewOf(provider, (await credentialRow(env, provider))!, value === null), test };
}

export async function removeCredential(env: CostsEnv, provider: CostProvider, actor: Actor, now = new Date()): Promise<boolean> {
  const row = await credentialRow(env, provider);
  if (!row) return false;
  await audit(env, `${CREDENTIAL_AUDIT_PREFIX}${provider}`, { set: true, last4: row.last4 }, { set: false, action: 'removed' }, actor, now);
  await env.COSTS_DB!.prepare('DELETE FROM cost_credentials WHERE provider = ?').bind(provider).run();
  logger.info('[Costs] Credential removed', { provider, actorId: actor.id });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Settings and subscriptions
// ---------------------------------------------------------------------------------------------

export async function saveSettings(env: CostsEnv, input: unknown, actor: Actor, now = new Date()): Promise<CostAlertSettings | string> {
  const current = await loadCostSettings(env.COSTS_DB);
  const next = mergeCostAlertSettings(current, input);
  if (typeof next === 'string') return next;
  await audit(env, SETTINGS_AUDIT_KEY, current, next, actor, now);
  await env.COSTS_DB!.prepare('INSERT INTO cost_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind('alerts', JSON.stringify(next), actor.id, now.toISOString())
    .run();
  return next;
}

/** Saves the D1 limits the capacity alerts judge against (cost_settings 'd1_limits'), audited. */
export async function saveD1Limits(env: CostsEnv, input: unknown, actor: Actor, now = new Date()): Promise<D1Limits | string> {
  const parsed = parseD1LimitsInput(input);
  if (typeof parsed === 'string') return parsed;
  const current = await loadD1Limits(env.COSTS_DB!);
  await audit(env, D1_LIMITS_AUDIT_KEY, current, parsed, actor, now);
  await env.COSTS_DB!.prepare('INSERT INTO cost_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind('d1_limits', JSON.stringify(parsed), actor.id, now.toISOString())
    .run();
  return parsed;
}

export interface MySubscription {
  kinds: CostAlertKind[];
  locale: 'en' | 'ar';
  email: string | null;
}

export async function mySubscription(env: CostsEnv, userId: string): Promise<MySubscription> {
  const rows = (await env.COSTS_DB!.prepare('SELECT kind, email, locale FROM cost_alert_subscriptions WHERE user_id = ?').bind(userId).all<{ kind: CostAlertKind; email: string; locale: 'en' | 'ar' }>()).results ?? [];
  return { kinds: COST_ALERT_KINDS.filter((k) => rows.some((r) => r.kind === k)), locale: rows[0]?.locale ?? 'en', email: rows[0]?.email ?? null };
}

/** Replaces the caller's own subscriptions (O24: opt-in, only for yourself, to your account's address). */
export async function setMySubscription(env: CostsEnv, actor: Actor & { email: string }, input: unknown, now = new Date()): Promise<MySubscription | string> {
  if (!input || typeof input !== 'object') return 'body must be an object';
  const b = input as { kinds?: unknown; locale?: unknown };
  if (!Array.isArray(b.kinds) || b.kinds.some((k) => !(COST_ALERT_KINDS as readonly string[]).includes(String(k)))) return `kinds must list some of ${COST_ALERT_KINDS.join(', ')}`;
  const locale = b.locale === 'ar' ? 'ar' : b.locale === undefined || b.locale === 'en' ? 'en' : null;
  if (!locale) return 'locale must be en or ar';
  const kinds = COST_ALERT_KINDS.filter((k) => (b.kinds as string[]).includes(k));
  const before = await mySubscription(env, actor.id);
  const db = env.COSTS_DB!;
  await db.batch([
    db.prepare('DELETE FROM cost_alert_subscriptions WHERE user_id = ?').bind(actor.id),
    ...kinds.map((k) => db.prepare('INSERT INTO cost_alert_subscriptions (user_id, kind, email, locale, created_at) VALUES (?, ?, ?, ?, ?)').bind(actor.id, k, actor.email, locale, now.toISOString())),
  ]);
  await audit(env, `${SUBSCRIPTION_AUDIT_PREFIX}${actor.id}`, { kinds: before.kinds, locale: before.locale }, { kinds, locale }, actor, now);
  return { kinds, locale, email: kinds.length ? actor.email : null };
}

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------

const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const KIND_PRODUCT: Record<string, CostProduct> = { worker: 'workers', d1: 'd1', kv: 'kv', r2: 'r2', queue: 'queues', do: 'durable_objects' };

export interface ProductLine {
  product: CostProduct;
  mtd: number;
  projected: number;
  last7: number;
  prev7: number;
}

export interface Mover {
  id: string;
  label: string;
  product: CostProduct;
  env: string;
  last7: number;
  prev7: number;
  change: number;
  /** The change carried over a month (×30/7), what it does to the projection. */
  monthlyImpact: number;
}

const sumDays = (list: DayCost[], days: string[]) => list.filter((d) => days.includes(d.day)).reduce((s, d) => s + num(d.cost), 0);

/** Per-product month to date, projection and the last 7 full days against the 7 before. */
export function productLines(resourceDays: ResourceDay[], extras: { bunny: DayCost[]; containers: DayCost[]; ai: DayCost[]; resend: DayCost[] }, now: Date, fixed: { mtd: number; projected: number } = { mtd: 0, projected: 0 }): ProductLine[] {
  const last = fullDays(now, BASELINE_DAYS);
  const prev = fullDays(new Date(Date.parse(`${last[0]}T12:00:00Z`)), BASELINE_DAYS);
  const series = new Map<CostProduct, DayCost[]>();
  for (const r of resourceDays) {
    const p = KIND_PRODUCT[r.kind];
    if (p) series.set(p, [...(series.get(p) ?? []), { day: r.day, cost: num(r.cost) }]);
  }
  series.set('containers', extras.containers);
  series.set('workers_ai', extras.ai);
  series.set('bunny', extras.bunny);
  series.set('resend', extras.resend);
  const out: ProductLine[] = [];
  for (const [product, list] of series) {
    const daily = sumByDay(list);
    const p = projectMonth(daily, now);
    out.push({ product, mtd: p.mtd, projected: p.trailing, last7: round2(sumDays(daily, last)), prev7: round2(sumDays(daily, prev)) });
  }
  // A Cloudflare product's weeks are the sums of its resources' weeks at cents, as Top movers
  // rounds each resource: the resource changes then add up to the product's change
  const weeks = new Map<string, { product: CostProduct; last7: number; prev7: number }>();
  for (const r of resourceDays) {
    const product = KIND_PRODUCT[r.kind];
    if (!product || (!last.includes(r.day) && !prev.includes(r.day))) continue;
    const w = weeks.get(r.resource_id) ?? { product, last7: 0, prev7: 0 };
    if (last.includes(r.day)) w.last7 += num(r.cost);
    else w.prev7 += num(r.cost);
    weeks.set(r.resource_id, w);
  }
  for (const line of out) {
    const mine = [...weeks.values()].filter((w) => w.product === line.product);
    if (!mine.length) continue;
    line.last7 = round2(mine.reduce((sum, w) => sum + round2(w.last7), 0));
    line.prev7 = round2(mine.reduce((sum, w) => sum + round2(w.prev7), 0));
  }
  const plan = projectMonth([], now);
  out.push({ product: 'plan', mtd: planMtd(now), projected: PLAN_BASE_USD, last7: round2((PLAN_BASE_USD * 7) / plan.daysInMonth), prev7: round2((PLAN_BASE_USD * 7) / plan.daysInMonth) });
  // Fixed and other costs: flat over the month, like the plan
  if (fixed.projected > 0) out.push({ product: 'fixed', mtd: round2(fixed.mtd), projected: round2(fixed.projected), last7: round2((fixed.projected * 7) / plan.daysInMonth), prev7: round2((fixed.projected * 7) / plan.daysInMonth) });
  return out.filter((l) => l.mtd > 0 || l.projected > 0 || l.last7 > 0 || l.prev7 > 0 || l.product === 'plan').sort((a, b) => b.mtd - a.mtd);
}

/** The Cloudflare invoice lines each Cloudflare product is made of. */
const PRODUCT_METERS: Partial<Record<CostProduct, readonly string[]>> = {
  workers: ['workers_requests', 'workers_cpu_ms', 'logs_events', 'logpush_requests'],
  d1: ['d1_rows_read', 'd1_rows_written', 'd1_storage_gb'],
  r2: ['r2_class_a', 'r2_class_b', 'r2_storage_gb'],
  kv: ['kv_reads', 'kv_writes', 'kv_lists', 'kv_deletes', 'kv_storage_gb'],
  durable_objects: ['do_requests', 'do_gb_seconds', 'do_storage_reads', 'do_storage_writes'],
  queues: ['queues_operations'],
};

/**
 * Each Cloudflare product's month to date as the sum of its lines at cents, the figures the
 * Cloudflare panel shows (the per-resource rows give the same total before rounding). Others keep
 * their own figure.
 */
export function withCloudflareLines(products: ProductLine[], lines: { key: string; listCost: number }[]): ProductLine[] {
  return products
    .map((p) => {
      const keys = PRODUCT_METERS[p.product];
      if (!keys) return p;
      const fromLines = lines.filter((l) => keys.includes(l.key));
      return fromLines.length ? { ...p, mtd: round2(fromLines.reduce((sum, l) => sum + l.listCost, 0)) } : p;
    })
    .sort((a, b) => b.mtd - a.mtd);
}


/**
 * Each Cloudflare invoice line's list price per UTC day of this month, in whole cents (centsByDay:
 * the running total rounded, so a line's month is its exact price rounded once): storage is that
 * day's size over the month's days (today's for the part the data covers), the rest is the day's
 * usage at list. A past day never changes and today's only grows, so every month-to-date
 * figure built from these cents (lines, products, resources, environments, the chart) only grows.
 */
export function lineDayCents(meterDays: Map<string, MeterUsage>, now: Date, coveredUntil: Date = now): Map<CfMeterKey, Map<string, number>> {
  const month = now.toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const todayStart = Date.parse(`${today}T00:00:00Z`);
  const todayShare = Math.max(0, Math.min(1, (Math.min(coveredUntil.getTime(), now.getTime()) - todayStart) / 86_400_000));
  const usd = new Map<CfMeterKey, [string, number][]>();
  for (const [day, usage] of meterDays) {
    if (!day.startsWith(month) || day > today) continue;
    for (const [k, v] of Object.entries(usage) as [CfMeterKey, number][]) {
      if (!(k in CF_METERS)) continue;
      const used = STORAGE_METERS.includes(k) ? (num(v) * (day === today ? todayShare : 1)) / daysInMonth : num(v);
      const list = usd.get(k) ?? [];
      list.push([day, billLine(k, used).listCost]);
      usd.set(k, list);
    }
  }
  // Per day without drift: a line's month is its exact list price rounded once
  return new Map([...usd].map(([k, days]) => [k, centsByDay(days)]));
}

/**
 * One day of a product, in cents, over that day's resources: each resource is rounded on its own
 * (`ownCents`, its own running month rounded per day; else the day rounded), so a resource's day
 * only grows with its own usage, whatever the others do, and the day's largest
 * resource takes the few cents of rounding and today's storage accrual. When that would leave the
 * largest below zero, the day is split by largest remainder instead.
 */
export function splitDayCents(totalCents: number, weights: Map<string, number>, ownCents?: Map<string, number>): Map<string, number> {
  const own = new Map([...weights].map(([id, w]) => [id, ownCents?.get(id) ?? Math.round(w * 100)]));
  let largest: string | null = null;
  for (const [id, w] of weights) if (largest === null || w > weights.get(largest)! || (w === weights.get(largest)! && id < largest)) largest = id;
  if (largest === null) return own;
  const rest = totalCents - [...own.values()].reduce((a, b) => a + b, 0);
  const top = own.get(largest)! + rest;
  if (top < 0) return apportionCents(totalCents, weights);
  own.set(largest, top);
  return own;
}

/**
 * The page's Cloudflare cents, one cell per resource and UTC day of this month: each product's day
 * (the sum of its invoice lines that day, lineDayCents) split over that day's resources
 * (splitDayCents). A product's resources add up to the product and an environment to its
 * resources, every day and so every month to date; past days are fixed, so nothing steps back.
 * Cents of a day with no resource of ours stay account-wide.
 */
export function resourceDayCents(resourceDays: ResourceDay[], lineCents: Map<CfMeterKey, Map<string, number>>, now: Date): { rows: Map<string, { env: string; product: CostProduct; usd: number }>; envDays: Map<string, Map<string, number>> } {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const weights = new Map<string, Map<string, number>>();
  const meta = new Map<string, { env: string; product: CostProduct }>();
  for (const r of resourceDays) {
    const product = KIND_PRODUCT[r.kind];
    if (!product || r.day < monthStart) continue;
    const key = `${product}|${r.day}`;
    const w = weights.get(key) ?? new Map<string, number>();
    w.set(r.resource_id, (w.get(r.resource_id) ?? 0) + num(r.cost));
    weights.set(key, w);
    meta.set(r.resource_id, { env: r.env, product });
  }
  const totals = new Map<string, number>();
  for (const [product, keys] of Object.entries(PRODUCT_METERS) as [CostProduct, readonly string[]][]) {
    for (const k of keys) for (const [day, c] of lineCents.get(k as CfMeterKey) ?? []) totals.set(`${product}|${day}`, (totals.get(`${product}|${day}`) ?? 0) + c);
  }
  const cents = new Map<string, number>();
  const envDays = new Map<string, Map<string, number>>();
  const add = (env: string, day: string, c: number) => {
    const m = envDays.get(env) ?? new Map<string, number>();
    m.set(day, (m.get(day) ?? 0) + c);
    envDays.set(env, m);
  };
  // Each resource's own cents per day, without drift (its month to date is its own exact cost rounded once)
  const rawByResource = new Map<string, [string, number][]>();
  for (const [key, w] of weights) for (const [id, usd] of w) (rawByResource.get(id) ?? rawByResource.set(id, []).get(id)!).push([key.split('|')[1]!, usd]);
  const ownByResource = new Map([...rawByResource].map(([id, days]) => [id, centsByDay(days)]));
  const unattributed = new Map<CostProduct, number>();
  for (const [key, total] of totals) {
    const [product, day] = key.split('|') as [CostProduct, string];
    const w = weights.get(key);
    if (!w?.size) {
      if (total) unattributed.set(product, (unattributed.get(product) ?? 0) + total);
      if (total) add('account', day, total);
      continue;
    }
    const day0 = key.split('|')[1]!;
    for (const [id, c] of splitDayCents(total, w, new Map([...w.keys()].map((id) => [id, ownByResource.get(id)?.get(day0) ?? 0])))) {
      cents.set(id, (cents.get(id) ?? 0) + c);
      add(meta.get(id)!.env, day, c);
    }
  }
  const rows = new Map<string, { env: string; product: CostProduct; usd: number }>();
  for (const [id, c] of cents) rows.set(id, { ...meta.get(id)!, usd: c / 100 });
  // Account-wide cents of a product: a row with no resource, under 'account' (envsFromRows)
  for (const [product, c] of unattributed) rows.set(`account:${product}`, { env: 'account', product, usd: c / 100 });
  return { rows, envDays };
}

/**
 * Month to date per environment from the rows the page shows: each resource's share (resourceMtds)
 * plus Containers (per env when billing splits it, else production), and the account-wide products
 * (Bunny, Workers AI, Resend, the plan, fixed) under 'account'. Adds up to the products exactly.
 */
export function envsFromRows(rows: Map<string, { env: string; product: CostProduct; usd: number }>, products: ProductLine[], productDays: { day: string; env: string; product: string; cost: number }[], containersSource: string, now: Date): Record<string, number> {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const cents: Record<string, number> = { production: 0, stage: 0, qa: 0, account: 0 };
  const split = new Set<CostProduct>();
  for (const r of rows.values()) {
    cents[r.env in cents ? r.env : 'account']! += Math.round(r.usd * 100);
    split.add(r.product);
  }
  for (const p of products) {
    if (split.has(p.product)) continue;
    const total = Math.round(p.mtd * 100);
    if (p.product !== 'containers') {
      // Account-wide: Bunny, Workers AI, Resend, the plan, fixed (and a Cloudflare line with no resource of ours)
      cents.account! += total;
      continue;
    }
    const weights = new Map<string, number>();
    if (containersSource === 'billing') for (const d of productDays) if (d.product === 'containers' && d.day >= monthStart && d.env in cents) weights.set(d.env, (weights.get(d.env) ?? 0) + num(d.cost));
    if (weights.size === 0) weights.set('production', 1);
    for (const [e, c] of apportionCents(total, weights)) cents[e]! += c;
  }
  return Object.fromEntries(Object.entries(cents).map(([k, v]) => [k, v / 100]));
}

/** Month to date per environment; account-wide costs (Bunny, Workers AI, Resend, the plan) under 'account'. */
export function envLines(resourceDays: ResourceDay[], productDays: { day: string; env: string; product: string; cost: number }[], extras: { bunny: DayCost[]; ai: DayCost[]; resend: DayCost[]; containers: DayCost[]; sources: { containers: string } }, now: Date, fixedMtd = 0): Record<string, number> {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const out: Record<string, number> = { production: 0, stage: 0, qa: 0, account: 0 };
  for (const r of resourceDays) if (r.day >= monthStart && r.env in out) out[r.env]! += num(r.cost);
  if (extras.sources.containers === 'billing') {
    for (const p of productDays) if (p.product === 'containers' && p.day >= monthStart && p.env in out) out[p.env]! += num(p.cost);
  } else {
    out.production! += extras.containers.filter((d) => d.day >= monthStart).reduce((s, d) => s + d.cost, 0);
  }
  for (const list of [extras.bunny, extras.ai, extras.resend]) out.account! += list.filter((d) => d.day >= monthStart).reduce((s, d) => s + d.cost, 0);
  out.account! += planMtd(now) + fixedMtd;
  for (const k of Object.keys(out)) out[k] = round2(out[k]!);
  return out;
}

/** Biggest changes, last 7 full days against the 7 before, per resource and per non-Cloudflare product. */
export function topMovers(resourceDays: ResourceDay[], products: ProductLine[], now: Date, limit = 8): { up: Mover[]; down: Mover[] } {
  const last = fullDays(now, BASELINE_DAYS);
  const prev = fullDays(new Date(Date.parse(`${last[0]}T12:00:00Z`)), BASELINE_DAYS);
  const byRes = new Map<string, Mover>();
  for (const r of resourceDays) {
    const inLast = last.includes(r.day);
    if (!inLast && !prev.includes(r.day)) continue;
    const m = byRes.get(r.resource_id) ?? { id: r.resource_id, label: r.name, product: KIND_PRODUCT[r.kind] ?? 'workers', env: r.env, last7: 0, prev7: 0, change: 0, monthlyImpact: 0 };
    if (inLast) m.last7 += num(r.cost);
    else m.prev7 += num(r.cost);
    byRes.set(r.resource_id, m);
  }
  const list: Mover[] = [...byRes.values()];
  for (const p of products) {
    if (!['containers', 'workers_ai', 'bunny', 'resend'].includes(p.product)) continue;
    list.push({ id: `product:${p.product}`, label: p.product, product: p.product, env: p.product === 'containers' ? 'production' : 'account', last7: p.last7, prev7: p.prev7, change: 0, monthlyImpact: 0 });
  }
  for (const m of list) {
    m.last7 = round2(m.last7);
    m.prev7 = round2(m.prev7);
    m.change = round2(m.last7 - m.prev7);
    m.monthlyImpact = round2((m.change / 7) * 30);
  }
  const moving = list.filter((m) => Math.abs(m.change) >= 0.01);
  return {
    up: moving.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, limit),
    down: moving.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, limit),
  };
}

/**
 * Whether Cloudflare lets the collector read Account Analytics: 'refused' when the latest hourly
 * run failed (or came back partial) with an authentication or permission answer, or the admin
 * token's own test said it cannot read analytics. The Costs page then names the missing
 * permission instead of letting the zeros pass for real figures.
 */
export interface CollectorAnalytics {
  state: 'ok' | 'refused' | 'unknown';
  /** When that was seen (the run's or the test's time). */
  at: string | null;
  /** 'run': the hourly collection was refused; 'test': the admin token's test was. */
  via: 'run' | 'test' | null;
}

export interface CollectorState {
  tokenSource: 'admin' | 'release' | 'none' | 'unknown';
  at: string | null;
  lastJobFailures: { job: string; at: string; detail: string | null }[];
  analytics: CollectorAnalytics;
}

/** Cloudflare's answers to a token without the permission: HTTP 401/403, code 10000, "not authorized". */
const REFUSED = /HTTP 40[13]\b|\b10000\b|authenticat|not authori[sz]ed|unauthori[sz]ed|permission|forbidden/i;

/** A finished hourly run (collector_runs) → refused, ok, or nothing to say. */
export function analyticsFromRun(run: { status: string; detail: string | null; finished_at: string | null } | null): CollectorAnalytics {
  if (!run) return { state: 'unknown', at: null, via: null };
  let detail: { error?: unknown; errors?: unknown } = {};
  try {
    detail = run.detail ? JSON.parse(run.detail) : {};
  } catch {
    detail = {};
  }
  const said = [detail.error, ...(Array.isArray(detail.errors) ? detail.errors : [])].filter((x) => typeof x === 'string').join(' ');
  if ((run.status === 'failed' || run.status === 'partial') && REFUSED.test(said)) return { state: 'refused', at: run.finished_at, via: 'run' };
  return { state: run.status === 'ok' ? 'ok' : 'unknown', at: run.finished_at, via: run.status === 'ok' ? 'run' : null };
}

export async function collectorState(env: CostsEnv): Promise<CollectorState> {
  const db = env.COSTS_DB!;
  const row = await db.prepare("SELECT value FROM cost_settings WHERE key = 'collector'").first<{ value: string }>().catch(() => null);
  let parsed: { tokenSource?: CollectorState['tokenSource']; at?: string } = {};
  try {
    parsed = row?.value ? JSON.parse(row.value) : {};
  } catch {
    parsed = {};
  }
  const failures = (await db
    .prepare("SELECT job, finished_at AS at, detail FROM cost_job_runs WHERE status = 'failed' AND started_at >= ? ORDER BY started_at DESC LIMIT 5")
    .bind(new Date(Date.now() - 2 * 86_400_000).toISOString())
    .all<{ job: string; at: string; detail: string | null }>()
    .catch(() => ({ results: [] }))).results ?? [];
  const run = await db
    .prepare("SELECT status, detail, finished_at FROM collector_runs WHERE kind = 'hourly' AND status != 'running' ORDER BY started_at DESC LIMIT 1")
    .first<{ status: string; detail: string | null; finished_at: string | null }>()
    .catch(() => null);
  let analytics = analyticsFromRun(run);
  // The admin token's last test, when it is newer and said the token cannot read analytics
  const test = await db
    .prepare("SELECT test_message, test_at FROM cost_credentials WHERE provider = 'cloudflare'")
    .first<{ test_message: string | null; test_at: string | null }>()
    .catch(() => null);
  const testCode = (test?.test_message ?? '').split(':')[0]?.trim();
  if (test?.test_at && (testCode === 'cf_no_analytics' || testCode === 'cf_invalid' || testCode === 'cf_inactive') && (!analytics.at || test.test_at >= analytics.at)) {
    analytics = { state: 'refused', at: test.test_at, via: 'test' };
  }
  return { tokenSource: parsed.tokenSource ?? 'unknown', at: parsed.at ?? null, lastJobFailures: failures, analytics };
}

/**
 * "Check again" on the Costs page: queues an hourly collection now (idempotent: every write is an
 * upsert of an hour), and re-tests the admin token when one is set. The page reads the outcome on
 * its next load; the run takes a minute or two.
 */
export async function checkCollectorAgain(env: CostsEnv, actor: Actor, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<{ queued: boolean; tested: boolean }> {
  let queued = false;
  if (env.COST_JOBS_QUEUE) {
    try {
      await env.COST_JOBS_QUEUE.send({ v: 1, job: 'hourly', at: now.toISOString() }, { contentType: 'json' });
      queued = true;
    } catch (error) {
      logger.warn('[Costs] Could not queue the hourly collection', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
  }
  const tested = !!(await retestCredential(env, 'cloudflare', actor, fetchImpl, now).catch(() => null));
  logger.info('[Costs] Collector check requested', { actorId: actor.id, queued, tested });
  return { queued, tested };
}

export async function costsDashboard(env: CostsEnv, now = new Date()) {
  const settings = await loadCostSettings(env.COSTS_DB);
  const since = costWindowStart(now);
  // Movers compare 14 full days: make sure the window reaches back that far
  const back14 = new Date(now.getTime() - 15 * 86_400_000).toISOString().slice(0, 10);
  const from = back14 < since ? back14 : since;
  const [resourceDays, productDays] = await Promise.all([loadResourceDays(env, from), loadProductDays(env, from)]);
  const { budget, billed, fixed, extras, meterDays, coveredUntil } = await loadBudget(env, now, settings, from, { resourceDays, productDays });
  // Cloudflare at list, one rounding per invoice line and UTC day: every list figure below sums these
  const dayCents = lineDayCents(meterDays, now, coveredUntil);
  const lineCents = (key: CfMeterKey) => [...(dayCents.get(key)?.values() ?? [])].reduce((a, b) => a + b, 0);
  // Cloudflare as the page shows it: each invoice line at cents. The list tile and each Cloudflare
  // product are sums of these same rounded lines, so every displayed total adds up to the cent
  const cfLines = billed.mtd.lines
    .map((l) => ({
      key: l.key,
      used: l.used,
      included: l.included,
      billable: l.billable,
      cost: l.cost,
      listCost: lineCents(l.key) / 100,
      projectedCost: billed.projected.lines.find((p) => p.key === l.key)?.cost ?? 0,
      source: CF_METERS[l.key].source,
      billed: (CF_METERS[l.key] as { billed?: boolean }).billed !== false,
    }))
    .filter((l) => l.used > 0 || l.source === 'none');
  const products = withCloudflareLines(productLines(resourceDays, extras, now, fixed), cfLines);
  // Each resource's month to date as shown: its product's total split over the product's resources
  const { rows, envDays } = resourceDayCents(resourceDays, dayCents, now);
  const spikes = findSpikes(resourceDays, now, spikeRuleOf(settings));
  const idle = billIdle(idleProjection(resourceDays, extras, now, fixed.projected), idleBilledCloudflare(meterDays, now));
  // A fixed cost's day: its month's share for that one day, when it is active then
  const fixedDaily = (day: string) => fixedCostsDay(fixed.items, day);
  // A day with no resource of ours (account-wide Cloudflare cents) is drawn with production
  const chartEnvDays = new Map(envDays);
  for (const [day, c] of envDays.get('account') ?? []) {
    const m = new Map(chartEnvDays.get('production') ?? []);
    m.set(day, (m.get(day) ?? 0) + c);
    chartEnvDays.set('production', m);
  }
  const trend = trendBySource(resourceDays, extras, fixedDaily, now, chartEnvDays);
  const openAlerts = (await env.COSTS_DB!.prepare('SELECT key, value, opened_at FROM ops_cost_alerts ORDER BY opened_at DESC').all<{ key: string; value: number; opened_at: string }>().catch(() => ({ results: [] }))).results ?? [];
  // Data as of the last collection that brought Cloudflare's figures: a run Cloudflare refused
  // (even one that finished "partial" with the other sources) adds none, so it doesn't move the date
  const recentRuns = (await env.COSTS_DB!
    .prepare("SELECT status, detail, finished_at FROM collector_runs WHERE kind = 'hourly' AND status IN ('ok', 'partial') ORDER BY started_at DESC LIMIT 48")
    .all<{ status: string; detail: string | null; finished_at: string | null }>()
    .catch(() => ({ results: [] }))).results ?? [];
  const lastRun = recentRuns.find((r) => analyticsFromRun(r).state !== 'refused') ?? null;
  const nonCloudflareLinear = projectMonth(sumByDay([...extras.bunny, ...extras.containers, ...extras.ai, ...extras.resend]), now).linear;
  return {
    budget,
    // Linear: the month so far scaled to the whole month; trailing: the last 7 full days carried forward (drives alerts)
    forecast: { linear: round2(nonCloudflareLinear + billed.linear.total + PLAN_BASE_USD + fixed.projected), trailing: budget.projected },
    products,
    envs: envsFromRows(rows, products, productDays, extras.sources.containers, now),
    movers: topMovers(resourceDays, products, now),
    spikes: spikes.slice(0, 10),
    // The daily total (every source), and the same days per env and source for the stacked chart
    trend: { days: trend.days, values: trend.days.map((_, i) => round2(trend.series.reduce((s, x) => s + x.values[i]!, 0))), series: trend.series },
    // Cloudflare at list price against what it bills after the account's included usage
    cloudflare: {
      billedMtd: round2(cfLines.reduce((sum, l) => sum + l.cost, 0)),
      billedProjected: round2(cfLines.reduce((sum, l) => sum + l.projectedCost, 0)),
      listMtd: round2(cfLines.reduce((sum, l) => sum + l.listCost, 0)),
      lines: cfLines,
    },
    fixed: { items: fixed.items, mtd: fixed.mtd, projected: fixed.projected },
    idle,
    drivers: costDrivers(resourceDays, idle, spikes, now, rows),
    sources: extras.sources,
    alerts: openAlerts,
    settings,
    collector: await collectorState(env),
    dataAsOf: lastRun?.finished_at ?? null,
    estimated: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Weekly digest (admin-api hourly tick)
// ---------------------------------------------------------------------------------------------

/**
 * On the settings' weekday and hour (owner's time zone), queues the digest to its subscribers.
 * Idempotent per local date (cost_alert_deliveries), so a repeated tick sends nothing twice.
 */
export async function runWeeklyDigest(env: CostsEnv & Parameters<typeof queueCostEmails>[0], now = new Date()): Promise<number> {
  if (!env.COSTS_DB) return 0;
  const settings = await loadCostSettings(env.COSTS_DB);
  if (!settings.digestEnabled) return 0;
  const t = localTime(now);
  if (t.weekday !== settings.digestWeekday || t.hour !== settings.digestHour) return 0;
  const subs = await env.COSTS_DB.prepare("SELECT COUNT(*) AS n FROM cost_alert_subscriptions WHERE kind = 'digest'").first<{ n: number }>();
  if (!subs?.n) return 0;
  const d = await costsDashboard(env, now);
  const payload: CostDigest = {
    type: 'digest',
    week: t.date,
    mtd: d.budget.mtd,
    cap: d.budget.capUsd,
    projected: d.budget.projected,
    lastWeek: round2(d.products.reduce((s, p) => s + p.last7, 0)),
    weekBefore: round2(d.products.reduce((s, p) => s + p.prev7, 0)),
    products: d.products.slice(0, 5).map((p) => ({ product: p.product, mtd: p.mtd })),
    envs: d.envs,
    movers: d.movers.up.slice(0, 5).map((m) => ({ label: m.label, env: m.env, change: m.change })),
    openAlerts: d.alerts.length,
  };
  return queueCostEmails(env, 'digest', `digest:${t.date}`, payload, now);
}
