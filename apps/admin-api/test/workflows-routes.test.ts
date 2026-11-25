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
import { API_ERROR_CATALOGUE, WORKFLOW_ACTIONS, WORKFLOW_ACTION_TYPES, WORKFLOW_ERROR_CODES, WORKFLOW_ERROR_MESSAGES, WORKFLOW_LISTED_SCOPES, WORKFLOW_SEEDED_SCOPES, workflowFloorFor, type WorkflowActionType } from '@al-ummah/shared-types';
import workflowsRouter from '../src/routers/workflows.router';
import { registerWorkflowExecutor } from '../src/lib/workflows/engine';
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

/**
 * A money action connected for these tests only (its real executor comes with WF-6): the money-rule
 * tests need one, and since owner 2026-11-24 no feature switch carries the money floor.
 */
registerWorkflowExecutor({
  type: 'support.fees.set',
  target: () => ({ kind: 'support-fees', id: 'platform' }),
  canPropose: async () => true,
  validate: async (_ctx, input) => input,
  describe: async () => ({ title: { en: 'Fees', ar: 'الرسوم' }, fields: [], baseVersion: '1' }),
  currentVersion: async () => '1',
  applyJob: async () => ({}),
});

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
  return { search, reports, env, as };
}

const featureRule = (approvalsNeeded: number) => ({
  approvalsNeeded,
  approvers: [{ kind: 'role', role: 'super_admin' }],
  exclusions: { subject: true, techStaff: false, owner: false, oneStepPerPerson: true },
  stepUp: 'approve',
  expiryHours: 168,
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
    assert.equal((await t.as('adm', ['admin'])('POST', '/rules/features.set', { scope: 'live', config: featureRule(1), reason: 'r' })).body.code, 'propose_not_allowed');
    const bad = await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'live', config: { ...featureRule(1), expiryHours: 0 }, reason: 'r' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'rule_invalid');
    assert.equal((await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'live', config: featureRule(1) })).status, 400, 'a reason is required');
  });

  it('a rule is made only for something that is there; one already stored can still be changed', async () => {
    const t = await setup();
    const propose = (type: string, scope: string) => t.as('sa1', ['super_admin'])('POST', `/rules/${type}`, { scope, config: featureRule(1), reason: 'r' });
    for (const [type, scope] of [['features.set', 'notAFeature'], ['features.set', 'assign'], ['tiers.change', 'live']] as const) {
      const res = await propose(type, scope);
      assert.equal(res.status, 400, `${type} ${scope}`);
      assert.deepEqual([res.body.code, res.body.problems], ['rule_invalid', ['scope_unknown']]);
    }
    for (const [type, scope] of [['features.set', 'live'], ['features.set', ''], ['tiers.change', 'assign']] as const) assert.equal((await propose(type, scope)).status, 202, `${type} ${scope}`);
    // A feature that left the registry after it was given a rule
    t.search.raw.prepare("INSERT INTO workflow_rules (id, action_type, scope, version, config, request_id, created_by, created_at) VALUES ('wfrule_gone', 'features.set', 'goneFeature', 1, ?, NULL, 'sa1', ?)").run(JSON.stringify(featureRule(1)), at);
    assert.equal((await propose('features.set', 'goneFeature')).status, 202);
  });

  it('a rule for one feature leaves the rule for all of them alone, and lists after it', async () => {
    const t = await setup();
    const config = featureRule(2);
    const { id } = (await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'live', config, reason: 'r' })).body.result.request;
    assert.equal((await t.as('sa2', ['super_admin'])('POST', `/requests/${id}/approve`, {})).status, 200);
    const action = ((await t.as('sa1', ['super_admin'])('GET', '/actions')).body.result.actions as { type: string; rules: { scope: string; config: { approvalsNeeded: number } }[] }[]).find((a) => a.type === 'features.set')!;
    assert.deepEqual(action.rules.map((r) => [r.scope, r.config.approvalsNeeded]), [['', WORKFLOW_ACTIONS['features.set'].defaultRule.approvalsNeeded], ['live', 2]]);
  });
});

