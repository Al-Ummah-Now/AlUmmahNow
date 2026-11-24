/**
 * Tier changes on the approval workflow (wiki AUN-WORKFLOWS WF-10, owner WF-D1: tiers are direct until
 * an admin adds approvers). Direct scopes keep the tier routes exactly as they were; a scope given
 * approvers turns its routes into change requests (202) that run on approval under the proposer's name,
 * with the same checks and audit rows; a retry never repeats what an earlier attempt did; scopes are
 * independent; nobody approves a change about themselves; a scope's rule can ask for a step-up.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { TIER_CHANGE_SCOPES, WORKFLOW_ACTIONS, WORKFLOW_LISTED_SCOPES, workflowScopeLabel } from '@al-ummah/shared-types';
import contentRouter from '../src/routers/content.router';
import { registerStepUpRoutes } from '../src/middleware/step-up-routes';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { approveRequest, retryRequest, ruleVersionStatement } from '../src/lib/workflows/engine';
import { TIER_DIFF_FIELDS, tierScope } from '../src/lib/workflows/tier-actions';
import workflowsRouter, { workflowCtx } from '../src/routers/workflows.router';
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

/** api-videos' TierBody is strict: a field it doesn't know is a 400. Kept equal to it by a test below. */
const TIER_BODY = [
  'id', 'name', 'unlimited', 'perHour', 'perDay', 'maxConcurrent', 'maxChannels', 'captionMinutesMonth', 'importCountsAgainstLimits', 'audioTracksPerVideo',
  'recitationMetadata', 'notesMax', 'supportReceive', 'live', 'liveHoursMonth', 'liveMaxConcurrent', 'liveMaxStreamMinutes', 'liveChat', 'livePremieres', 'liveEvents',
  'uploads', 'channels', 'pages', 'requestable', 'hidden', 'sortOrder', 'nameAr', 'description', 'descriptionAr',
];

type Assignment = { tierId: string; source: string; assignedBy?: string; assignedAt?: string };
type Tier = { id: string; name: string; nameAr?: string; perHour?: number; updatedAt?: string; updatedBy?: string };

