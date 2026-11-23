/**
 * The videos admin's Support API (wiki AUN-MEMBERS §9.6, MEM-8): the organization's finance list is
 * a two-person change; tech staff (the owner) can never be on it; money actions (decisions, holds,
 * payout batches) are for the finance list only, never a super admin role alone; every change is
 * audited. api-videos is a recording stub; real SQL for the search and reports databases.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import supportRouter from '../src/routers/support.router';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { financeAllows } from '../src/lib/support-finance';
import { sqliteD1 } from './d1-sqlite';

function searchD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
    const info = stmt.run(...params);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    first: async () => (exec(sql, args).results as unknown[])[0] ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _run: () => exec(sql, args),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { _run: () => unknown }[]) => {
      raw.exec('BEGIN');
      try {
        const out = stmts.map((s) => s._run());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    raw,
  };
}

function setup() {
  const search = searchD1();
  const reports = sqliteD1();
  const calls: { path: string; method: string; body: unknown }[] = [];
  const env = {
    SEARCH_DB: search,
    REPORTS_DB: reports,
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        calls.push({ path: new URL(input).pathname, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
        return Response.json({ success: true, result: { before: { holdDays: null } } });
      },
    },
  };
  const as = (userId: string, roles: string[]) => {
    const app = new Hono();
    app.use('*', errorEnvelope);
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId, roles } as never);
      await next();
    });
    app.route('/api/support', supportRouter as never);
    const req = (method: string, path: string, json?: unknown) => app.request(`/api/support${path}`, { method, body: json === undefined ? undefined : JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }, env as never);
    return req;
  };
  const audits = () => (reports as unknown as { prepare: (s: string) => { all: () => Promise<{ results: { key: string }[] }> } }).prepare("SELECT key FROM site_settings_log WHERE key LIKE 'content:support-%' ORDER BY id").all();
  return { search, reports, calls, as, audits, env };
}

const OWNER = 'usr_owner';
const SUPER_B = 'usr_super_b';
const FIN = 'usr_finance';

describe('the finance list is a two-person change', () => {
  it('a super admin proposes, a different one approves; then the person holds only the permissions given', async () => {
    const t = setup();
    const a = t.as(OWNER, ['super_admin']);
    const b = t.as(SUPER_B, ['super_admin']);
    assert.equal((await a('POST', '/finance', { userId: FIN, permissions: ['support:payouts'] })).status, 200);
    assert.equal(await financeAllows(t.search as never, FIN, 'support:payouts'), false, 'not before the approval');
    const self = await a('POST', `/finance/${FIN}/approve`);
    assert.equal(self.status, 409);
    assert.equal(((await self.json()) as { code: string }).code, 'support_same_person');
    assert.equal((await b('POST', `/finance/${FIN}/approve`)).status, 200);
    assert.equal(await financeAllows(t.search as never, FIN, 'support:payouts'), true);
    assert.equal(await financeAllows(t.search as never, FIN, 'support:refund'), false);
    assert.ok((await t.audits()).results.length >= 2);
  });

  it('nobody adds themselves, and only super admins change the list', async () => {
    const t = setup();
    assert.equal(((await (await t.as(OWNER, ['super_admin'])('POST', '/finance', { userId: OWNER, permissions: ['support:payouts'] })).json()) as { code: string }).code, 'support_same_person');
    assert.equal((await t.as('usr_admin', ['admin'])('POST', '/finance', { userId: FIN, permissions: ['support:payouts'] })).status, 403);
    assert.equal((await t.as(OWNER, ['super_admin'])('POST', '/finance', { userId: FIN, permissions: ['billing:refund'] })).status, 400);
  });

  it('tech staff (the owner) can never be on it; marking removes them; unmarking needs a second person', async () => {
    const t = setup();
    const a = t.as(OWNER, ['super_admin']);
    const b = t.as(SUPER_B, ['super_admin']);
    await a('POST', '/tech-staff', { userId: OWNER });
    const refused = await b('POST', '/finance', { userId: OWNER, permissions: ['support:payouts'] });
    assert.equal(((await refused.json()) as { code: string }).code, 'support_tech_staff');
    // Someone already on the list who is then marked loses it at once
    await b('POST', '/finance', { userId: FIN, permissions: ['support:providers'] });
    await a('POST', `/finance/${FIN}/approve`);
    assert.equal(await financeAllows(t.search as never, FIN, 'support:providers'), true);
    await a('POST', '/tech-staff', { userId: FIN });
    assert.equal(await financeAllows(t.search as never, FIN, 'support:providers'), false);
    assert.equal(((await (await a('DELETE', `/tech-staff/${FIN}`)).json()) as { code: string }).code, 'support_same_person');
    assert.equal((await b('DELETE', `/tech-staff/${FIN}`)).status, 200);
  });
});

describe('money actions are for the finance list only', () => {
  it('a super admin role alone can’t record decisions or approve payouts; the finance person can, and it is audited', async () => {
    const t = setup();
    const owner = t.as(OWNER, ['super_admin']);
    for (const [method, path, json] of [
      ['PUT', '/settings/policy', { patch: { holdDays: 30 }, expectedVersion: 0 }],
      ['PUT', '/settings/fields', { fields: { organizationFormed: true }, expectedVersion: 0 }],
      ['POST', '/batches/plan', { period: '2026-12' }],
      ['POST', '/batches/spb_1/approve', {}],
    ] as const) {
      const res = await owner(method, path, json);
      assert.equal(res.status, 403, path);
      assert.equal(((await res.json()) as { code: string }).code, 'support_not_finance');
    }
    assert.equal(t.calls.length, 0, 'nothing reached api-videos');
    await t.as(SUPER_B, ['super_admin'])('POST', '/finance', { userId: FIN, permissions: ['support:providers', 'support:payouts'] });
    await owner('POST', `/finance/${FIN}/approve`);
    const fin = t.as(FIN, ['moderator']);
    assert.equal((await fin('PUT', '/settings/policy', { patch: { holdDays: 30 }, expectedVersion: 0 })).status, 200);
    assert.equal((await fin('POST', '/batches/spb_1/approve', {})).status, 200);
    assert.deepEqual(t.calls.map((x) => [x.method, x.path, (x.body as { actorId?: string } | null)?.actorId]), [
      ['PUT', '/internal/support/settings/policy', FIN],
      ['POST', '/internal/support/batches/spb_1/approve', FIN],
    ]);
    const keys = (await t.audits()).results.map((r) => r.key);
    assert.ok(keys.includes('content:support-settings:policy') && keys.includes('content:support-batch:spb_1'));
  });

  it('reading: super admins and finance people; other admins don’t', async () => {
    const t = setup();
    assert.equal((await t.as(OWNER, ['super_admin'])('GET', '/settings')).status, 200);
    assert.equal((await t.as('usr_admin', ['admin'])('GET', '/settings')).status, 403);
  });
});