describe('money rules', () => {
  const feeRule = (approvalsNeeded: number) => ({
    approvalsNeeded,
    approvers: [{ kind: 'finance', permission: 'support:providers' }],
    exclusions: { subject: true, techStaff: true, owner: true, oneStepPerPerson: true },
    stepUp: 'propose_and_approve',
    expiryHours: 168,
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

  it('a rule whose action is not connected yet cannot be changed', async () => {
    const t = await setup();
    const res = await t.as('fin1', [])('POST', '/rules/support.ledger.adjust', { config: feeRule(2), reason: 'r' });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body.problems, ['not_connected']);
    const actions = (await t.as('fin1', [])('GET', '/actions')).body.result.actions as { type: string; connected: boolean }[];
    assert.equal(actions.find((a) => a.type === 'support.ledger.adjust')!.connected, false);
    assert.equal(actions.find((a) => a.type === 'features.set')!.connected, true);
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
    await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'live', config: featureRule(1), reason: 'r' });
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

describe('review fixes (#1827)', () => {
  it('the creatorSupport switch rule is an ordinary switch rule (owner 2026-11-24, WF-D9 superseded): super admins change it, the finance list alone does not', async () => {
    const t = await setup();
    const ok = await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'creatorSupport', config: featureRule(1), reason: 'Two people for this one' });
    assert.equal(ok.status, 202, JSON.stringify(ok.body));
    assert.equal(ok.body.result.request.domain, 'governance');
    assert.equal((await t.as('fin1', [])('POST', '/rules/features.set', { scope: 'creatorSupport', config: featureRule(1), reason: 'r' })).body.code, 'propose_not_allowed');
  });

  it('GET /actions lists the seeded scopes, and money ones only for people who see money', async () => {
    const t = await setup();
    const fin = (await t.as('fin1', [])('GET', '/actions')).body.result.actions as { type: string; rules: { scope: string; floor: { money: boolean } }[] }[];
    const fs = fin.find((a) => a.type === 'features.set')!;
    assert.deepEqual(fs.rules.map((r) => [r.scope, r.floor.money]), [['', false]], 'no seeded switch scope: creatorSupport is direct like every switch');
    assert.ok(fin.find((a) => a.type === 'workflows.rule.set')!.rules.some((r) => r.scope === 'money'));
    const adm = (await t.as('adm', ['admin'])('GET', '/actions')).body.result.actions as { type: string; rules: { scope: string }[] }[];
    assert.deepEqual(adm.find((a) => a.type === 'features.set')!.rules.map((r) => r.scope), ['']);
    assert.ok(adm.some((a) => a.type === 'support.financeList.add'), 'finance-list changes are people actions super admins decide');
  });
});

describe('what the viewer may do (canEdit, can.retry)', () => {
  it('canEdit follows the same checks as proposing: super admins for platform rules, the finance list for money rules, nothing for unconnected ones', async () => {
    const t = await setup();
    const flags = async (u: string, roles: string[]) => {
      const actions = (await t.as(u, roles)('GET', '/actions')).body.result.actions as { type: string; rules: { scope: string; canEdit: boolean }[] }[];
      const rule = (type: string, scope = '') => actions.find((a) => a.type === type)?.rules.find((r) => r.scope === scope)?.canEdit;
      return { platform: rule('features.set'), money: rule('support.fees.set'), unconnected: rule('support.ledger.adjust') };
    };
    assert.deepEqual(await flags('sa1', ['super_admin']), { platform: true, money: false, unconnected: false });
    assert.deepEqual(await flags('owner', ['super_admin']), { platform: true, money: false, unconnected: false });
    assert.deepEqual(await flags('fin1', []), { platform: false, money: true, unconnected: false });
    assert.deepEqual(await flags('adm', ['admin']), { platform: false, money: undefined, unconnected: undefined });
  });

  it('can.retry is only on a failed request, for the people the retry route allows', async () => {
    const t = await setup();
    const proposed = await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'live', config: featureRule(1), reason: 'r' });
    const id = proposed.body.result.request.id as string;
    assert.equal((await t.as('sa2', ['super_admin'])('GET', `/requests/${id}`)).body.result.can.retry, false, 'not failed');
    t.search.raw.exec(`UPDATE workflow_requests SET status = 'failed' WHERE id = '${id}'`);
    assert.equal((await t.as('sa2', ['super_admin'])('GET', `/requests/${id}`)).body.result.can.retry, true);
    assert.equal((await t.as('adm', ['admin'])('GET', `/requests/${id}`)).body.result.can.retry, false);
  });
});