/** api-videos' tier routes with state, and its answers going missing on demand. */
function fakeVideos() {
  const assignments = new Map<string, Assignment>([['u-super', { tierId: 'unlimited', source: 'admin', assignedBy: 'system:super-admin' }]]);
  const state = {
    tiers: [{ id: 'member', name: 'Member', nameAr: 'عضو', perHour: 1 }, { id: 'creator', name: 'Creator', nameAr: 'صانع', perHour: 5 }, { id: 'unlimited', name: 'Unlimited' }] as Tier[],
    defaultTierId: 'member',
    deleted: [] as { id: string; deletedAt: string; deletedBy: string }[],
    request: { id: 'tr1', userId: 'u1', tierId: 'creator', status: 'pending', currentTierId: 'member', currentIsDefault: true, decidedAt: null as string | null, decidedBy: null as string | null },
  };
  const writes: string[] = [];
  /** 'lost': the next write is made but its answer is a 502; 'down': from then on nothing answers; 'refused': the next write is a 503 that made nothing */
  const fail = { next: null as 'lost' | 'lost-then-down' | 'refused' | null, down: false };
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const ok = (result: unknown) => answer(200, { success: true, result });
  const wrote = (what: string, make: () => unknown) => {
    const mode = fail.next;
    fail.next = null;
    if (mode === 'refused') return answer(503, { success: false, code: 'unavailable', error: 'unavailable' });
    writes.push(what);
    const result = make();
    if (!mode) return ok(result);
    if (mode === 'lost-then-down') fail.down = true;
    return answer(502, { success: false, code: 'bad_gateway', error: 'lost' });
  };
  return {
    assignments,
    state,
    writes,
    fail,
    fetcher: {
      async fetch(input: string, init: RequestInit = {}) {
        if (fail.down) throw new Error('network down');
        const url = new URL(input);
        const path = url.pathname.replace('/internal/admin', '');
        const method = init.method ?? 'GET';
        const actor = (init.headers as Record<string, string>)['X-Admin-Actor'];
        const at = new Date().toISOString();
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, any>) : {};
        const unknown = Object.keys(body).filter((k) => !TIER_BODY.includes(k));
        const user = path.match(/^\/users\/([^/]+)\/creator-tier$/);
        if (user) {
          const id = decodeURIComponent(user[1]);
          if (method !== 'PUT') return ok({ assignment: assignments.get(id) ?? null });
          return wrote(`assign:${id}:${body.tierId}`, () => {
            assignments.set(id, { tierId: body.tierId, source: body.source, assignedBy: actor, assignedAt: at });
            return { assignment: assignments.get(id) };
          });
        }
        if (path === '/creators/tier') {
          const plan = {
            changed: (body.userIds as string[]).filter((u) => assignments.get(u)?.tierId !== body.tierId && u !== 'u-super').map((userId) => ({ userId, previous: assignments.get(userId) ?? null })),
            unchanged: (body.userIds as string[]).filter((u) => assignments.get(u)?.tierId === body.tierId),
            skippedSuperAdmin: (body.userIds as string[]).filter((u) => u === 'u-super'),
          };
          if (body.dryRun) return ok(plan);
          return wrote(`bulk:${plan.changed.map((ch) => ch.userId).join(',')}:${body.tierId}`, () => {
            for (const ch of plan.changed) assignments.set(ch.userId, { tierId: body.tierId, source: 'admin', assignedBy: actor });
            return plan;
          });
        }
        if (path === '/creator-tiers' && method === 'GET') return ok({ items: state.tiers, defaultTierId: state.defaultTierId });
        if (path === '/creator-tiers' && method === 'POST') {
          if (unknown.length) return answer(400, { success: false, code: 'invalid_request', error: `unknown ${unknown.join(',')}` });
          return wrote(`create:${body.name.trim()}`, () => {
            const base = body.name.trim().toLowerCase().replace(/ /g, '-');
            const tier = { ...body, id: state.tiers.some((t) => t.id === base) ? `${base}-2` : base, name: body.name.trim(), updatedAt: at, updatedBy: actor };
            state.tiers = [...state.tiers, tier];
            return { tier };
          });
        }
        if (path === '/creator-tiers/default') {
          return wrote(`default:${body.tierId}`, () => {
            state.defaultTierId = body.tierId;
            return { defaultTierId: body.tierId };
          });
        }
        if (path === '/creator-tiers/order') {
          return wrote(`order:${body.ids.join(',')}`, () => {
            state.tiers = body.ids.map((id: string) => state.tiers.find((t) => t.id === id)!);
            return { order: body.ids };
          });
        }
        if (path === '/creator-tiers/deleted') return ok({ items: state.deleted });
        const tier = path.match(/^\/creator-tiers\/([^/]+)$/)?.[1];
        if (tier && method === 'PUT') {
          if (unknown.length) return answer(400, { success: false, code: 'invalid_request', error: `unknown ${unknown.join(',')}` });
          return wrote(`edit:${tier}`, () => {
            state.tiers = state.tiers.map((t) => (t.id === tier ? { ...t, ...body, updatedAt: at, updatedBy: actor } : t));
            return { tier: state.tiers.find((t) => t.id === tier) };
          });
        }
        if (tier && method === 'DELETE') {
          if (!state.tiers.some((t) => t.id === tier)) return answer(404, { success: false, code: 'tier_not_found', error: 'gone' });
          return wrote(`delete:${tier}`, () => {
            state.tiers = state.tiers.filter((t) => t.id !== tier);
            state.deleted.push({ id: tier, deletedAt: at, deletedBy: actor });
            return { deleted: tier };
          });
        }
        if (path === '/tier-requests/tr1') return ok({ request: state.request });
        if (path === '/tier-requests/tr1/decide') {
          return wrote('approve:tr1', () => {
            state.request = { ...state.request, status: 'approved', decidedAt: at, decidedBy: actor };
            assignments.set('u1', { tierId: 'creator', source: 'admin', assignedBy: actor });
            return { request: state.request };
          });
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
  const mails: Record<string, unknown>[] = [];
  const env = { SEARCH_DB: search, REPORTS_DB: reports, VIDEOS: videos.fetcher, INTERNAL_API_KEY: 'k', CONTACT_MAIL_QUEUE: { send: async (m: Record<string, unknown>) => void mails.push(m) } };
  const app = new Hono();
  app.use('*', errorEnvelope);
  app.use('*', async (c, next) => {
    const fresh = c.req.header('x-test-stale') !== '1';
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'admin-1', roles: (c.req.header('x-test-roles') ?? 'admin').split(','), payload: fresh ? { auth_time: Math.floor(Date.now() / 1000) } : {} } as never);
    await next();
  });
  registerStepUpRoutes(app as never);
  app.route('/api/content', contentRouter);
  const call = async (method: string, path: string, json: unknown = {}, headers: Record<string, string> = {}) => {
    const res = await app.request(`/api/content${path}`, { method, body: JSON.stringify(json), headers: { 'Content-Type': 'application/json', ...headers } }, env as never);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const ctx = workflowCtx(env as never, { steppedUp: true, onEvent: async () => {} });
  /** Sets a tiers.change scope's rule (the rules page's change, seeded here); by default one super-admin approver. */
  let version = 0;
  const rule = (scope: string, config: Record<string, unknown>) =>
    ruleVersionStatement(ctx, { type: 'tiers.change', scope, version: ++version, config: { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['tiers.change'].defaultRule)), ...config }, requestId: null, by: 'seed' }).run();
  const needApprover = (scope: string) => rule(scope, { approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }] });
  const superAdmin = (id: string) => ctx.directory.actor(id, ['super_admin']);
  const approve = async (id: string, who = 'sa-2') => approveRequest(ctx, await superAdmin(who), id, {});
  const retry = async (id: string) => retryRequest(ctx, await superAdmin('sa-2'), id);
  const tierAudit = async () =>
    ((await reports.prepare("SELECT key, old_value, new_value, actor_id FROM site_settings_log WHERE (key LIKE 'content:user:%' OR key LIKE 'content:creator-tier:%' OR key LIKE 'content:tier-request:%') ORDER BY created_at, id").bind().all()) as { results: { key: string; old_value: string | null; new_value: string; actor_id: string }[] }).results;
  const requests = () => search.raw.prepare('SELECT id, status, scope, reason FROM workflow_requests').all() as { id: string; status: string; scope: string; reason: string }[];
  return { env, search, videos, mails, call, ctx, rule, needApprover, approve, retry, tierAudit, requests };
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
    await assert.rejects(t.approve(id, 'admin-1'), /approval_not_allowed/, 'never the proposer');
    const done = await t.approve(id);
    assert.equal(done.status, 'applied');
    assert.equal(t.videos.assignments.get('u1')?.tierId, 'creator');
    const [row] = await t.tierAudit();
    assert.equal(row.actor_id, 'admin-1', 'the person who asked');
    assert.equal(JSON.parse(row.new_value).details.workflowRequest, id);
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
    const done = await t.approve(def.body.result.request.id);
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

