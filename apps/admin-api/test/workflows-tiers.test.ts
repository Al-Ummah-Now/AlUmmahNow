/**
 * Tier changes on the approval workflow (wiki AUN-WORKFLOWS WF-10, owner WF-D1: tiers are direct until
 * an admin adds approvers). Direct scopes keep the tier routes exactly as they were; a scope given
 * approvers turns its routes into change requests (202) that run on approval under the proposer's name,
 * with the same checks and audit rows; a run after approval is safe to repeat; scopes are independent.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { TIER_CHANGE_SCOPES, WORKFLOW_ACTIONS, WORKFLOW_LISTED_SCOPES, workflowScopeLabel } from '@al-ummah/shared-types';
import contentRouter from '../src/routers/content.router';
import { approveRequest, ruleVersionStatement } from '../src/lib/workflows/engine';
import { runTierOp, tierScope } from '../src/lib/workflows/tier-actions';
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

/** api-videos' tier routes with state: assignments, the tiers and the default. */
function fakeVideos() {
  const assignments = new Map<string, { tierId: string; source: string; assignedBy?: string }>([['u-super', { tierId: 'unlimited', source: 'super_admin', assignedBy: 'system' }]]);
  const state = { tiers: [{ id: 'member', name: 'Member' }, { id: 'creator', name: 'Creator' }, { id: 'unlimited', name: 'Unlimited' }], defaultTierId: 'member' };
  const writes: string[] = [];
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return {
    assignments,
    state,
    writes,
    fetcher: {
      async fetch(input: string, init: RequestInit = {}) {
        const url = new URL(input);
        const path = url.pathname.replace('/internal/admin', '');
        const method = init.method ?? 'GET';
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        const user = path.match(/^\/users\/([^/]+)\/creator-tier$/);
        if (user) {
          const id = decodeURIComponent(user[1]);
          if (method === 'PUT') {
            writes.push(`assign:${id}:${body.tierId}`);
            assignments.set(id, { tierId: String(body.tierId), source: String(body.source) });
          }
          return answer(200, { success: true, result: { assignment: assignments.get(id) ?? null } });
        }
        if (path === '/creator-tiers' && method === 'GET') return answer(200, { success: true, result: { items: state.tiers, defaultTierId: state.defaultTierId } });
        if (path === '/creator-tiers/default' && method === 'PUT') {
          writes.push(`default:${body.tierId}`);
          state.defaultTierId = String(body.tierId);
          return answer(200, { success: true, result: { defaultTierId: state.defaultTierId } });
        }
        return answer(404, { success: false, code: 'not_found', error: 'not found' });
      },
    },
  };
}

function setup() {
  const search = searchD1();
  const reports = sqliteD1();
  const videos = fakeVideos();
  const env = { SEARCH_DB: search, REPORTS_DB: reports, VIDEOS: videos.fetcher, INTERNAL_API_KEY: 'k' };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'admin-1', roles: (c.req.header('x-test-roles') ?? 'admin').split(','), payload: { auth_time: Math.floor(Date.now() / 1000) } } as never);
    await next();
  });
  app.route('/api/content', contentRouter);
  const call = async (method: string, path: string, json: unknown = {}) => {
    const res = await app.request(`/api/content${path}`, { method, body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }, env as never);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const ctx = workflowCtx(env as never, { steppedUp: true, onEvent: async () => {} });
  /** Gives a tiers.change scope one super-admin approver (the rules page's change, seeded here). */
  const needApprover = (scope: string) =>
    ruleVersionStatement(ctx, { type: 'tiers.change', scope, version: 1, config: { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['tiers.change'].defaultRule)), approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }] }, requestId: null, by: 'seed' }).run();
  const tierAudit = async () =>
    ((await reports.prepare("SELECT key, new_value, actor_id FROM site_settings_log WHERE (key LIKE 'content:user:%' OR key LIKE 'content:creator-tier:%') ORDER BY created_at, id").bind().all()) as { results: { key: string; new_value: string; actor_id: string }[] }).results;
  const requests = () => search.raw.prepare('SELECT id, status, scope FROM workflow_requests').all() as { id: string; status: string; scope: string }[];
  return { env, videos, call, ctx, needApprover, tierAudit, requests };
}