describe('open requests by target (GET /pending)', () => {
  /** An open request stored for a target, with the domain proposeChange stores: money by the floor of its scope, else the action's own. */
  const open = (t: Awaited<ReturnType<typeof setup>>, id: string, type: WorkflowActionType, scope: string, target: string, domain?: string) => {
    const [kind, ...rest] = target.split(':');
    t.search.raw
      .prepare(
        `INSERT INTO workflow_requests (id, action_type, scope, domain, rule, target_kind, target_id, open_key, payload, diff, base_version, reason, proposed_by, proposed_at, expires_at, status, approvals_needed, updated_at)
         VALUES (?, ?, ?, ?, '{}', ?, ?, ?, '{}', '{}', '1', 'r', 'x', ?, ?, 'pending', 1, ?)`,
      )
      .run(id, type, scope, domain ?? (workflowFloorFor(type, scope).money ? 'money' : WORKFLOW_ACTIONS[type].domain), kind, rest.join(':'), `${type}:${target}`, at, at, at);
  };
  const ask = async (t: Awaited<ReturnType<typeof setup>>, who: [string, string[]], type: string, targets: string[]) =>
    (await t.as(...who)('GET', `/pending?type=${type}&${targets.map((x) => `target=${encodeURIComponent(x)}`).join('&')}`)).body.result.items as Record<string, string>;
  const ADMIN: [string, string[]] = ['adm', ['admin']];
  const SUPER: [string, string[]] = ['sa1', ['super_admin']];
  const FINANCE: [string, string[]] = ['fin1', ['user']];

  for (const type of WORKFLOW_ACTION_TYPES) {
    // The default scope, every scope with its own floor or name, and one nobody named
    const scopes = [...new Set(['', ...(WORKFLOW_SEEDED_SCOPES[type] ?? []), ...(WORKFLOW_LISTED_SCOPES[type] ?? []), ...(WORKFLOW_ACTIONS[type].scoped ? ['someScope'] : [])])];
    it(`${type}: each row by its own domain, whatever the action's default scope`, async () => {
      const t = await setup();
      const expected: Record<string, string> = {};
      const all: Record<string, string> = {};
      scopes.forEach((scope, i) => {
        const target = `kind:${i}`;
        open(t, `wfr_${i}`, type, scope, target);
        all[target] = `wfr_${i}`;
        if (!workflowFloorFor(type, scope).money) expected[target] = `wfr_${i}`;
      });
      // Stored as money although the floor is not money any more (opened before a floor changed), and the other way round
      open(t, 'wfr_stored_money', type, '', 'kind:stored', 'money');
      open(t, 'wfr_stored_open', type, '', 'kind:open', 'platform');
      Object.assign(all, { 'kind:stored': 'wfr_stored_money', 'kind:open': 'wfr_stored_open' });
      expected['kind:open'] = 'wfr_stored_open';
      const targets = [...Object.keys(all), 'kind:none'];
      assert.deepEqual(await ask(t, ADMIN, type, targets), expected);
      assert.deepEqual(await ask(t, SUPER, type, targets), all);
      assert.deepEqual(await ask(t, FINANCE, type, targets), all);
      assert.equal((await t.as('mod', ['moderator'])('GET', `/pending?type=${type}&target=kind:0`)).status, 403);
    });
  }

  it('a change to a money rule, as it is really proposed, is for people who can see money; other rule changes are for every admin', async () => {
    const t = await setup();
    const money = await t.as('fin1', ['user'])('POST', '/rules/support.fees.set', { scope: '', config: { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['support.fees.set'].defaultRule)), expiryHours: 24 }, reason: 'r' });
    assert.equal(money.status, 202, JSON.stringify(money.body));
    const plain = await t.as('sa1', ['super_admin'])('POST', '/rules/features.set', { scope: 'live', config: featureRule(1), reason: 'r' });
    assert.equal(plain.status, 202, JSON.stringify(plain.body));
    const targets = ['workflow-rule:support.fees.set:', 'workflow-rule:features.set:live'];
    const both = { [targets[0]]: money.body.result.request.id, [targets[1]]: plain.body.result.request.id };
    assert.deepEqual(await ask(t, ADMIN, 'workflows.rule.set', targets), { [targets[1]]: both[targets[1]] });
    assert.deepEqual(await ask(t, FINANCE, 'workflows.rule.set', targets), both);
    assert.deepEqual(await ask(t, SUPER, 'workflows.rule.set', targets), both);
  });
});