/** Every operation: the route, what it changes, and its audit rows (key, action). */
const OPERATIONS: { name: string; scope: string; method: string; path: string; json: Record<string, unknown>; write: string; audit: string[] }[] = [
  { name: 'assign', scope: 'assign', method: 'PUT', path: '/users/u1/creator-tier', json: { tierId: 'creator' }, write: 'assign:u1:creator', audit: ['content:user:u1'] },
  { name: 'bulk', scope: 'assign', method: 'POST', path: '/creators/tier', json: { userIds: ['u1', 'u2', 'u-super'], tierId: 'creator' }, write: 'bulk:u1,u2:creator', audit: ['content:user:u1', 'content:user:u2'] },
  { name: 'approveRequest', scope: 'assign', method: 'POST', path: '/tier-requests/tr1/approve', json: {}, write: 'approve:tr1', audit: ['content:tier-request:tr1', 'content:user:u1'] },
  { name: 'setDefault', scope: 'default', method: 'PUT', path: '/creator-tiers/default', json: { tierId: 'creator' }, write: 'default:creator', audit: ['content:creator-tier:default'] },
  { name: 'create', scope: 'tiers', method: 'POST', path: '/creator-tiers', json: { name: ' Gold ', nameAr: 'ذهبي', perHour: 9 }, write: 'create:Gold', audit: ['content:creator-tier:gold'] },
  { name: 'edit', scope: 'tiers', method: 'PUT', path: '/creator-tiers/creator', json: { name: 'Creator', perHour: 8 }, write: 'edit:creator', audit: ['content:creator-tier:creator'] },
  { name: 'delete', scope: 'tiers', method: 'DELETE', path: '/creator-tiers/creator', json: {}, write: 'delete:creator', audit: ['content:creator-tier:creator'] },
  { name: 'reorder', scope: 'tiers', method: 'PUT', path: '/creator-tiers/order', json: { ids: ['creator', 'member', 'unlimited'] }, write: 'order:creator,member,unlimited', audit: ['content:creator-tier:order'] },
];

