/**
 * D1 capacity on the admin Costs page (wiki AUN-D1-SCALING, D1-1b): the Databases overview from
 * what the cost-monitor collected, the editable limits (audited, ops:manage), and the capacity
 * emails (once per opened alert per opted-in admin, en and ar).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import costsRouter from '../src/routers/costs.router';
import { databasesOverview, parseD1LimitsInput, queueCapacityEmails } from '../src/lib/d1Capacity';
import { renderCostEmail } from '../src/lib/cost-alert-mail';
import { sqliteD1 } from './d1-sqlite';

const GB = 1e9;

function costsD1(): D1Database {
  const dir = join(process.cwd(), '..', 'cost-monitor', 'migrations');
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql);
    const p = args.map((a) => (a === undefined ? null : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...p), success: true, meta: { changes: 0 } };
    const r = stmt.run(...p);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  };
  const st = (sql: string, args: unknown[] = []) => ({
    bind: (...n: unknown[]) => st(sql, n),
    first: async <T>() => (exec(sql, args).results[0] as T) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
  });
  return { prepare: (sql: string) => st(sql), batch: async (list: { run: () => Promise<unknown> }[]) => { const out = []; for (const x of list) out.push(await x.run()); return out; } } as unknown as D1Database;
}

const NOW = new Date('2026-11-24T12:00:00Z');
const day = (i: number) => new Date(Date.UTC(2026, 10, 10 + i)).toISOString().slice(0, 10);

async function seed(db: D1Database) {
  // notifications-qa: 5 GB growing 0.1 GB/day for 14 days (6.3 GB now → 70% of 10 GB in 7 days)
  for (let i = 0; i < 14; i++) {
    await db.prepare(`INSERT INTO ops_daily (day, resource_id, kind, env, name, stored_bytes, writes, updated_at)
      VALUES (?, 'd1:al-ummah-now-notifications-qa', 'd1', 'qa', 'al-ummah-now-notifications-qa', ?, 1000, 'x')`).bind(day(i), 5 * GB + i * 0.1 * GB).run();
    await db.prepare(`INSERT INTO ops_daily (day, resource_id, kind, env, name, stored_bytes, writes, updated_at)
      VALUES (?, 'd1:al-ummah-now-cms', 'd1', 'production', 'al-ummah-now-cms', ?, 50, 'x')`).bind(day(i), 0.5e6).run();
  }
  await db.prepare(`INSERT INTO ops_hourly (hour, resource_id, kind, env, name, requests, latency_p50, updated_at)
    VALUES ('2026-11-24T10:00:00Z', 'd1:al-ummah-now-notifications-qa', 'd1', 'qa', 'al-ummah-now-notifications-qa', 1800000, 1, 'x')`).run();
  await db.prepare("INSERT INTO d1_account_storage (hour, bytes, databases, updated_at) VALUES ('2026-11-24T11:00:00Z', ?, 30, 'x')").bind(720 * GB).run();
  await db.prepare("INSERT INTO ops_alerts (key, rule_id, resource_id, env, value, opened_at, last_seen_at) VALUES ('ops:d1-storage-forecast:d1:al-ummah-now-notifications-qa', 'd1-storage-forecast', 'd1:al-ummah-now-notifications-qa', 'qa', 7, '2026-11-24T10:10:00Z', 'x')").run();
  await db.prepare("INSERT INTO ops_alerts (key, rule_id, resource_id, env, value, opened_at, last_seen_at) VALUES ('ops:d1-account-storage-70:d1_account:all', 'd1-account-storage-70', 'd1_account:all', 'account', 0.72, '2026-11-24T11:10:00Z', 'x')").run();
  await db.prepare("INSERT INTO ops_alerts (key, rule_id, resource_id, env, value, opened_at, last_seen_at) VALUES ('ops:worker-error-rate:worker:videos-qa', 'worker-error-rate', 'worker:videos-qa', 'qa', 0.1, 'x', 'x')").run();
}

describe('databases overview', () => {
  it('sizes, trend, days to 70%, activity, alerts and the account total, soonest first', async () => {
    const db = costsD1();
    await seed(db);
    const o = await databasesOverview(db, NOW);
    assert.deepEqual(o.limits, { maxDbBytes: 10 * GB, accountBytes: 1e12 });
    assert.deepEqual(o.databases.map((d) => d.name), ['al-ummah-now-notifications-qa', 'al-ummah-now-cms']);
    const n = o.databases[0]!;
    assert.equal(n.bytes, 6.3 * GB);
    assert.equal(n.share, 0.63);
    assert.equal(n.growthPerDay, 0.1 * GB);
    assert.equal(n.daysTo70, 7);
    assert.equal(n.peakBusy, 0.5);
    assert.ok(n.rowsWrittenPerDay === 1000);
    assert.deepEqual(n.alerts, ['d1-storage-forecast']);
    assert.equal(o.databases[1]!.daysTo70, null, 'a flat database has no forecast');
    assert.deepEqual(o.account, { bytes: 720 * GB, databases: 30, share: 0.72, hour: '2026-11-24T11:00:00Z', alerts: ['d1-account-storage-70'] });
    assert.deepEqual(o.rules.map((r) => r.id).sort(), ['d1-account-storage-70', 'd1-busy-70', 'd1-storage-70', 'd1-storage-90', 'd1-storage-forecast']);
  });

  it('works with no collected data', async () => {
    const o = await databasesOverview(costsD1(), NOW);
    assert.deepEqual(o.databases, []);
    assert.equal(o.account, null);
  });
});

function app(roles: string[]) {
  const env = { COSTS_DB: costsD1(), REPORTS_DB: sqliteD1(), ENVIRONMENT: 'qa' };
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles, email: 'owner@example.com', payload: { name: 'Owner' } } as never);
    await next();
  });
  a.route('/api/costs', costsRouter);
  return { env, req: (path: string, init?: RequestInit) => a.request(path, init, env as never) };
}

describe('/api/costs/databases and /d1-limits', () => {
  it('admins read the overview; only super admins change the limits, audited', async () => {
    const admin = app(['Admin']);
    const res = await admin.req('/api/costs/databases');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result: { canManage: boolean; databases: unknown[] } };
    assert.equal(body.result.canManage, false);
    const put = (a: ReturnType<typeof app>, body: unknown) => a.req('/api/costs/d1-limits', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    assert.equal((await put(admin, { maxDbGb: 20, accountGb: 2000 })).status, 403);

    const sup = app(['Super Admin']);
    assert.equal((await put(sup, { maxDbGb: 0, accountGb: 2000 })).status, 400);
    const ok = await put(sup, { maxDbGb: 20, accountGb: 2000 });
    assert.equal(ok.status, 200);
    const after = await databasesOverview(sup.env.COSTS_DB, NOW);
    assert.deepEqual(after.limits, { maxDbBytes: 20 * GB, accountBytes: 2000 * GB });
    const log = await sup.env.REPORTS_DB.prepare("SELECT key, old_value, new_value FROM site_settings_log WHERE key = 'costs:d1-limits'").first<{ old_value: string; new_value: string }>();
    assert.deepEqual(JSON.parse(log!.old_value), { maxDbBytes: 10 * GB, accountBytes: 1e12 });
    assert.deepEqual(JSON.parse(log!.new_value), { maxDbBytes: 20 * GB, accountBytes: 2000 * GB });
  });

  it('validates the limits', () => {
    assert.equal(typeof parseD1LimitsInput({ maxDbGb: 10, accountGb: 1000 }), 'object');
    assert.equal(typeof parseD1LimitsInput({ maxDbGb: 1001, accountGb: 1000 }), 'string');
    assert.equal(typeof parseD1LimitsInput({ maxDbGb: 10 }), 'string');
    assert.equal(typeof parseD1LimitsInput(null), 'string');
  });
});

describe('capacity emails', () => {
  it('each open capacity alert is emailed once per opted-in admin; other alerts are not', async () => {
    const db = costsD1();
    await seed(db);
    await db.prepare("INSERT INTO cost_alert_subscriptions (user_id, kind, email, locale, created_at) VALUES ('u1', 'capacity', 'a@example.com', 'ar', 'x'), ('u2', 'budget', 'b@example.com', 'en', 'x')").run();
    const sent: unknown[] = [];
    const env = { COSTS_DB: db, CONTACT_MAIL_QUEUE: { sendBatch: async (m: unknown[]) => void sent.push(...m), send: async () => undefined } as never };
    assert.equal(await queueCapacityEmails(env, NOW), 2);
    assert.equal(await queueCapacityEmails(env, NOW), 0, 'already queued: not again');
    const rows = (await db.prepare('SELECT fingerprint, user_id, kind FROM cost_alert_deliveries ORDER BY fingerprint').all<{ fingerprint: string; user_id: string; kind: string }>()).results;
    assert.deepEqual(rows.map((r) => [r.user_id, r.kind]), [['u1', 'capacity'], ['u1', 'capacity']]);
    assert.ok(rows.every((r) => r.fingerprint.includes('@2026-11-24T')));
    // Resolved and opened again later: a new email
    await db.prepare("UPDATE ops_alerts SET opened_at = '2026-11-25T09:10:00Z' WHERE rule_id = 'd1-storage-forecast'").run();
    assert.equal(await queueCapacityEmails(env, NOW), 1);
  });

  it('renders the database and the account alerts in English and Arabic, linking to Databases', () => {
    const base = { to: 'a@example.com', environment: 'qa', adminUrl: 'https://admin.qa.alummahnow.net' };
    const db = renderCostEmail({ ...base, locale: 'en', payload: { type: 'capacity', metric: 'storage_days_to_70', env: 'qa', name: 'al-ummah-now-notifications-qa', value: 7, threshold: 60 } });
    assert.equal(db.subject, '[qa] Capacity: al-ummah-now-notifications-qa needs attention');
    assert.match(db.text, /Days until 70% of the database limit/);
    assert.match(db.text, /7 days/);
    assert.match(db.html, /\/costs#databases/);
    assert.doesNotMatch(db.text, /list prices/, 'no cost estimate note on a capacity email');
    const acct = renderCostEmail({ ...base, locale: 'ar', payload: { type: 'capacity', metric: 'account_storage_pct', env: 'account', name: '', value: 0.72, threshold: 0.7 } });
    assert.match(acct.subject, /السعة: كل قواعد بيانات D1 في الحساب/);
    assert.match(acct.text, /٧٢/);
    assert.match(acct.html, /dir="rtl"/);
  });
});