describe('request lists in pages', () => {
  const ADMIN: [string, string[]] = ['adm', ['admin']];
  const SUPER: [string, string[]] = ['sa1', ['super_admin']];
  const FINANCE: [string, string[]] = ['fin1', ['user']];
  const stamp = (n: number) => `2026-11-23T10:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;

  /** 130 rule changes, every other one stored as money, all proposed by one person and waiting for three. */
  async function many() {
    const t = await setup();
    const insert = t.search.raw.prepare(
      `INSERT INTO workflow_requests (id, action_type, scope, domain, rule, target_kind, target_id, payload, diff, base_version, reason, proposed_by, proposed_at, expires_at, status, approvals_needed, updated_at)
       VALUES (?, 'workflows.rule.set', ?, ?, '{}', 'workflow-rule', ?, '{}', '{"title":{"en":"t","ar":"t"},"fields":[]}', '1', 'r', 'adm', ?, ?, 'pending', 1, ?)`,
    );
    const inbox = t.search.raw.prepare('INSERT INTO workflow_inbox (user_id, request_id, created_at) VALUES (?, ?, ?)');
    for (let n = 0; n < 130; n++) {
      const money = n % 2 === 0;
      const id = `${money ? 'wfr_money' : 'wfr_plain'}_${String(n).padStart(3, '0')}`;
      insert.run(id, money ? 'money' : '', money ? 'money' : 'governance', id, stamp(n), stamp(n), stamp(n));
      for (const who of ['adm', 'sa1', 'fin1']) inbox.run(who, id, at);
    }
    return t;
  }
  async function pages(t: Awaited<ReturnType<typeof setup>>, who: [string, string[]], query: string) {
    const out: { items: { id: string; proposedAt: string }[]; next: string | null }[] = [];
    let next: string | null = null;
    do {
      const res = await t.as(...who)('GET', `/requests?${query}${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      out.push(res.body.result);
      next = res.body.result.next;
    } while (next && out.length < 9);
    return out;
  }
  // Each view and filter: 65 rows for whoever doesn't see money, 130 for whoever does
  const QUERIES = ['view=waiting', 'view=mine', 'view=open', 'view=open&status=pending', 'view=history', 'view=history&type=workflows.rule.set', 'view=history&type=workflows.rule.set&status=pending', 'view=history&status=pending'];
  for (const query of QUERIES) {
    it(`${query}: full pages of the rows the reader sees, and cursors that are one of them`, async () => {
      const t = await many();
      const mine = await pages(t, ADMIN, query);
      assert.deepEqual(mine.map((p) => p.items.length), [50, 15]);
      const ids = mine.flatMap((p) => p.items.map((i) => i.id));
      assert.equal(new Set(ids).size, 65);
      assert.ok(ids.every((id) => id.startsWith('wfr_plain')));
      const last = mine[0].items[49];
      assert.equal(mine[0].next, `${last.proposedAt}|${last.id}`);
      assert.doesNotMatch(JSON.stringify(mine), /wfr_money/);
      // A cursor from a reader who sees every row pages on through the rows this reader sees, and nothing else
      const other = (await t.as(...(query.startsWith('view=mine') ? ADMIN : SUPER))('GET', `/requests?${query}`)).body.result.next as string;
      const money = `${stamp(60)}|wfr_money_060`;
      for (const cursor of [other, money]) {
        const res = (await t.as(...ADMIN)('GET', `/requests?${query}&cursor=${encodeURIComponent(cursor)}`)).body.result as { items: { id: string }[]; next: string | null };
        assert.ok(res.items.length > 0 && res.items.every((i) => i.id.startsWith('wfr_plain')));
        assert.doesNotMatch(JSON.stringify(res), /wfr_money/);
      }
      if (query.startsWith('view=mine')) return;
      for (const who of [SUPER, FINANCE]) assert.deepEqual((await pages(t, who, query)).map((p) => p.items.length), [50, 50, 30]);
    });
  }

  it('the waiting count is the waiting list\'s length, for each reader', async () => {
    const t = await many();
    for (const [who, n] of [[ADMIN, 65], [SUPER, 130], [FINANCE, 130]] as const) {
      assert.equal((await t.as(...who)('GET', '/counts')).body.result.waitingForMe, n);
      assert.equal((await pages(t, who, 'view=waiting')).flatMap((p) => p.items).length, n);
    }
    // Off the finance list: the inbox rows stay, the count and the list do not show them
    t.search.raw.exec(`UPDATE support_finance_members SET removed_at = '${at}' WHERE user_id = 'fin1'`);
    const off: [string, string[]] = ['fin1', ['admin']];
    assert.equal((await t.as(...off)('GET', '/counts')).body.result.waitingForMe, 65);
    assert.equal((await pages(t, off, 'view=waiting')).flatMap((p) => p.items).length, 65);
  });

  it('suggestions come from the newest 200 the reader sees', async () => {
    const t = await many();
    // 250 newer money rows do not crowd the others out
    const insert = t.search.raw.prepare(
      `INSERT INTO workflow_requests (id, action_type, scope, domain, rule, target_kind, target_id, payload, diff, base_version, reason, proposed_by, proposed_at, expires_at, status, approvals_needed, updated_at)
       VALUES (?, 'workflows.rule.set', 'money', 'money', '{}', 'workflow-rule', ?, '{}', '{"title":{"en":"t","ar":"t"},"fields":[]}', '1', 'r', 'fin1', ?, ?, 'pending', 1, ?)`,
    );
    for (let n = 0; n < 250; n++) insert.run(`wfr_money_new_${n}`, `new_${n}`, stamp(600 + n), at, at);
    const ids = async (who: [string, string[]]) => ((await t.as(...who)('GET', '/requests/suggest?q=t')).body.result.items as { id: string }[]).map((i) => i.id);
    const mine = await ids(ADMIN);
    assert.equal(mine.length, 10);
    assert.ok(mine.every((id) => id.startsWith('wfr_plain')));
    assert.ok((await ids(FINANCE)).every((id) => id.startsWith('wfr_money_new')));
  });

  it('a money action lists nothing, and no next page, for a reader who does not see money', async () => {
    const t = await many();
    t.search.raw.exec("UPDATE workflow_requests SET action_type = 'support.fees.set' WHERE domain = 'money'");
    for (const view of ['waiting', 'mine', 'open', 'history']) assert.deepEqual(await pages(t, ADMIN, `view=${view}&type=support.fees.set`), [{ items: [], next: null }]);
    assert.deepEqual((await pages(t, FINANCE, 'view=history&type=support.fees.set')).map((p) => p.items.length), [50, 15]);
  });
});

