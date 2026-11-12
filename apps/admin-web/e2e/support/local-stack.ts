/**
 * Fast paths into the local E2E stack (docs/testing/LOCAL-STACK.md) through its
 * loopback control API: SQL on a stack database and objects in a stack R2
 * bucket. Only for set-up a spec is not about (roles for this job's accounts,
 * a legacy profile record); never on QA or stage.
 *
 * Swap for the shared fixture builders (apps/web/e2e/release/builders.ts) once
 * they offer roles; this module stays the admin suite's one entry point.
 */
import { LOCAL_STACK, STACK_CONTROL_URL } from './env';

/** The videos/auth database holding users and the rbac tables (seed-d1.ts). */
const AUTH_D1 = 'al-ummah-now-d1';

function control(): string {
  if (!LOCAL_STACK || !STACK_CONTROL_URL) throw new Error('local stack fast paths need E2E_ENV=local');
  const url = new URL(STACK_CONTROL_URL);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('LOCAL_STACK_CONTROL_URL must be a loopback URL');
  return STACK_CONTROL_URL;
}

const quote = (value: string, rule: RegExp, what: string) => {
  if (!rule.test(value)) throw new Error(`unsafe ${what} for SQL: ${JSON.stringify(value)}`);
  return `'${value}'`;
};
const SAFE_ID = /^[A-Za-z0-9_:.-]{1,128}$/;
const SAFE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/;

export async function stackSql<T = Record<string, unknown>>(database: string, sql: string): Promise<T[]> {
  const res = await fetch(`${control()}/__stack/d1/${encodeURIComponent(database)}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: sql });
  const body = (await res.json().catch(() => ({}))) as { results?: T[]; error?: string };
  if (!res.ok) throw new Error(`stack SQL on ${database} -> ${res.status} ${body.error ?? ''}`);
  return body.results ?? [];
}

/**
 * Grants a registered account an RBAC role (role_moderator, role_super_admin,
 * role_admin). Tokens carry the roles the account had at sign-in: grant first.
 */
export async function grantRole(email: string, roleId: 'role_admin' | 'role_moderator' | 'role_super_admin'): Promise<void> {
  const users = await stackSql<{ id: string }>(AUTH_D1, `SELECT id FROM users WHERE email = ${quote(email.toLowerCase(), SAFE_EMAIL, 'email')} AND deleted_at IS NULL`);
  if (!users[0]) throw new Error(`no local user ${email}`);
  const user = quote(users[0].id, SAFE_ID, 'user id');
  await stackSql(AUTH_D1, `INSERT OR IGNORE INTO rbac_user_roles (user_id, role_id, tenant_id, assigned_at, assigned_by) VALUES (${user}, ${quote(roleId, SAFE_ID, 'role id')}, 'default', unixepoch()*1000, 'e2e-admin')`);
  const roles = await stackSql<{ role_id: string }>(AUTH_D1, `SELECT role_id FROM rbac_user_roles WHERE user_id = ${user} AND tenant_id = 'default'`);
  if (!roles.some((r) => r.role_id === roleId)) throw new Error(`${roleId} was not granted to ${email}`);
}

/**
 * Runs a worker's scheduled handler now (POST /__stack/scheduled), for the purges the admin only
 * queues for the cron: api-videos' hourly deletion cleanup ('47 * * * *') and admin-api's trash
 * cleanup, which runs on the 5-minute tick in the first minutes of an hour.
 */
export async function runCron(app: 'api-videos' | 'admin-api', cron: string, time = new Date()): Promise<void> {
  const res = await fetch(`${control()}/__stack/scheduled/${app}?cron=${encodeURIComponent(cron)}&time=${encodeURIComponent(time.toISOString())}`, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { outcome?: string; error?: string };
  if (!res.ok || body.outcome !== 'ok') throw new Error(`${app} cron ${cron} -> ${res.status} ${body.outcome ?? body.error ?? ''}`);
}

/** The top of the current UTC hour (admin-api's hourly tick). */
export function topOfHour(now = new Date()): Date {
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  return t;
}

/** Every key of a stack R2 bucket under `prefix` (GET /__stack/r2/<bucket>?prefix=). */
export async function stackR2Keys(bucket: string, prefix = ''): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ prefix, ...(cursor ? { cursor } : {}) });
    const res = await fetch(`${control()}/__stack/r2/${encodeURIComponent(bucket)}?${qs}`);
    const body = (await res.json().catch(() => ({}))) as { keys?: string[]; cursor?: string | null; error?: string };
    if (!res.ok) throw new Error(`listing ${bucket}/${prefix} -> ${res.status} ${body.error ?? ''}`);
    keys.push(...(body.keys ?? []));
    cursor = body.cursor ?? null;
  } while (cursor);
  return keys;
}

/**
 * Deletes every row of `table` whose text columns contain one of `markers` (the run id, the run
 * users' ids). For history tables the product never deletes from (jobs, deletions, tombstones,
 * search rows of purged content); returns how many rows went.
 */
export async function eraseRowsMentioning(database: string, table: string, markers: string[]): Promise<number> {
  const safe = markers.filter((m) => /^[A-Za-z0-9_:.+@-]{6,128}$/.test(m));
  if (!safe.length || !/^[a-z_][a-z0-9_]*$/i.test(table)) return 0;
  // The table-valued pragma: D1 refuses PRAGMA statements through a prepared query
  const columns = (await stackSql<{ name: string; type: string }>(database, `SELECT name, type FROM pragma_table_info('${table}')`)).filter((c) => /TEXT|^$/i.test(c.type)).map((c) => c.name);
  // One query per column: D1 caps an expression tree at depth 100, which every-column-by-every-marker exceeds
  let erased = 0;
  for (const c of columns) {
    const where = safe.map((m) => `instr(CAST("${c}" AS TEXT), '${m}') > 0`).join(' OR ');
    const [{ n }] = await stackSql<{ n: number }>(database, `SELECT count(*) AS n FROM ${table} WHERE ${where}`);
    if (n) await stackSql(database, `DELETE FROM ${table} WHERE ${where}`);
    erased += n;
  }
  return erased;
}

/** What the end-of-job leftover check would report for this run (GET /__stack/leftovers). */
export async function stackLeftovers(marker: string, userIds: string[]): Promise<{ store: string; location: string }[]> {
  const qs = new URLSearchParams({ marker, ids: userIds.join(',') });
  const res = await fetch(`${control()}/__stack/leftovers?${qs}`);
  if (!res.ok) throw new Error(`leftovers -> ${res.status}`);
  return ((await res.json()) as { hits: { store: string; location: string }[] }).hits;
}

/** An object in a stack R2 bucket (bucket_name of the app's top-level wrangler config). */
export function stackR2(method: 'GET' | 'PUT' | 'DELETE', bucket: string, key: string, body?: unknown): Promise<Response> {
  return fetch(`${control()}/__stack/r2/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
