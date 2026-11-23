/**
 * /api/workflows (wiki AUN-WORKFLOWS §8): rule changes are themselves requests, money rules belong to
 * the finance list, step-up when the rule asks, money requests are hidden from people who can't see
 * money, every step is mirrored into the audit log, and the error codes are in the catalogue.
 * Real SQL for the search and reports databases; the real step-up middleware.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { API_ERROR_CATALOGUE, WORKFLOW_ERROR_CODES, WORKFLOW_ERROR_MESSAGES } from '@al-ummah/shared-types';
import workflowsRouter from '../src/routers/workflows.router';
import { registerStepUpRoutes } from '../src/middleware/step-up-routes';
import { errorEnvelope } from '../src/middleware/error-envelope';
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

const at = '2026-11-23T00:00:00Z';

async function setup() {
  const search = searchD1();
  const reports = sqliteD1();
  for (const [u, role] of [['sa1', 'super_admin'], ['sa2', 'super_admin'], ['owner', 'super_admin'], ['adm', 'admin']] as const) {
    await reports.prepare('INSERT INTO admin_staff (user_id, role, name, email, active, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, ?, ?, ?)').bind(u, role, u, at, at, at).run();
  }
  search.raw.exec(`INSERT INTO support_tech_staff (user_id, marked_by, marked_at) VALUES ('owner', 'sa1', '${at}')`);
  for (const [u, perms] of [['fin1', ['support:providers']], ['fin2', ['support:providers', 'support:payouts']]] as const) {
    search.raw.prepare("INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at) VALUES (?, ?, 'x', 'y', ?)").run(u, JSON.stringify(perms), at);
  }
  const env = { SEARCH_DB: search, REPORTS_DB: reports };
  const as = (userId: string, roles: string[], fresh = true) => {
    const app = new Hono();
    app.use('*', errorEnvelope);
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId, roles, payload: fresh ? { auth_time: Math.floor(Date.now() / 1000) } : {} } as never);
      await next();
    });
    registerStepUpRoutes(app as never);
    app.route('/api/workflows', workflowsRouter as never);
    return async (method: string, path: string, json?: unknown) => {
      const res = await app.request(`/api/workflows${path}`, { method, body: json === undefined ? undefined : JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }, env as never);
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
  };
  return { search, reports, as };
}

const featureRule = (approvalsNeeded: number) => ({
  approvalsNeeded,
  approvers: [{ kind: 'role', role: 'super_admin' }],
  exclusions: { subject: true, techStaff: false, owner: false, oneStepPerPerson: true },
  stepUp: 'approve',
  expiryHours: 168,
  effectiveDate: { allowed: false, maxDaysAhead: 0 },
  notify: { email: true, extra: [] },
});

describe('rule changes', () => {
  it('a super admin proposes, a second approves with a step-up, and the new rule is in force and audited', async () => {
    const t = await setup();
    const a = t.as('sa1', ['super_admin']);
    const proposed = await a('POST', '/rules/features.set', { scope: 'live', config: featureRule(1), reason: 'Live needs two people' });
    assert.equal(proposed.status, 202, JSON.stringify(proposed.body));
    const id = proposed.body.result.request.id as string;
    assert.equal(proposed.body.result.status, 'pending_approval');

    const stale = await t.as('sa2', ['super_admin'], false)('POST', `/requests/${id}/approve`, {});
    assert.equal(stale.status, 401, 'needs a fresh sign-in');
    assert.equal((await t.as('sa1', ['super_admin'])('POST', `/requests/${id}/approve`, {})).body.code, 'approval_not_allowed');
    assert.equal((await t.as('sa2', ['super_admin'])('GET', '/counts')).body.result.waitingForMe, 1);
    const approved = await t.as('sa2', ['super_admin'])('POST', `/requests/${id}/approve`, { version: 1 });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.result.status, 'applied');

    const actions = (await a('GET', '/actions')).body.result.actions as { type: string; rules: { scope: string; config: { approvalsNeeded: number } }[] }[];
    const features = actions.find((x) => x.type === 'features.set')!;
    assert.equal(features.rules.find((r) => r.scope === 'live')!.config.approvalsNeeded, 1);
    const history = (await a('GET', '/rules/features.set/history?scope=live')).body.result.versions;
    assert.equal(history.length, 1);
    assert.equal(history[0].request_id, id);

    const audit = await t.reports.prepare("SELECT key, new_value FROM site_settings_log WHERE key = ? ORDER BY created_at").bind(`content:workflow:${id}`).all<{ key: string; new_value: string }>();
    assert.deepEqual((audit.results ?? []).map((r) => JSON.parse(r.new_value).action), ['proposed', 'approved', 'applied']);
  });

  it('admins (not super admins) cannot change rules; bad values are refused', async () => {
    const t = await setup();
    assert.equal((await t.as('adm', ['admin'])('POST', '/rules/features.set', { scope: 'x', config: featureRule(1), reason: 'r' })).body.code, 'propose_not_allowed');
    const bad = await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'x', config: { ...featureRule(1), expiryHours: 0 }, reason: 'r' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'rule_invalid');
    assert.equal((await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'x', config: featureRule(1) })).status, 400, 'a reason is required');
  });
});

describe('money rules', () => {
  const feeRule = (approvalsNeeded: number) => ({
    approvalsNeeded,
    approvers: [{ kind: 'finance', permission: 'support:providers' }],
    exclusions: { subject: true, techStaff: true, owner: true, oneStepPerPerson: true },
    stepUp: 'propose_and_approve',
    expiryHours: 168,
    effectiveDate: { allowed: true, maxDaysAhead: 90 },
    notify: { email: true, extra: [] },
  });

  it('belong to the finance list: super admins and the owner can neither propose nor approve them', async () => {
    const t = await setup();
    assert.equal((await t.as('sa1', ['super_admin'])('POST', '/rules/support.fees.set', { config: feeRule(2), reason: 'r' })).body.code, 'propose_not_allowed');
    assert.equal((await t.as('owner', ['super_admin'])('POST', '/rules/support.fees.set', { config: feeRule(2), reason: 'r' })).body.code, 'propose_not_allowed');
    const proposed = await t.as('fin1', [])('POST', '/rules/support.fees.set', { config: feeRule(2), reason: 'Two people for fees' });
    assert.equal(proposed.status, 202, JSON.stringify(proposed.body));
    const id = proposed.body.result.request.id as string;
    assert.equal((await t.as('owner', ['super_admin'])('POST', `/requests/${id}/approve`, {})).body.code, 'approval_not_allowed', 'the owner never approves money');
    assert.equal((await t.as('sa2', ['super_admin'])('POST', `/requests/${id}/approve`, {})).body.code, 'approval_not_allowed', 'a super admin role alone is not enough');
    assert.equal((await t.as('adm', ['admin'])('GET', `/requests/${id}`)).status, 403, 'admins without support:read cannot see money');
    assert.equal((await t.as('fin2', [])('POST', `/requests/${id}/approve`, {})).body.result.status, 'applied');
  });

  it('cannot go below the floor', async () => {
    const t = await setup();
    const res = await t.as('fin1', [])('POST', '/rules/support.fees.set', { config: { ...feeRule(1), exclusions: { subject: true, techStaff: false, owner: true, oneStepPerPerson: true } }, reason: 'r' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'rule_below_floor');
    assert.deepEqual(res.body.problems, ['below_floor_money_exclusions']);
  });

  it('money requests are left out of lists for people who cannot see money', async () => {
    const t = await setup();
    await t.as('fin1', [])('POST', '/rules/support.fees.set', { config: feeRule(2), reason: 'r' });
    await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'x', config: featureRule(1), reason: 'r' });
    const admin = (await t.as('adm', ['admin'])('GET', '/requests?view=open')).body.result.items as { type: string }[];
    assert.deepEqual(admin.map((i) => i.type), ['workflows.rule.set']);
    assert.equal(admin.length, 1);
    const fin = (await t.as('fin2', [])('GET', '/requests?view=open')).body.result.items as unknown[];
    assert.equal(fin.length, 2);
    const actions = (await t.as('adm', ['admin'])('GET', '/actions')).body.result.actions as { domain: string }[];
    assert.ok(!actions.some((a) => a.domain === 'money'));
    assert.equal((await t.as('nobody', [])('GET', '/requests')).status, 403);
  });
});

describe('requests', () => {
  it('suggest finds requests by title; withdraw is for the proposer', async () => {
    const t = await setup();
    const proposed = await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'live', config: featureRule(1), reason: 'r' });
    const id = proposed.body.result.request.id as string;
    const found = (await t.as('sa2', ['super_admin'])('GET', '/requests/suggest?q=approval%20rule')).body.result.items as { id: string }[];
    assert.deepEqual(found.map((f) => f.id), [id]);
    assert.equal((await t.as('sa2', ['super_admin'])('GET', '/requests/suggest?q=nothing-like-this')).body.result.items.length, 0);
    assert.equal((await t.as('sa2', ['super_admin'])('POST', `/requests/${id}/withdraw`, {})).status, 403);
    assert.equal((await t.as('sa1', ['super_admin'])('POST', `/requests/${id}/withdraw`, {})).body.result.status, 'withdrawn');
  });

  it('reject needs a reason and closes the request', async () => {
    const t = await setup();
    const proposed = await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'live', config: featureRule(1), reason: 'r' });
    const id = proposed.body.result.request.id as string;
    assert.equal((await t.as('sa2', ['super_admin'])('POST', `/requests/${id}/reject`, {})).status, 400);
    const res = await t.as('sa2', ['super_admin'])('POST', `/requests/${id}/reject`, { reason: 'Not now' });
    assert.equal(res.body.result.status, 'rejected');
    assert.equal((await t.as('sa2', ['super_admin'])('POST', `/requests/${id}/approve`, {})).body.code, 'request_closed');
  });
});

describe('error catalogue', () => {
  it('has every workflow error code with the same English and Arabic text', () => {
    for (const code of WORKFLOW_ERROR_CODES) {
      const entry = API_ERROR_CATALOGUE[code];
      assert.ok(entry, code);
      assert.equal(entry.en, WORKFLOW_ERROR_MESSAGES[code].en);
      assert.equal(entry.ar, WORKFLOW_ERROR_MESSAGES[code].ar);
    }
  });
});
