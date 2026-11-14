/**
 * Discovery of al-ummah resources on the shared account, so the collector covers every app (videos,
 * Auth, CMS, www/sites) and every new Worker, database, namespace, bucket or queue without a code
 * change. The daily run lists them through the REST API (GET only) and keeps only al-ummah names
 * (manifest isAlUmmahName) of the envs this deployment collects; the hourly run filters GraphQL
 * with `_in` to them. A failed listing leaves the stored set as it was.
 */
import { envOfName, isAlUmmahName, type OpsEnv, type Resource } from './manifest';

export const CF_API = 'https://api.cloudflare.com/client/v4';
/** A resource not seen by discovery for this long is dropped from the stored set. */
export const DISCOVERY_TTL_DAYS = 7;
/** The hourly run discovers again when the stored set is older than this (or empty). */
export const DISCOVERY_MAX_AGE_MS = 26 * 3_600_000;

type Json = Record<string, unknown>;

async function list(token: string, path: string, fetchImpl: typeof fetch): Promise<Json[]> {
  const out: Json[] = [];
  for (let page = 1; page <= 20; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetchImpl(`${CF_API}${path}${sep}page=${page}&per_page=100`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: unknown; result_info?: { total_pages?: number } };
    if (!res.ok || body.success === false) throw new Error(`GET ${path.split('?')[0]} answered HTTP ${res.status}`);
    const r = body.result as Json[] | { buckets?: Json[] } | undefined;
    const items = Array.isArray(r) ? r : Array.isArray(r?.buckets) ? r!.buckets! : [];
    out.push(...items);
    // R2 pages with a cursor, not page numbers; the account has far fewer than 100 al-ummah buckets per page anyway
    if (!Array.isArray(r) || items.length < 100 || (body.result_info?.total_pages && page >= body.result_info.total_pages)) break;
  }
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isDlq = (name: string) => /-dlq(-qa|-stage)?$/.test(name);

/** Lists every al-ummah resource of `envs` (six GET listings). Throws when a listing fails. */
export async function discoverResources(token: string, accountId: string, envs: readonly OpsEnv[], fetchImpl: typeof fetch = fetch): Promise<Resource[]> {
  const a = `/accounts/${accountId}`;
  const [workers, d1s, kvs, buckets, queues, dos] = await Promise.all([
    list(token, `${a}/workers/scripts`, fetchImpl),
    list(token, `${a}/d1/database`, fetchImpl),
    list(token, `${a}/storage/kv/namespaces`, fetchImpl),
    list(token, `${a}/r2/buckets`, fetchImpl),
    list(token, `${a}/queues`, fetchImpl),
    list(token, `${a}/workers/durable_objects/namespaces`, fetchImpl),
  ]);
  const out: Resource[] = [];
  const add = (kind: Resource['kind'], name: string, cfId?: string, envName = name) => {
    if (!name || !isAlUmmahName(envName)) return;
    const env = envOfName(envName);
    if (!env || !envs.includes(env)) return;
    out.push({ id: `${kind}:${name}`, kind, env, name, ...(cfId ? { cfId } : {}), ...(kind === 'queue' ? { dlq: isDlq(name) } : {}) });
  };
  for (const w of workers) add('worker', str(w.id));
  for (const d of d1s) add('d1', str(d.name), str(d.uuid));
  for (const k of kvs) add('kv', str(k.title), str(k.id));
  for (const b of buckets) add('r2', str(b.name));
  for (const q of queues) add('queue', str(q.queue_name), str(q.queue_id));
  // A DO namespace is named after its class; its env and ownership come from the Worker that hosts it
  for (const d of dos) {
    const script = str(d.script);
    const cls = str(d.class) || str(d.name);
    if (script && cls) add('do', `${script}/${cls}`, str(d.id), script);
  }
  return out;
}

export interface StoredResource {
  id: string;
  kind: Resource['kind'];
  env: OpsEnv;
  name: string;
  cf_id: string | null;
  seen_at: string;
}

/** Upserts what discovery found and drops what it has not seen for DISCOVERY_TTL_DAYS. */
export async function storeDiscovered(db: D1Database, resources: Resource[], now: Date): Promise<number> {
  const stamp = now.toISOString();
  const sql = `INSERT INTO ops_resources (id, kind, env, name, cf_id, seen_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, env = excluded.env, name = excluded.name, cf_id = excluded.cf_id, seen_at = excluded.seen_at`;
  const statements = resources.map((r) => db.prepare(sql).bind(r.id, r.kind, r.env, r.name, r.cfId ?? null, stamp));
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  await db.prepare('DELETE FROM ops_resources WHERE seen_at < ?').bind(new Date(now.getTime() - DISCOVERY_TTL_DAYS * 86_400_000).toISOString()).run();
  return resources.length;
}

/** The stored set for `envs`, and when it was last refreshed (null when empty). */
export async function loadDiscovered(db: D1Database, envs: readonly OpsEnv[]): Promise<{ resources: Resource[]; refreshedAt: string | null }> {
  const { results } = await db.prepare('SELECT id, kind, env, name, cf_id, seen_at FROM ops_resources').all<StoredResource>();
  const rows = (results ?? []).filter((r) => envs.includes(r.env) && isAlUmmahName(r.kind === 'do' ? r.name.split('/')[0] : r.name));
  const refreshedAt = rows.reduce<string | null>((max, r) => (max === null || r.seen_at > max ? r.seen_at : max), null);
  return {
    resources: rows.map((r) => ({ id: r.id, kind: r.kind, env: r.env, name: r.name, ...(r.cf_id ? { cfId: r.cf_id } : {}), ...(r.kind === 'queue' ? { dlq: isDlq(r.name) } : {}) })),
    refreshedAt,
  };
}