for (const op of OPERATIONS) {
  describe(`tiers.change: ${op.name}`, () => {
    let t: ReturnType<typeof setup>;
    beforeEach(() => {
      t = setup();
    });
    const keys = async () => (await t.tierAudit()).map((r) => r.key).sort();
    const propose = async () => {
      await t.needApprover(op.scope);
      const res = await t.call(op.method, op.path, { ...op.json, reason: 'Agreed with the team' });
      assert.equal(res.status, 202, JSON.stringify(res.body));
      return res.body.result.request.id as string;
    };

    it('direct: runs at once, with a reason or without, and proposes nothing', async () => {
      const res = await t.call(op.method, op.path, { ...op.json, reason: 'Agreed with the team' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(t.videos.writes, [op.write]);
      assert.deepEqual(await keys(), op.audit);
      assert.equal(t.requests().length, 0);
    });

    it('with approvers: 202 with the reason, then applied once, under the proposer\'s name and audited with the request', async () => {
      const id = await propose();
      assert.deepEqual(t.videos.writes, []);
      assert.deepEqual(await keys(), []);
      assert.equal(t.requests()[0].reason, 'Agreed with the team');
      assert.equal((await t.approve(id)).status, 'applied');
      assert.deepEqual(t.videos.writes, [op.write]);
      assert.deepEqual(await keys(), op.audit);
      for (const row of await t.tierAudit()) {
        assert.equal(row.actor_id, 'admin-1');
        const { details } = JSON.parse(row.new_value);
        assert.equal(details.workflowRequest, id);
        // Recently deleted shows a deleted tier's reason; anything else keeps it on the request only
        assert.equal(details.reason, op.name === 'delete' ? 'Agreed with the team' : undefined);
      }
    });

    it('a refused attempt leaves nothing behind, and Retry makes the change once', async () => {
      const id = await propose();
      t.videos.fail.next = 'refused';
      assert.equal((await t.approve(id)).status, 'failed');
      assert.deepEqual(await keys(), [], 'no audit row for a change that did not happen');
      assert.equal((await t.retry(id)).status, 'applied');
      assert.deepEqual(t.videos.writes, [op.write]);
      assert.deepEqual(await keys(), op.audit);
    });

    it('a change made while its answer was lost, with nothing answering after it: Retry finishes it without a second write', async () => {
      const id = await propose();
      t.videos.fail.next = 'lost-then-down';
      assert.equal((await t.approve(id)).status, 'failed');
      t.videos.fail.down = false;
      assert.equal((await t.retry(id)).status, 'applied', 'not stale: the change is this request\'s own');
      assert.deepEqual(t.videos.writes, [op.write]);
      assert.deepEqual(await keys(), op.audit, 'each audit row exactly once');
      for (const row of await t.tierAudit()) assert.equal(row.actor_id, 'admin-1');
    });

    if (op.name !== 'bulk') {
      it('a change made while only its answer was lost counts as applied at once', async () => {
        const id = await propose();
        t.videos.fail.next = 'lost';
        assert.equal((await t.approve(id)).status, 'applied');
        assert.deepEqual(t.videos.writes, [op.write]);
        assert.deepEqual(await keys(), op.audit);
      });
    }

    it('the engine failing after the change was made: Retry applies without a second write or audit row', async () => {
      const id = await propose();
      const batch = t.search.batch;
      // The batch that would mark the request applied fails once
      let broken = false;
      t.search.batch = async (stmts) => {
        if (!broken && t.videos.writes.length) {
          broken = true;
          throw new Error('D1 unavailable');
        }
        return batch(stmts);
      };
      assert.equal((await t.approve(id)).status, 'failed');
      assert.equal((await t.retry(id)).status, 'applied');
      assert.deepEqual(t.videos.writes, [op.write]);
      assert.deepEqual(await keys(), op.audit);
    });
  });
}

describe('tiers.change: a tier request approved', () => {
  it('a retry that finds it approved still writes the decision row and queues the notice', async () => {
    const t = setup();
    await t.needApprover('assign');
    const id = (await t.call('POST', '/tier-requests/tr1/approve')).body.result.request.id as string;
    t.videos.fail.next = 'lost-then-down';
    assert.equal((await t.approve(id)).status, 'failed');
    const notices = () => t.mails.filter((m) => m.kind === 'tier_request').map((m) => m.requestId);
    assert.deepEqual(notices(), []);
    t.videos.fail.down = false;
    assert.equal((await t.retry(id)).status, 'applied');
    assert.deepEqual(notices(), ['tr1']);
    assert.equal((await t.tierAudit()).filter((r) => r.key === 'content:tier-request:tr1').length, 1);
  });

  it('decided by someone else meanwhile: never taken for this request\'s work', async () => {
    const t = setup();
    await t.needApprover('assign');
    const id = (await t.call('POST', '/tier-requests/tr1/approve')).body.result.request.id as string;
    t.videos.fail.next = 'refused';
    assert.equal((await t.approve(id)).status, 'failed');
    t.videos.state.request = { ...t.videos.state.request, status: 'approved', decidedBy: 'someone-else', decidedAt: new Date().toISOString() };
    assert.equal((await t.retry(id)).status, 'stale');
    assert.equal((await t.tierAudit()).length, 0);
  });
});

describe('tiers.change: a creator\'s tier', () => {
  it('the same tier the proposer gave before the request is not taken for this request\'s work', async () => {
    const t = setup();
    t.videos.assignments.set('u1', { tierId: 'creator', source: 'admin', assignedBy: 'admin-1', assignedAt: '2026-01-01T00:00:00.000Z' });
    await t.needApprover('assign');
    const id = (await t.call('PUT', '/users/u1/creator-tier', { tierId: 'creator' })).body.result.request.id as string;
    t.videos.fail.next = 'refused';
    assert.equal((await t.approve(id)).status, 'failed');
    assert.equal((await t.retry(id)).status, 'applied');
    assert.deepEqual(t.videos.writes, ['assign:u1:creator']);
  });
});

describe('tiers.change: adding a tier named like another', () => {
  it('a tier with the same name already there is not taken for the new one', async () => {
    const t = setup();
    t.videos.state.tiers.push({ id: 'gold', name: 'Gold', updatedBy: 'admin-1', updatedAt: '2026-01-01T00:00:00.000Z' });
    await t.needApprover('tiers');
    const id = (await t.call('POST', '/creator-tiers', { name: 'Gold' })).body.result.request.id as string;
    t.videos.fail.next = 'refused';
    assert.equal((await t.approve(id)).status, 'failed');
    assert.equal((await t.retry(id)).status, 'applied');
    assert.deepEqual(t.videos.state.tiers.map((x) => x.id), ['member', 'creator', 'unlimited', 'gold', 'gold-2']);
    assert.deepEqual((await t.tierAudit()).map((r) => r.key), ['content:creator-tier:gold-2']);
  });

  it('the target changed by someone else while the request was failed: out of date, nothing written', async () => {
    const t = setup();
    await t.needApprover('tiers');
    const id = (await t.call('PUT', '/creator-tiers/creator', { perHour: 8 })).body.result.request.id as string;
    t.videos.fail.next = 'refused';
    await t.approve(id);
    t.videos.state.tiers = t.videos.state.tiers.map((x) => (x.id === 'creator' ? { ...x, perHour: 3, updatedBy: 'someone-else', updatedAt: new Date().toISOString() } : x));
    assert.equal((await t.retry(id)).status, 'stale');
    assert.deepEqual(t.videos.writes, []);
  });
});

describe('tiers.change: a bulk change', () => {
  it('nobody in it approves it, gets it in their inbox, or sees Approve (§4.3)', async () => {
    const t = setup();
    for (const id of ['sa-2', 'sa-3']) await t.env.REPORTS_DB.prepare('INSERT INTO admin_staff (user_id, role, active, last_seen_at, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)').bind(id, 'super_admin', 'x', 'x', 'x').run();
    await t.needApprover('assign');
    const res = await t.call('POST', '/creators/tier', { userIds: ['u1', 'sa-2'], tierId: 'creator' });
    const id = res.body.result.request.id as string;
    await assert.rejects(t.approve(id, 'sa-2'), (e: any) => e.code === 'approval_not_allowed' && e.extra.blocks.includes('subject'));
    assert.deepEqual(t.search.raw.prepare('SELECT user_id FROM workflow_inbox').all().map((r) => r.user_id), ['sa-3']);
    assert.equal((await t.approve(id, 'sa-3')).status, 'applied');
  });

  it('a bulk change of one person is about that person', async () => {
    const t = setup();
    await t.needApprover('assign');
    await t.call('POST', '/creators/tier', { userIds: ['u1'], tierId: 'creator' });
    assert.equal(t.search.raw.prepare('SELECT subject_user_id AS s FROM workflow_requests').get()!.s, 'u1');
  });

  it('the diff names everyone who would move, under the tier they hold now, and not the ones left alone', async () => {
    const t = setup();
    t.videos.assignments.set('u2', { tierId: 'member', source: 'admin' });
    t.videos.assignments.set('u3', { tierId: 'creator', source: 'admin' });
    await t.needApprover('assign');
    const res = await t.call('POST', '/creators/tier', { userIds: ['u1', 'u2', 'u3', 'u-super'], tierId: 'creator' });
    const fields = res.body.result.request.fields as { key: string; kind: string; label: { en: string; ar: string }; after: unknown }[];
    assert.deepEqual(fields.filter((f) => f.kind === 'person').map((f) => [f.key, f.after]), [['users:', ['u1']], ['users:member', ['u2']]]);
    assert.deepEqual(fields.find((f) => f.key === 'users:member')!.label, { en: 'Creators now on Member', ar: 'صنّاع المحتوى في فئة «عضو»' });
    assert.equal(fields.find((f) => f.key === 'count')!.after, 2);
  });

  it('nobody would move: answered at once, nothing to approve', async () => {
    const t = setup();
    t.videos.assignments.set('u1', { tierId: 'creator', source: 'admin' });
    await t.needApprover('assign');
    const res = await t.call('POST', '/creators/tier', { userIds: ['u1'], tierId: 'creator' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.result.unchanged, ['u1']);
    assert.equal(t.requests().length, 0);
  });
});

describe('tiers.change: a rule that becomes direct while a change is being proposed', () => {
  for (const [outcome, fail] of [['applied', null], ['failed', 'refused']] as const) {
    it(`answers like a direct change that ${outcome}`, async () => {
      const t = setup();
      await t.needApprover('assign');
      // The rule is made direct after the route has read it (the proposer's facts are read in between)
      const prepare = t.search.prepare;
      let done = false;
      t.search.prepare = (sql: string) => {
        if (!done && sql.includes('support_tech_staff')) {
          done = true;
          void t.rule('assign', { approvalsNeeded: 0 });
        }
        return prepare(sql);
      };
      t.videos.fail.next = fail;
      const res = await t.call('PUT', '/users/u1/creator-tier', { tierId: 'creator' });
      assert.ok(done);
      if (outcome === 'applied') {
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.result.assignment.tierId, 'creator', 'the same answer as a direct change');
      } else {
        assert.equal(res.status, 500, 'never an answer that reads as saved');
        assert.equal(res.body.success, false);
        assert.equal(res.body.requestId, t.requests()[0].id);
        assert.deepEqual(t.videos.writes, []);
      }
    });
  }
});

describe('tiers.change: step-up', () => {
  for (const op of OPERATIONS) {
    it(`${op.name}: the scope's rule decides, direct or with approvers`, async () => {
      const stale = { 'x-test-stale': '1' };
      const t = setup();
      // Another scope's rule says nothing about this one
      await t.rule(op.scope === 'assign' ? 'default' : 'assign', { stepUp: 'propose_and_approve' });
      assert.equal((await t.call(op.method, op.path, op.json, stale)).status, 200);
      for (const approvalsNeeded of [0, 1]) {
        const x = setup();
        await x.rule(op.scope, { stepUp: 'propose_and_approve', approvalsNeeded, approvers: [{ kind: 'role', role: 'super_admin' }] });
        const refused = await x.call(op.method, op.path, op.json, stale);
        assert.equal(refused.status, 401, JSON.stringify(refused.body));
        assert.equal(refused.body.code, 'step_up_required');
        assert.deepEqual(x.videos.writes, []);
        assert.equal(x.requests().length, 0);
        assert.equal((await x.call(op.method, op.path, op.json)).status, approvalsNeeded ? 202 : 200);
      }
    });
  }
});

describe('tiers.change: requests the admin pages show as waiting', () => {
  it('one lookup answers each target with its open request, and not once it is decided', async () => {
    const t = setup();
    await t.needApprover('assign');
    const id = (await t.call('PUT', '/users/u1/creator-tier', { tierId: 'creator' })).body.result.request.id as string;
    const pending = async (query: string, roles = ['admin']) => {
      const app = new Hono();
      app.use('*', errorEnvelope);
      app.use('*', async (c, next) => {
        c.set('auth' as never, { userId: 'admin-1', roles } as never);
        await next();
      });
      app.route('/api/workflows', workflowsRouter as never);
      const res = await app.request(`/api/workflows/pending?${query}`, {}, t.env as never);
      return { status: res.status, items: ((await res.json()) as any).result?.items };
    };
    const query = 'type=tiers.change&target=user:u1&target=user:u2&target=creator-tiers:reorder';
    assert.deepEqual(await pending(query), { status: 200, items: { 'user:u1': id } });
    assert.equal((await pending(query, ['user'])).status, 403);
    assert.equal((await pending('type=nope&target=user:u1')).status, 404);
    assert.deepEqual((await pending('type=tiers.change')).items, {});
    assert.deepEqual((await pending('type=support.fees.set&target=user:u1')).items, {});
    await t.approve(id);
    assert.deepEqual((await pending(query)).items, {});
  });
});

describe('tiers.change: the diff', () => {
  it('names every field api-videos accepts, in both languages, and the tiers by name', async () => {
    const source = readFileSync(join(process.cwd(), '..', 'api-videos', 'src', 'routers', 'admin.router.ts'), 'utf8');
    const body = source.slice(source.indexOf('const TierBody = z'), source.indexOf('.strict();', source.indexOf('const TierBody = z')));
    const accepted = [...body.matchAll(/^\t\t(\w+): z/gm)].map((m) => m[1]);
    assert.deepEqual([...accepted].sort(), [...TIER_BODY].sort(), 'the fake api-videos knows the same fields');
    assert.deepEqual(accepted.filter((f) => f !== 'id' && !TIER_DIFF_FIELDS.includes(f)), []);

    const t = setup();
    await t.needApprover('tiers');
    const view = (await t.call('PUT', '/creator-tiers/creator', { perHour: 8 })).body.result.request;
    assert.deepEqual(view.title, { en: 'Edit the Creator tier', ar: 'تعديل فئة «صانع»' });
    assert.deepEqual(view.fields, [{ key: 'perHour', label: { en: 'Uploads per hour', ar: 'عمليات الرفع في الساعة' }, kind: 'count', before: 5, after: 8 }]);
    await t.needApprover('default');
    const def = (await t.call('PUT', '/creator-tiers/default', { tierId: 'creator' })).body.result.request;
    assert.deepEqual(def.title, { en: 'Make Creator the default tier', ar: 'جعل «صانع» الفئة الأساسية' });
    assert.deepEqual([def.fields[0].before, def.fields[0].after, def.fields[0].enumLabels.creator], ['member', 'creator', { en: 'Creator', ar: 'صانع' }]);
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
