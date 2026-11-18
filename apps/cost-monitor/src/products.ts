/**
 * Per-product daily usage beyond ops_daily (COST-1), written to cost_product_daily:
 *
 *   containers  Cloudflare GraphQL containersUsageAdaptiveGroups for our applications (the dataset
 *               Cloudflare bills: memory and disk while an instance runs, CPU as used), per env
 *   bunny       Bunny account billing (GET /billing ThisMonthCharges): the day's row is the month so
 *               far minus the month's earlier rows, so a month's rows always add up to Bunny's figure
 *   resend      emails sent per day (GET /emails, full-access key), priced from the plan in settings
 *
 * Every function takes fetchImpl so the tests run on recorded fixtures. Keys stay in memory; only
 * counts and HTTP statuses are logged or stored.
 */
import { RESEND_PLANS, type CostEnv, type ResendPlan } from '@al-ummah/shared-types';
import { CF_API } from './discover';
import { GRAPHQL_URL } from './graphql';
import { envOfName, isAlUmmahName } from './manifest';

/** Containers list prices (Workers Paid, 2026-11), USD per unit-second; same as scripts/ops/usage-report.ts. */
export const CONTAINER_PRICES = { gibSecond: 0.0000025, vcpuSecond: 0.00002, gbSecond: 0.00000007 } as const;

export interface ProductRow {
  day: string;
  env: CostEnv;
  product: 'containers' | 'bunny' | 'resend';
  quantity: number;
  unit: string;
  cost: number;
  source: string;
}

export class ProductFetchError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** HTTP status of the refused call, when there was one */
    readonly status?: number,
  ) {
    super(message);
  }
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const dayEnd = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().replace('.000Z', 'Z');

function httpError(what: string, status: number): ProductFetchError {
  return new ProductFetchError(`${what} answered HTTP ${status}`, status === 429 || status >= 500, status);
}

// ---------------------------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------------------------

export const CONTAINERS_QUERY = `query Containers($a: String!, $s: Time!, $e: Time!) {
  viewer { accounts(filter: { accountTag: $a }) {
    c: containersUsageAdaptiveGroups(limit: 2000, filter: { datetime_geq: $s, datetime_lt: $e }) {
      dimensions { applicationId date }
      sum { cpuTimeSec allocatedMemory allocatedDisk }
    }
  } }
}`;

interface ContainerUsage {
  dimensions: { applicationId: string; date: string };
  sum: { cpuTimeSec: number; allocatedMemory: number; allocatedDisk: number };
}

/** Prices one day of container usage per env; rows of applications that are not ours are dropped. */
export function priceContainers(day: string, rows: ContainerUsage[], apps: Map<string, string>): ProductRow[] {
  const byEnv = new Map<CostEnv, { vcpu: number; cost: number }>();
  for (const r of rows) {
    const name = apps.get(String(r.dimensions.applicationId));
    const env = name ? (envOfName(name) as CostEnv | null) : null;
    if (!name || !env || r.dimensions.date !== day) continue;
    const gibSec = num(r.sum.allocatedMemory) / 1024 ** 3;
    const gbSec = num(r.sum.allocatedDisk) / 1e9;
    const vcpu = num(r.sum.cpuTimeSec);
    const cost = gibSec * CONTAINER_PRICES.gibSecond + vcpu * CONTAINER_PRICES.vcpuSecond + gbSec * CONTAINER_PRICES.gbSecond;
    const e = byEnv.get(env) ?? { vcpu: 0, cost: 0 };
    e.vcpu += vcpu;
    e.cost += cost;
    byEnv.set(env, e);
  }
  return [...byEnv].map(([env, e]) => ({ day, env, product: 'containers', quantity: round6(e.vcpu), unit: 'vCPU-s', cost: round6(e.cost), source: 'cloudflare-graphql' }));
}

export async function fetchContainers(token: string, accountId: string, day: string, envs: readonly string[], fetchImpl: typeof fetch): Promise<ProductRow[]> {
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetchImpl(`${CF_API}/accounts/${accountId}/containers/applications`, { headers: auth });
  if (list.status === 403 || list.status === 404) return []; // no Containers access on this token, or none on the account
  if (!list.ok) throw httpError('Containers list', list.status);
  const listed = ((await list.json().catch(() => ({}))) as { result?: { id?: string; name?: string }[] }).result ?? [];
  const apps = new Map<string, string>();
  for (const a of listed) {
    const name = String(a.name ?? '');
    const env = envOfName(name);
    if (a.id && env && isAlUmmahName(name) && envs.includes(env)) apps.set(String(a.id), name);
  }
  if (!apps.size) return [];
  const res = await fetchImpl(GRAPHQL_URL, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CONTAINERS_QUERY, variables: { a: accountId, s: `${day}T00:00:00Z`, e: dayEnd(day) } }),
  });
  if (!res.ok) throw httpError('Cloudflare GraphQL', res.status);
  const body = (await res.json().catch(() => ({}))) as { data?: { viewer?: { accounts?: { c?: ContainerUsage[] }[] } } | null; errors?: { message?: string }[] | null };
  if (!body.data && body.errors?.length) throw new ProductFetchError(`Cloudflare GraphQL: ${String(body.errors[0]?.message ?? 'error').slice(0, 160)}`, false);
  return priceContainers(day, body.data?.viewer?.accounts?.[0]?.c ?? [], apps);
}

