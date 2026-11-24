/**
 * Feature switches on the approval workflow (wiki AUN-WORKFLOWS WF-9, owner WF-D1/WF-D9): turning
 * creatorSupport on is a change request that the finance list approves (never a super admin role alone,
 * never the owner); the switch moves only on approval, with the request id as its change id; turning it
 * off stays immediate; a switch whose rule is direct keeps the Features page's own write; a switch
 * given approvers on the rules page waits for them.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { WORKFLOW_ACTIONS, forgetFeatureSwitches, type FeatureStateReport } from '@al-ummah/shared-types';
import { createFeaturesRouter } from '../src/routers/features.router';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { approveRequest, ruleVersionStatement } from '../src/lib/workflows/engine';
import { workflowCtx } from '../src/routers/workflows.router';
import { sqliteD1 } from './d1-sqlite';

function searchD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
    return { results: [], success: true, meta: { changes: Number(stmt.run(...params).changes) } };
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...v: unknown[]) => statement(sql, v),
    first: async () => (exec(sql, args).results as unknown[])[0] ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _run: () => exec(sql, args),
  });
  return {
    raw,
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
  };
}

const STATE: FeatureStateReport = { legacy: {}, ready: {} };
const at = '2026-11-23T00:00:00Z';

async function setup() {
  forgetFeatureSwitches();
  const search = searchD1();
  const reports = sqliteD1();
  search.raw.exec(`INSERT INTO support_tech_staff (user_id, marked_by, marked_at) VALUES ('owner', 'sa1', '${at}')`);
  search.raw.prepare("INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at) VALUES ('fin1', ?, 'x', 'y', ?)").run(JSON.stringify(['support:providers']), at);
  const env = {
    SEARCH_DB: search,
    REPORTS_DB: reports,
    INTERNAL_API_KEY: 'k',
    VIDEOS: { fetch: async () => Response.json({ success: true, result: STATE }) },
  };
  const as = (userId: string, roles: string[]) => {
    const app = new Hono();
    app.use('*', errorEnvelope);
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId, roles, payload: { auth_time: Math.floor(Date.now() / 1000) } } as never);
      await next();
    });
    app.route('/api/features', createFeaturesRouter({ creatorSupport: async () => ({ ok: true as const }) }));
    return async (key: string, json: unknown) => {
      const res = await app.request(`/api/features/${key}`, { method: 'PUT', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }, env as never);
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
  };
  const enabled = (key: string) => (search.raw.prepare('SELECT enabled FROM feature_switches WHERE key = ?').get(key) as { enabled: number } | undefined)?.enabled ?? null;
  return { env, search, as, enabled };
}

beforeEach(() => forgetFeatureSwitches());

describe('features.set on the approval workflow', () => {
  it('turning creatorSupport on waits for a finance approver; the owner and a plain super admin cannot approve', async () => {
    const t = await setup();
    const res = await t.as('sa1', ['super_admin'])('creatorSupport', { enabled: true, expectedVersion: 0, reason: 'The organization is formed' });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.result.status, 'pending_approval');
    assert.equal(res.body.result.request.domain, 'money');
    assert.equal(t.enabled('creatorSupport'), null, 'nothing changes before approval');
    const id = res.body.result.request.id as string;

    const ctx = workflowCtx(t.env as never, { steppedUp: true });
    await assert.rejects(approveRequest(ctx, await ctx.directory.actor('owner', ['super_admin']), id, {}), /approval_not_allowed/);
    await assert.rejects(approveRequest(ctx, await ctx.directory.actor('sa2', ['super_admin']), id, {}), /approval_not_allowed/);
    const done = await approveRequest(ctx, await ctx.directory.actor('fin1', []), id, {});
    assert.equal(done.status, 'applied');
    assert.equal(t.enabled('creatorSupport'), 1);
    const change = { ...(t.search.raw.prepare('SELECT id, actor_id FROM feature_switch_changes WHERE key = ?').get('creatorSupport') as { id: string; actor_id: string }) };
    assert.deepEqual(change, { id, actor_id: 'sa1' }, 'one change row, keyed by the request, by the person who asked');
  });

  it('turning creatorSupport off is immediate (it only takes money ability away)', async () => {
    const t = await setup();
    const res = await t.as('sa1', ['super_admin'])('creatorSupport', { enabled: false, expectedVersion: 0 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(t.enabled('creatorSupport'), 0);
  });

  it('a direct switch keeps the Features page write; one given approvers waits', async () => {
    const t = await setup();
    assert.equal((await t.as('sa1', ['super_admin'])('newsletter', { enabled: true, expectedVersion: 0 })).status, 200);
    const config = { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['features.set'].defaultRule)), approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }] };
    const ctx = workflowCtx(t.env as never, { steppedUp: true });
    await ruleVersionStatement(ctx, { type: 'features.set', scope: 'live', version: 1, config, requestId: null, by: 'seed' }).run();
    const row = t.search.raw.prepare('SELECT enabled, version FROM feature_switches WHERE key = ?').get('live') as { enabled: number; version: number } | undefined;
    const res = await t.as('sa1', ['super_admin'])('live', { enabled: false, expectedVersion: row?.version ?? 0 });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(t.enabled('live'), row?.enabled ?? null, 'unchanged until approved');
    assert.equal((await approveRequest(ctx, await ctx.directory.actor('sa2', ['super_admin']), res.body.result.request.id, {})).status, 'applied');
    assert.equal(t.enabled('live'), 0);
  });

  it('a second change while one waits is refused', async () => {
    const t = await setup();
    await t.as('sa1', ['super_admin'])('creatorSupport', { enabled: true, expectedVersion: 0, reason: 'r' });
    const again = await t.as('sa2', ['super_admin'])('creatorSupport', { enabled: true, expectedVersion: 0, reason: 'r' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'change_pending');
  });
});
