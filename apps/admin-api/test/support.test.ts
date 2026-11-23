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
      // a fresh sign-in: the approval workflow needs a step-up to propose and approve money changes
      c.set('auth' as never, { userId, roles, payload: { auth_time: Math.floor(Date.now() / 1000) } } as never);
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

describe('the finance list is a two-person change (approval workflow, AUN-WORKFLOWS WF-5)', () => {
  it('a super admin proposes, a different one approves; then the person holds only the permissions given', async () => {
    const t = setup();
    const a = t.as(OWNER, ['super_admin']);
    const b = t.as(SUPER_B, ['super_admin']);
    const proposed = await a('POST', '/finance', { userId: FIN, permissions: ['support:payouts'], reason: 'New treasurer' });
    assert.equal(proposed.status, 202);
    const request = ((await proposed.json()) as { result: { status: string; request: { id: string; fields: { key: string; after: unknown }[] } } }).result;
    assert.equal(request.status, 'pending_approval');
    assert.deepEqual(request.request.fields.find((f) => f.key === 'permissions')?.after, ['support:payouts']);
    assert.equal(await financeAllows(t.search as never, FIN, 'support:payouts'), false, 'not before the approval');
    const self = await a('POST', `/finance/${FIN}/approve`);
    assert.equal(self.status, 409);
    assert.equal(((await self.json()) as { code: string }).code, 'support_same_person');
    assert.equal((await t.as(FIN, ['super_admin'])('POST', `/finance/${FIN}/approve`)).status, 409, 'the person added never approves it');
    assert.equal((await b('POST', `/finance/${FIN}/approve`)).status, 200);
    assert.equal(await financeAllows(t.search as never, FIN, 'support:payouts'), true);
    assert.equal(await financeAllows(t.search as never, FIN, 'support:refund'), false);
    const member = (await t.search.prepare('SELECT added_by, approved_by FROM support_finance_members WHERE user_id = ?').bind(FIN).first()) as { added_by: string; approved_by: string };
    assert.deepEqual(member, { added_by: OWNER, approved_by: SUPER_B });
    const steps = (await t.search.prepare("SELECT kind FROM workflow_steps ORDER BY seq").all()).results.map((r) => (r as { kind: string }).kind);
    assert.deepEqual(steps, ['propose', 'approve', 'apply']);
    const second = await a('POST', '/finance', { userId: FIN, permissions: ['support:payouts', 'support:refund'] });
    assert.equal(second.status, 202, 'changing permissions is a new request');
    assert.equal(((await (await b('POST', '/finance', { userId: FIN, permissions: ['support:ledger'] })).json()) as { code: string }).code, 'change_pending');
  });

  it('nobody adds themselves, and only super admins change the list', async () => {
    const t = setup();
    assert.equal(((await (await t.as(OWNER, ['super_admin'])('POST', '/finance', { userId: OWNER, permissions: ['support:payouts'] })).json()) as { code: string }).code, 'support_same_person');
    assert.equal((await t.as('usr_admin', ['admin'])('POST', '/finance', { userId: FIN, permissions: ['support:payouts'] })).status, 403);
    assert.equal((await t.as(OWNER, ['super_admin'])('POST', '/finance', { userId: FIN, permissions: ['billing:refund'] })).status, 400);
  });

  it('a proposal made before the workflow is still approved the old way', async () => {
    const t = setup();
    t.search.raw.exec(`INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at) VALUES ('${FIN}', '["support:payouts"]', '${OWNER}', NULL, '2026-11-20T00:00:00Z')`);
    assert.equal((await t.as(OWNER, ['super_admin'])('POST', `/finance/${FIN}/approve`)).status, 409);
    assert.equal((await t.as(SUPER_B, ['super_admin'])('POST', `/finance/${FIN}/approve`)).status, 200);
    assert.equal(await financeAllows(t.search as never, FIN, 'support:payouts'), true);
  });

  it('tech staff (the owner) can never be on it; marking removes them; unmarking needs a second person who did not mark them', async () => {
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
    // Unmarking is a request: whoever marked them (a) never approves it
    const proposed = await b('DELETE', `/tech-staff/${FIN}`);
    assert.equal(proposed.status, 202);
    const id = ((await proposed.json()) as { result: { request: { id: string } } }).result.request.id;
    const { approveRequest } = await import('../src/lib/workflows/engine');
    const { workflowCtx } = await import('../src/routers/workflows.router');
    const ctx = workflowCtx(t.env as never, { steppedUp: true });
    await assert.rejects(approveRequest(ctx, await ctx.directory.actor(OWNER, ['super_admin']), id, {}), (e: { code?: string; extra?: { blocks?: string[] } }) => e.code === 'approval_not_allowed' && !!e.extra?.blocks?.includes('marked_them'));
    assert.equal((await approveRequest(ctx, await ctx.directory.actor('usr_super_c', ['super_admin']), id, {})).status, 'applied');
    assert.equal(t.search.raw.prepare('SELECT COUNT(*) AS n FROM support_tech_staff WHERE user_id = ?').get(FIN)!.n, 0);
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

describe('fee settings (O43)', () => {
  it('only the finance list (support:providers) changes a fee; it is audited with its effective date', async () => {
    const t = setup();
    const fee = { kind: 'collector', provider: 'paygood', currency: 'USD', basisPoints: 190, fixedMinor: 30, effectiveFrom: '2026-12-01T00:00:00Z', presetId: 'paygood-nonprofit-usd' };
    const refused = await t.as(OWNER, ['super_admin'])('POST', '/fees', fee);
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { code: string }).code, 'support_not_finance');
    await t.as(SUPER_B, ['super_admin'])('POST', '/finance', { userId: FIN, permissions: ['support:providers'] });
    await t.as(OWNER, ['super_admin'])('POST', `/finance/${FIN}/approve`);
    assert.equal((await t.as(FIN, ['moderator'])('POST', '/fees', fee)).status, 200);
    assert.equal(t.calls.at(-1)!.path, '/internal/support/fees');
    const keys = (await t.audits()).results.map((r) => r.key);
    assert.ok(keys.includes('content:support-fees:collector:paygood:USD:any'));
  });
});
