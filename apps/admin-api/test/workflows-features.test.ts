/**
 * Feature switches on the approval workflow (wiki AUN-WORKFLOWS WF-9): every switch is direct,
 * creatorSupport included (owner 2026-11-24, WF-D9 superseded: switching a feature is not handling
 * money; its readiness stays a precondition). A switch given approvers on the rules page waits for them
 * and moves only on approval, with the request id as its change id.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { WORKFLOW_ACTIONS, forgetFeatureSwitches, type FeatureStateReport } from '@al-ummah/shared-types';
import { createFeaturesRouter } from '../src/routers/features.router';
import { registerStepUpRoutes } from '../src/middleware/step-up-routes';
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
  const as = (userId: string, roles: string[], fresh = true) => {
    const app = new Hono();
    app.use('*', errorEnvelope);
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId, roles, payload: fresh ? { auth_time: Math.floor(Date.now() / 1000) } : {} } as never);
      await next();
    });
    registerStepUpRoutes(app as never);
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
  it('turning creatorSupport on is direct once its precondition holds: no request, nobody to approve', async () => {
    const t = await setup();
    const res = await t.as('sa1', ['super_admin'])('creatorSupport', { enabled: true, expectedVersion: 0 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(t.enabled('creatorSupport'), 1);
    assert.equal(t.search.raw.prepare('SELECT COUNT(*) AS n FROM workflow_requests').get()!.n, 0);
    assert.equal((await t.as('sa1', ['super_admin'])('creatorSupport', { enabled: false, expectedVersion: 1 })).status, 200, 'and off again, at once');
    assert.equal(t.enabled('creatorSupport'), 0);
  });

  it('creatorSupport given approvers waits like any switch: any approver the rule names, the change keyed by the request', async () => {
    const t = await setup();
    const config = { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['features.set'].defaultRule)), approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }] };
    const ctx = workflowCtx(t.env as never, { steppedUp: true });
    await ruleVersionStatement(ctx, { type: 'features.set', scope: 'creatorSupport', version: 1, config, requestId: null, by: 'seed' }).run();
    const res = await t.as('sa1', ['super_admin'])('creatorSupport', { enabled: true, expectedVersion: 0, reason: 'Launch' });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.result.request.domain, 'platform', 'not money');
    assert.equal(t.enabled('creatorSupport'), null, 'nothing changes before approval');
    const id = res.body.result.request.id as string;
    const done = await approveRequest(ctx, await ctx.directory.actor('sa2', ['super_admin']), id, {});
    assert.equal(done.status, 'applied');
    assert.equal(t.enabled('creatorSupport'), 1);
    const change = { ...(t.search.raw.prepare('SELECT id, actor_id FROM feature_switch_changes WHERE key = ?').get('creatorSupport') as { id: string; actor_id: string }) };
    assert.deepEqual(change, { id, actor_id: 'sa1' }, 'one change row, keyed by the request, by the person who asked');
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
    const config = { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['features.set'].defaultRule)), approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }] };
    await ruleVersionStatement(workflowCtx(t.env as never, { steppedUp: true }), { type: 'features.set', scope: 'newsletter', version: 1, config, requestId: null, by: 'seed' }).run();
    await t.as('sa1', ['super_admin'])('newsletter', { enabled: false, expectedVersion: 0, reason: 'r' });
    const again = await t.as('sa2', ['super_admin'])('newsletter', { enabled: false, expectedVersion: 0, reason: 'r' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'change_pending');
  });

  it('a stale version is refused with 409 before anything is proposed', async () => {
    const t = await setup();
    const config = { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['features.set'].defaultRule)), approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }] };
    await ruleVersionStatement(workflowCtx(t.env as never, { steppedUp: true }), { type: 'features.set', scope: 'newsletter', version: 1, config, requestId: null, by: 'seed' }).run();
    const res = await t.as('sa1', ['super_admin'])('newsletter', { enabled: false, expectedVersion: 7, reason: 'r' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'feature_changed');
    assert.equal(t.search.raw.prepare('SELECT COUNT(*) AS n FROM workflow_requests').get()!.n, 0);
  });

  it('a rule that needs a step-up to propose asks for a fresh sign-in, not propose_not_allowed', async () => {
    const t = await setup();
    const config = { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['features.set'].defaultRule)), approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }], stepUp: 'propose_and_approve' };
    const ctx = workflowCtx(t.env as never, { steppedUp: true });
    await ruleVersionStatement(ctx, { type: 'features.set', scope: 'live', version: 1, config, requestId: null, by: 'seed' }).run();
    const row = t.search.raw.prepare('SELECT version FROM feature_switches WHERE key = ?').get('live') as { version: number } | undefined;
    const stale = await t.as('sa1', ['super_admin'], false)('live', { enabled: false, expectedVersion: row?.version ?? 0, reason: 'r' });
    assert.equal(stale.status, 401, JSON.stringify(stale.body));
    assert.equal(stale.body.code, 'step_up_required');
    // a direct switch never asks
    assert.equal((await t.as('sa1', ['super_admin'], false)('newsletter', { enabled: true, expectedVersion: 0 })).status, 200);
    // creatorSupport is direct like any switch: no step-up
    assert.equal((await t.as('sa1', ['super_admin'], false)('creatorSupport', { enabled: false, expectedVersion: 0 })).status, 200);
  });
});