describe('tiers.change on the approval workflow', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('is direct by default: the tier route changes the tier at once and proposes nothing', async () => {
    const res = await t.call('PUT', '/users/u1/creator-tier', { tierId: 'creator' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(t.videos.assignments.get('u1')?.tierId, 'creator');
    assert.equal(t.requests().length, 0);
    assert.equal((await t.tierAudit()).length, 1);
  });

  it('a scope given approvers becomes a request; it runs on approval under the proposer\'s name, audited with the request id', async () => {
    await t.needApprover('assign');
    const res = await t.call('PUT', '/users/u1/creator-tier', { tierId: 'creator', reason: 'Asked by email' });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.result.status, 'pending_approval');
    assert.equal(t.videos.assignments.get('u1'), undefined, 'nothing changes before approval');
    assert.equal((await t.tierAudit()).length, 0);

    const id = res.body.result.request.id as string;
    await assert.rejects(approveRequest(t.ctx, await t.ctx.directory.actor('admin-1', ['super_admin']), id, {}), /approval_not_allowed/, 'never the proposer');
    const done = await approveRequest(t.ctx, await t.ctx.directory.actor('sa-2', ['super_admin']), id, {});
    assert.equal(done.status, 'applied');
    assert.equal(t.videos.assignments.get('u1')?.tierId, 'creator');
    const [row] = await t.tierAudit();
    assert.equal(row.actor_id, 'admin-1', 'the person who asked');
    assert.equal(JSON.parse(row.new_value).details.workflowRequest, id);
  });

  it('a run after approval is safe to repeat: no second write, no second audit row', async () => {
    await t.needApprover('assign');
    const res = await t.call('PUT', '/users/u1/creator-tier', { tierId: 'creator' });
    const id = res.body.result.request.id as string;
    await approveRequest(t.ctx, await t.ctx.directory.actor('sa-2', ['super_admin']), id, {});
    await runTierOp(t.env as never, 'admin-1', { op: 'assign', userId: 'u1', tierId: 'creator', source: 'admin', confirmSuperAdmin: false }, id);
    assert.deepEqual(t.videos.writes, ['assign:u1:creator']);
    assert.equal((await t.tierAudit()).length, 1);
  });

  it('the same refusals before anyone is asked: a super admin\'s automatic tier needs the explicit confirmation', async () => {
    await t.needApprover('assign');
    const res = await t.call('PUT', '/users/u-super/creator-tier', { tierId: 'creator' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'super_admin_tier');
    assert.equal(t.requests().length, 0, 'nothing proposed');
    // and on the direct path
    const t2 = setup();
    assert.equal((await t2.call('PUT', '/users/u-super/creator-tier', { tierId: 'creator' })).body.code, 'super_admin_tier');
  });

  it('scopes are independent: approvers on the default tier leave a creator\'s tier direct', async () => {
    await t.needApprover('default');
    const def = await t.call('PUT', '/creator-tiers/default', { tierId: 'creator' });
    assert.equal(def.status, 202, JSON.stringify(def.body));
    assert.equal(t.videos.state.defaultTierId, 'member');
    assert.equal(t.requests()[0].scope, 'default');
    assert.equal((await t.call('PUT', '/users/u1/creator-tier', { tierId: 'creator' })).status, 200);
    const done = await approveRequest(t.ctx, await t.ctx.directory.actor('sa-2', ['super_admin']), def.body.result.request.id, {});
    assert.equal(done.status, 'applied');
    assert.equal(t.videos.state.defaultTierId, 'creator');
  });

  it('only creators:manage may change a tier, direct or proposed', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: 'mod-1', roles: ['moderator'] } as never);
      await next();
    });
    app.route('/api/content', contentRouter);
    const r = await app.request('/api/content/users/u1/creator-tier', { method: 'PUT', body: JSON.stringify({ tierId: 'creator' }), headers: { 'Content-Type': 'application/json' } }, t.env as never);
    assert.equal(r.status, 403);
  });
});

describe('tiers.change scopes', () => {
  it('every route maps to one of the three scopes, and the rules page lists all three with names in both languages', () => {
    assert.equal(tierScope({ op: 'bulk', userIds: ['a'], tierId: 'x' }), 'assign');
    assert.equal(tierScope({ op: 'approveRequest', requestId: 'r' }), 'assign');
    assert.equal(tierScope({ op: 'setDefault', tierId: 'x', undo: false }), 'default');
    assert.equal(tierScope({ op: 'reorder', ids: ['a'], undo: false }), 'tiers');
    assert.deepEqual(WORKFLOW_LISTED_SCOPES['tiers.change'], TIER_CHANGE_SCOPES);
    for (const scope of TIER_CHANGE_SCOPES) {
      const label = workflowScopeLabel('tiers.change', scope);
      assert.ok(label?.en && label.ar, scope);
    }
    assert.equal(WORKFLOW_ACTIONS['tiers.change'].defaultRule.approvalsNeeded, 0, 'WF-D1: direct');
  });
});