// ---------------------------------------------------------------------------------------------
// Bunny
// ---------------------------------------------------------------------------------------------

export const BUNNY_BILLING_URL = 'https://api.bunny.net/billing';

/**
 * The day's Bunny cost: this month's charges so far minus what the month's earlier rows already
 * hold (never negative; a credit shows as 0).
 */
export function bunnyDayRow(day: string, monthCharges: number, earlierInMonth: number): ProductRow {
  return { day, env: 'account', product: 'bunny', quantity: round6(monthCharges), unit: 'usd-month-to-date', cost: round6(Math.max(0, monthCharges - earlierInMonth)), source: 'bunny-billing' };
}

export async function fetchBunnyMonthCharges(key: string, fetchImpl: typeof fetch): Promise<number> {
  const res = await fetchImpl(BUNNY_BILLING_URL, { headers: { AccessKey: key, Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new ProductFetchError('Bunny refused the key (HTTP ' + res.status + ')', false);
  if (!res.ok) throw httpError('Bunny billing', res.status);
  const body = (await res.json().catch(() => ({}))) as { ThisMonthCharges?: unknown };
  if (typeof body.ThisMonthCharges !== 'number') throw new ProductFetchError('Bunny billing had no ThisMonthCharges', false);
  return body.ThisMonthCharges;
}

// ---------------------------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------------------------

export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
/** At most this many pages of 100 per run (Resend allows 2 requests a second). */
export const RESEND_MAX_PAGES = 60;

interface ResendList {
  data?: { id: string; created_at: string }[];
  has_more?: boolean;
}

/** Resend timestamps look like '2026-11-13 23:59:10.123456+00' (Postgres style); NaN when unreadable. */
export function parseResendTime(text: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/.exec(String(text).trim());
  if (!m) return Date.parse(text);
  const ms = m[3] ? m[3].slice(0, 4) : '';
  let zone = m[4] ?? 'Z';
  if (/^[+-]\d{2}$/.test(zone)) zone += ':00';
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return Date.parse(`${m[1]}T${m[2]}${ms}${zone}`);
}

/** Emails created on `day` (UTC), paging newest first until the list is older than the day. */
export async function countResendEmails(key: string, day: string, fetchImpl: typeof fetch, pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ count: number; complete: boolean }> {
  const start = Date.parse(`${day}T00:00:00Z`);
  const end = start + 86_400_000;
  let after: string | undefined;
  let count = 0;
  for (let page = 0; page < RESEND_MAX_PAGES; page++) {
    if (page > 0) await pause(550);
    const url = `${RESEND_EMAILS_URL}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) throw new ProductFetchError('Resend refused the key; listing emails needs a full-access key (HTTP ' + res.status + ')', false);
    if (!res.ok) throw httpError('Resend emails', res.status);
    const body = (await res.json().catch(() => ({}))) as ResendList;
    const items = body.data ?? [];
    for (const e of items) {
      const t = parseResendTime(e.created_at);
      if (t >= start && t < end) count++;
    }
    const oldest = items.length ? parseResendTime(items[items.length - 1]!.created_at) : 0;
    if (!body.has_more || !items.length || oldest < start) return { count, complete: true };
    after = items[items.length - 1]!.id;
  }
  return { count, complete: false };
}

/**
 * The day's Resend cost: the plan fee spread over the month's days, plus the overage this day
 * added (emails over the plan's monthly allowance, counting the month's earlier days first).
 */
export function resendDayRow(day: string, emails: number, earlierEmailsInMonth: number, plan: ResendPlan): ProductRow {
  const p = RESEND_PLANS[plan] ?? RESEND_PLANS.free;
  const d = new Date(`${day}T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const over = (n: number) => Math.max(0, n - p.included);
  const overage = ((over(earlierEmailsInMonth + emails) - over(earlierEmailsInMonth)) / 1000) * p.overagePer1000;
  return { day, env: 'account', product: 'resend', quantity: emails, unit: 'emails', cost: round6(p.monthlyUsd / daysInMonth + overage), source: 'resend-emails' };
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

export async function upsertProductRows(db: D1Database, rows: ProductRow[], now: Date): Promise<number> {
  if (!rows.length) return 0;
  const sql = `INSERT INTO cost_product_daily (day, env, product, quantity, unit, cost_usd, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (day, env, product) DO UPDATE SET quantity = excluded.quantity, unit = excluded.unit, cost_usd = excluded.cost_usd, source = excluded.source, updated_at = excluded.updated_at`;
  await db.batch(rows.map((r) => db.prepare(sql).bind(r.day, r.env, r.product, r.quantity, r.unit, r.cost, r.source, now.toISOString())));
  return rows.length;
}

/** Sum of a product's cost (or quantity) on the month's days before `day`. */
export async function monthBefore(db: D1Database, product: string, day: string, column: 'cost_usd' | 'quantity'): Promise<number> {
  const row = await db
    .prepare(`SELECT SUM(${column === 'cost_usd' ? 'cost_usd' : 'quantity'}) AS v FROM cost_product_daily WHERE product = ? AND env = 'account' AND day >= ? AND day < ?`)
    .bind(product, `${day.slice(0, 7)}-01`, day)
    .first<{ v: number | null }>();
  return num(row?.v);
}