describe('a rule\'s extra recipients', () => {
  const SUPER: [string, string[]] = ['sa1', ['super_admin']];
  const rule = (extra: unknown[], more: Record<string, unknown> = {}) => ({ ...featureRule(1), notify: { email: true, extra }, ...more });
  const propose = (t: Awaited<ReturnType<typeof setup>>, extra: unknown[], more = {}) => t.as(...SUPER)('POST', '/rules/features.set', { scope: 'live', config: rule(extra, more), reason: 'r' });

  it('the request shows groups by name and people as people, in approvers and recipients, and the switch by its name', async () => {
    const t = await setup();
    const res = await propose(t, [{ kind: 'finance', permission: 'support:providers' }, { kind: 'people', userIds: ['adm', 'fin1'] }], { approvers: [{ kind: 'role', role: 'super_admin' }, { kind: 'people', userIds: ['sa2'] }] });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const request = res.body.result.request as { title: { en: string; ar: string }; fields: { key: string; kind: string; before: unknown; after: unknown; label: { en: string; ar: string }; enumLabels?: Record<string, { en: string; ar: string }> }[] };
    assert.match(request.title.en, /\(Live streaming\)$/);
    assert.match(request.title.ar, /\(البث المباشر\)$/);
    const field = (key: string) => request.fields.find((f) => f.key === key)!;
    assert.deepEqual([field('approvers').kind, field('approvers').after], ['list', ['role:super_admin']]);
    assert.deepEqual([field('approversPeople').kind, field('approversPeople').before, field('approversPeople').after], ['person', null, ['sa2']]);
    assert.deepEqual([field('notifyExtra').before, field('notifyExtra').after], [null, ['finance:support:providers']]);
    assert.deepEqual(field('notifyExtra').enumLabels!['finance:support:providers'], { en: 'Finance list (Providers and fees)', ar: 'قائمة المالية (المزوّدون والرسوم)' });
    assert.deepEqual([field('notifyExtraPeople').kind, field('notifyExtraPeople').after], ['person', ['adm', 'fin1']]);
    for (const f of request.fields) if (f.kind === 'list') for (const k of [...((f.before as string[]) ?? []), ...((f.after as string[]) ?? [])]) assert.ok(f.enumLabels![k], `${f.key} ${k}`);
  });

  it('a rule with no extra recipients and no named people has no people fields', async () => {
    const t = await setup();
    const { request } = (await propose(t, [])).body.result;
    assert.deepEqual(request.fields.filter((f: { kind: string }) => f.kind === 'person'), []);
  });

  it('only active admins and the finance list can be named; a group must be one of the known ones', async () => {
    const t = await setup();
    for (const extra of [[{ kind: 'people', userIds: ['someone'] }], [{ kind: 'people', userIds: ['adm', 'mod'] }], [{ kind: 'role', role: 'moderator' }]]) {
      const res = await propose(t, extra);
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.deepEqual(res.body.problems, ['recipients_invalid']);
    }
    assert.equal((t.search.raw.prepare('SELECT COUNT(*) AS n FROM workflow_requests').get() as { n: number }).n, 0);
    assert.equal((await propose(t, [{ kind: 'people', userIds: ['adm', 'fin1', 'sa2'] }])).status, 202);
  });

  it('a person already in the rule stays when they are no longer an admin, and shows in the diff', async () => {
    const t = await setup();
    const first = (await propose(t, [{ kind: 'people', userIds: ['adm'] }])).body.result.request.id as string;
    assert.equal((await t.as('sa2', ['super_admin'])('POST', `/requests/${first}/approve`, {})).body.result.status, 'applied');
    await t.reports.prepare("UPDATE admin_staff SET active = 0 WHERE user_id = 'adm'").run();
    const res = await propose(t, [{ kind: 'people', userIds: ['adm', 'sa2'] }]);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const people = res.body.result.request.fields.find((f: { key: string }) => f.key === 'notifyExtraPeople');
    assert.deepEqual([people.before, people.after], [['adm'], ['adm', 'sa2']]);
  });

  it('the picker lists active admins and the finance list by name, all of them at first, for who may change a rule', async () => {
    const t = await setup();
    const names: Record<string, string | null> = { sa1: 'Bilal Ahmed', sa2: 'Aisha Rahman', owner: 'Omar Haddad', adm: 'Khadija Noor', fin1: 'Yusuf Rahman', fin2: null };
    (t.env as Record<string, unknown>).VIDEOS = { fetch: async (_u: string, init: RequestInit) => Response.json({ success: true, result: { users: (JSON.parse(String(init.body)).users as string[]).map((id) => ({ id, found: !!names[id], displayName: names[id] ?? null, userName: null, email: `${id}@example.com` })), items: [] } }) };
    (t.env as Record<string, unknown>).INTERNAL_API_KEY = 'k';
    const list = async (who: [string, string[]], q = '') => (await t.as(...who)('GET', `/recipients?q=${q}`));
    const all = (await list(SUPER)).body.result.items as { id: string; label: string; secondary: unknown }[];
    assert.deepEqual(all.map((i) => i.label), ['Aisha Rahman', 'Bilal Ahmed', 'Khadija Noor', 'Omar Haddad', 'Yusuf Rahman']);
    assert.doesNotMatch(JSON.stringify(all), /@/);
    assert.deepEqual(((await list(SUPER, 'rahman')).body.result.items as { label: string }[]).map((i) => i.label), ['Aisha Rahman', 'Yusuf Rahman']);
    assert.equal((await list(['fin1', ['user']])).status, 200, 'the finance list changes money rules');
    assert.equal((await list(['adm', ['admin']])).status, 403);
    assert.equal((await list(['mod', ['moderator']])).status, 403);
  });

  it('the picker names everyone, past one batch of names', async () => {
    const t = await setup();
    const asked: number[] = [];
    (t.env as Record<string, unknown>).VIDEOS = {
      fetch: async (_u: string, init: RequestInit) => {
        const ids = JSON.parse(String(init.body)).users as string[];
        asked.push(ids.length);
        // As the API does: at most 100 at a time
        return Response.json({ success: true, result: { users: ids.slice(0, 100).map((id) => ({ id, found: true, displayName: `Name ${id}`, userName: null, email: null })), items: [] } });
      },
    };
    (t.env as Record<string, unknown>).INTERNAL_API_KEY = 'k';
    for (let n = 0; n < 150; n++) await t.reports.prepare("INSERT INTO admin_staff (user_id, role, name, email, active, last_seen_at, created_at, updated_at) VALUES (?, 'admin', ?, NULL, 1, ?, ?, ?)").bind(`more_${n}`, `more_${n}`, at, at, at).run();
    const all = (await t.as(...SUPER)('GET', '/recipients')).body.result.items as { id: string }[];
    // 150 and the four admins and two finance people of the setup
    assert.equal(all.length, 156);
    assert.equal(new Set(all.map((i) => i.id)).size, 156);
    assert.ok(asked.every((n) => n <= 100));
  });
});
